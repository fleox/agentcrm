// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderCrm, type RenderedCrm } from "../records/testing/renderCrm";
import { emitShellEvent, onShellEvent } from "../../app/shellEvents";
import type { CrmRecord } from "../../core/types";
import { CommandPalette, matchesCommand } from "./CommandPalette";
import { parseRecordPath, pushRecent, readRecent, RECENT_KEY } from "./recentRecords";

// The shared harness imports the dashboard (recharts). Fall back to an empty
// module when recharts cannot load (missing peer dep react-is in some
// installs) — charts are never rendered here.
vi.mock("recharts", async (importOriginal) => {
  try {
    return await importOriginal();
  } catch {
    return {};
  }
});

let c: RenderedCrm | null = null;
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});
afterEach(() => {
  c?.unmount();
  c = null;
});

function RecordPageStub() {
  const loc = useLocation();
  return <div data-testid="record-page">record-page {loc.pathname}</div>;
}

// Palette mounted next to the routed content, like a global overlay.
function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <CommandPalette />
      {children}
    </>
  );
}

const ROUTES = [{ path: "/objects/:objectId/:recordId", element: <Shell><RecordPageStub /></Shell> }];

const input = () => document.querySelector<HTMLInputElement>('input[placeholder^="Search records"]');
const activeOption = () => document.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');

async function openPalette(c: RenderedCrm) {
  act(() => emitShellEvent("search.open"));
  await c.waitFor(() => !!input());
}

describe("recentRecords", () => {
  it("parses record paths and keeps the last 8, most recent first", () => {
    expect(parseRecordPath("/objects/companies/abc")).toEqual({ object: "companies", id: "abc" });
    expect(parseRecordPath("/objects/companies")).toBeNull();
    for (let i = 0; i < 10; i++) pushRecent({ object: "people", id: `p${i}` });
    pushRecent({ object: "people", id: "p3" });
    const r = readRecent();
    expect(r).toHaveLength(8);
    expect(r[0].id).toBe("p3");
    expect(r.filter((x) => x.id === "p3")).toHaveLength(1);
    localStorage.setItem(RECENT_KEY, "{not json");
    expect(readRecent()).toEqual([]);
  });

  it("matches commands token by token, accent-insensitive", () => {
    expect(matchesCommand({ label: "Créer : Société", keywords: "new" }, "creer soc")).toBe(true);
    expect(matchesCommand({ label: "Tasks" }, "deals")).toBe(false);
  });
});

describe("CommandPalette", () => {
  it("searches records and navigates with Enter", async () => {
    c = await renderCrm(<Shell />, { path: "/", routes: ROUTES });
    await openPalette(c);
    c.type(input(), "Hooli");
    await c.waitFor(() => c!.findAll('[role="option"]', "Hooli").length > 0);
    expect(c.text()).toContain("Records");
    expect(activeOption()?.textContent).toContain("Hooli");
    c.key(input(), "Enter");
    await c.waitFor(() => !!document.querySelector('[data-testid="record-page"]'));
    const hooli = (c.store.list("records") as unknown as CrmRecord[]).find((r) => r.object === "companies" && r.fields.name === "Hooli")!;
    expect(c.find('[data-testid="record-page"]').textContent).toContain(`/objects/companies/${hooli.id}`);
    expect(input()).toBeNull();
    // The visit is remembered.
    expect(readRecent()[0]).toMatchObject({ object: "companies", id: hooli.id });
  });

  it("moves the selection with the keyboard across sections", async () => {
    c = await renderCrm(<Shell />, { path: "/" });
    await openPalette(c);
    const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options().length).toBeGreaterThan(3);
    expect(activeOption()).toBe(options()[0]);
    c.key(input(), "ArrowDown");
    expect(activeOption()).toBe(options()[1]);
    c.key(input(), "End");
    expect(activeOption()).toBe(options()[options().length - 1]);
    c.key(input(), "ArrowDown");
    expect(activeOption()).toBe(options()[0]);
    c.key(input(), "ArrowUp");
    expect(activeOption()).toBe(options()[options().length - 1]);
    c.key(input(), "Home");
    expect(activeOption()).toBe(options()[0]);
    expect(c.text()).toContain("Go to");
    expect(c.text()).toContain("Actions");
  });

  it("filters to commands with > and emits record.create", async () => {
    c = await renderCrm(<Shell />, { path: "/" });
    const seen: unknown[] = [];
    const off = onShellEvent("record.create", (d) => seen.push(d));
    await openPalette(c);
    c.type(input(), ">create compan");
    await c.waitFor(() => c!.text().includes("Create Company"));
    expect(c.findAll('[role="option"]').every((o) => !/Hooli/.test(o.textContent ?? ""))).toBe(true);
    expect(c.text()).not.toContain("Records");
    c.key(input(), "Enter");
    expect(seen).toEqual([{ object: "companies" }]);
    off();
  });

  it("creates a task on the current record", async () => {
    const tmp = await renderCrm(<div />, { path: "/" });
    const hooli = (tmp.store.list("records") as unknown as CrmRecord[]).find((r) => r.object === "companies" && r.fields.name === "Hooli")!;
    const crm = tmp.crm;
    tmp.unmount();
    c = await renderCrm(<div />, { path: "/", crm, route: `/objects/companies/${hooli.id}`, routes: ROUTES });
    const seen: unknown[] = [];
    const off = onShellEvent("tasks.create", (d) => seen.push(d));
    await openPalette(c);
    c.type(input(), "new task");
    await c.waitFor(() => !!activeOption()?.textContent?.includes("New task"));
    expect(activeOption()?.textContent).toContain("Hooli");
    c.key(input(), "Enter");
    expect(seen).toEqual([{ targets: [{ object: "companies", id: hooli.id }] }]);
    off();
  });

  it("navigates to a nav item and shows recent records", async () => {
    pushRecent({ object: "companies", id: "missing-record" });
    function Probe() {
      const loc = useLocation();
      useNavigate();
      return <div data-testid="where">{loc.pathname}</div>;
    }
    c = await renderCrm(<Shell />, { path: "/", routes: [{ path: "/tasks", element: <Probe /> }] });
    await openPalette(c);
    // Unknown recent ids are skipped.
    expect(c.text()).not.toContain("Recent");
    c.type(input(), "tasks");
    await c.waitFor(() => !!activeOption()?.textContent?.includes("Tasks"));
    c.key(input(), "Enter");
    await c.waitFor(() => c!.findAll('[data-testid="where"]', "/tasks").length > 0);
  });

  it("shows an empty state", async () => {
    c = await renderCrm(<Shell />, { path: "/" });
    await openPalette(c);
    c.type(input(), "zzzqqqxxx nothing");
    await c.waitFor(() => c!.text().includes("No results"));
    c.key(window, "Escape");
    await c.waitFor(() => !input());
  });
});
