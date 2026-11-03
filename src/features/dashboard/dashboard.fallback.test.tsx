// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { renderCrm } from "../records/testing/renderCrm";
import { DashboardPage } from "./DashboardPage";

// The recharts module fails to load (e.g. missing peer dependency): cards
// still render their legends / lists with a muted "Chart unavailable".
vi.mock("./chartsImpl", () => {
  throw new Error("recharts unavailable");
});

describe("DashboardPage without recharts", () => {
  it("falls back to legend-only cards", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const c = await renderCrm(<DashboardPage />, { path: "/" });
    await c.waitFor(() => c.findAll("[data-chart-unavailable]").length > 0);
    expect(c.text()).toContain("Pipeline by stage");
    expect(c.text()).toContain("Chart unavailable");
    expect(c.findAll("[data-stage]").length).toBeGreaterThan(0);
    c.unmount();
  });
});
