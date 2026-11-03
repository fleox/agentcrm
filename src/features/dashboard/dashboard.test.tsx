// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";

// recharts renders nothing in happy-dom anyway (ResponsiveContainer has a
// 0 size); stubbing it also keeps the suite independent of its optional
// peer dependency (react-is).
vi.mock("recharts", () => {
  const Stub = () => null;
  const Container = ({ children }: { children?: unknown }) => <div data-chart="">{children as never}</div>;
  return { ResponsiveContainer: Container, BarChart: Stub, ComposedChart: Stub, Bar: Stub, Line: Stub, Cell: Stub, CartesianGrid: Stub, XAxis: Stub, YAxis: Stub, Tooltip: Stub, Legend: Stub };
});
import { renderCrm, type RenderedCrm } from "../records/testing/renderCrm";
import { setupTestCrm } from "../../ops/testing";
import type { Activity } from "../../core/types";
import { DashboardPage } from "./DashboardPage";
import { ReportsPage, resolveRange } from "./ReportsPage";

// Demo data is seeded at TEST_NOW (2024-06-15) while the UI clock is
// Date.now: assertions avoid time-window-dependent numbers.

let c: RenderedCrm | null = null;
afterEach(() => {
  c?.unmount();
  c = null;
  vi.restoreAllMocks();
});

describe("DashboardPage", () => {
  it("renders KPI tiles and every widget over the demo data", async () => {
    c = await renderCrm(<DashboardPage />, { path: "/" });
    await c.waitFor(() => c!.text().includes("Pipeline by stage"));
    for (const title of ["Open pipeline", "Weighted forecast", "Won this month", "New people this month", "Overdue tasks", "Won / lost", "Lead sources", "Activity by user", "Stale deals", "My tasks today"]) {
      expect(c.text()).toContain(title);
    }
    // Stage legend rows (chart itself is 0-size in happy-dom).
    expect(c.findAll("[data-stage]").length).toBeGreaterThan(0);
    // Demo deals are old relative to the real clock → stale, linked to the record.
    const stale = c.findAll<HTMLAnchorElement>("[data-stale-deal] a");
    expect(stale.length).toBeGreaterThan(0);
    expect(stale[0].getAttribute("href")).toMatch(/^\/objects\/deals\//);
    // Overdue tile links to /tasks.
    expect(c.find<HTMLAnchorElement>("a", "Overdue tasks").getAttribute("href")).toBe("/tasks");
  });

  it("completes one of my tasks inline", async () => {
    const crm = await setupTestCrm({ demo: true });
    c = await renderCrm(<DashboardPage />, { path: "/", crm });
    await c.waitFor(() => c!.text().includes("My tasks today"));
    const open = () => (c!.store.list("activities") as unknown as Activity[]).filter((a) => a.type === "task" && !a.doneAt && a.assigneeId === c!.user.id);
    const rows = c.findAll("[data-task]");
    if (!rows.length) {
      expect(c.text()).toContain("Nothing due today.");
      return;
    }
    const id = rows[0].getAttribute("data-task")!;
    const before = open().length;
    c.click(rows[0].querySelector("input[type=checkbox]"));
    await c.waitFor(() => open().length === before - 1);
    expect(open().some((a) => a.id === id)).toBe(false);
    await c.waitFor(() => !c!.findAll(`[data-task="${id}"]`).length);
  });

  it("handles an empty CRM without pipeline", async () => {
    const crm = await setupTestCrm({ demo: false });
    for (const p of crm.store.list("pipelines")) await crm.store.write([{ op: "delete", collection: "pipelines", id: p.id }]);
    c = await renderCrm(<DashboardPage />, { path: "/", crm });
    await c.waitFor(() => c!.text().includes("My tasks today"));
    expect(c.text()).not.toContain("Pipeline by stage");
    expect(c.text()).toContain("No pipeline yet");
    expect(c.text()).toContain("Lead sources");
  });
});

describe("ReportsPage", () => {
  it("renders every report card with a working CSV export", async () => {
    const created = vi.fn(() => "blob:test");
    Object.defineProperty(URL, "createObjectURL", { value: created, configurable: true, writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true, writable: true });
    c = await renderCrm(<ReportsPage />, { path: "/reports" });
    await c.waitFor(() => c!.findAll("[data-report]").length >= 7);
    const ids = c.findAll("[data-report]").map((e) => e.getAttribute("data-report"));
    expect(ids).toEqual(expect.arrayContaining(["pipelineByStage", "forecast", "wonLost", "activityByUser", "leadSources", "conversion", "staleDeals"]));
    const buttons = c.findAll("button[data-export]");
    expect(buttons.length).toBe(7);
    for (const b of buttons) c.click(b);
    expect(created).toHaveBeenCalledTimes(7);
    // The funnel table always lists the lifecycle stages.
    const funnel = c.find("[data-report=conversion]").textContent ?? "";
    expect(funnel).toContain("Lead");
    expect(funnel).toContain("Customer");
  });

  it("switches to a custom range and changes the pipeline filter", async () => {
    c = await renderCrm(<ReportsPage />, { path: "/reports" });
    await c.waitFor(() => c!.findAll("[data-report]").length >= 7);
    const period = c.find<HTMLSelectElement>("select[aria-label=Period]");
    c.type(period, "custom");
    await c.waitFor(() => c!.findAll("input[type=date]").length === 2);
    c.type(c.find("input[aria-label=From]"), "2024-01-01");
    c.type(c.find("input[aria-label=To]"), "2024-06-30");
    await c.flush();
    expect(c.findAll("[data-report]").length).toBe(7);
    const pipeline = c.find<HTMLSelectElement>("select[aria-label=Pipeline]");
    expect(pipeline.options.length).toBeGreaterThan(0);
  });

  it("resolves date range presets", () => {
    const now = new Date(2024, 5, 15, 12).getTime();
    expect(resolveRange("ytd", now, "", "").since).toBe(new Date(2024, 0, 1).getTime());
    expect(resolveRange("12m", now, "", "").since).toBe(new Date(2023, 6, 1).getTime());
    const custom = resolveRange("custom", now, "2024-02-01", "2024-03-31");
    expect(custom.since).toBe(new Date(2024, 1, 1).getTime());
    expect(custom.until).toBe(new Date(2024, 3, 1).getTime() - 1);
    expect(resolveRange("custom", now, "2024-02-01", "2099-01-01").until).toBeNull();
  });
});
