// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderCrm, type RenderedCrm } from "../records/testing/renderCrm";
import automations from "./index";
import { AutomationsPage } from "./AutomationsPage";
import { AutomationEditorPage } from "./AutomationEditor";
import { RunLogPage } from "./RunLogPage";
import { TemplatesPage } from "./TemplatesPage";
import { RecentRunsWidget } from "./RecentRunsWidget";
import { createAutomationFromTemplate, runScheduled } from "../../ops/automations";
import type { Automation } from "../../core/types";

const routes = [
  { path: "/automations", element: createElement(AutomationsPage) },
  { path: "/automations/runs", element: createElement(RunLogPage) },
  { path: "/automations/templates", element: createElement(TemplatesPage) },
  { path: "/automations/:automationId", element: createElement(AutomationEditorPage) },
];

let ui: RenderedCrm | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

describe("automations UI", () => {
  it("creates an automation from the templates gallery and toggles it in the list", async () => {
    ui = await renderCrm(createElement(TemplatesPage), { path: "/automations/templates", features: [automations], routes: routes.filter((r) => r.path !== "/automations/templates") });
    await ui.waitFor(() => ui!.text().includes("Deal won → onboarding task"));
    ui.click(ui.findAll("button", "Use")[0]);
    await ui.waitFor(() => ui!.store.list("automations").length === 1);
    const a = ui.store.list("automations")[0] as unknown as Automation;
    expect(a.name).toBe("Deal won → onboarding task");
    // Navigated to the editor.
    await ui.waitFor(() => ui!.text().includes("Test on a record"));
    ui.unmount();

    ui = await renderCrm(createElement(AutomationsPage), { path: "/automations", crm: ui.crm, features: [automations] });
    await ui.waitFor(() => ui!.text().includes("When the stage changes to"));
    ui.click(ui.find('[role="switch"]'));
    await ui.waitFor(() => (ui!.store.get("automations", a.id) as unknown as Automation).enabled === false);
  });

  it("builds a new automation in the editor, dry-runs it on a record and saves", async () => {
    ui = await renderCrm(createElement(AutomationEditorPage), { path: "/automations/:automationId", route: "/automations/new", features: [automations], routes });
    await ui.waitFor(() => ui!.text().includes("New automation"));
    ui.type(ui.find("#automation-name"), "Note on new deals");
    // Default object is deals, trigger "Record is created". Add an action.
    ui.click(ui.find("button", "Add action"));
    ui.click(ui.find('[role="menuitem"]', "Add a note"));
    ui.type(ui.find("textarea"), "Hello {{label}}");
    ui.click(ui.find("button", "Dry run"));
    await ui.waitFor(() => ui!.text().includes("Conditions match"));
    expect(ui.text()).toMatch(/Add note "Hello /);
    expect(ui.store.list("automationRuns")).toHaveLength(0);
    ui.click(ui.find("button", "Save"));
    await ui.waitFor(() => ui!.store.list("automations").length === 1);
    const a = ui.store.list("automations")[0] as unknown as Automation;
    expect(a).toMatchObject({ name: "Note on new deals", object: "deals", trigger: { type: "record.created" }, actions: [{ type: "addNote", body: "Hello {{label}}" }] });
  });

  it("shows validation errors from the engine", async () => {
    ui = await renderCrm(createElement(AutomationEditorPage), { path: "/automations/:automationId", route: "/automations/new", features: [automations], routes });
    await ui.waitFor(() => ui!.text().includes("New automation"));
    ui.click(ui.find("button", "Save"));
    await ui.waitFor(() => ui!.text().includes("A name is required."));
    expect(ui.store.list("automations")).toHaveLength(0);
  });

  it("lists runs in the run log and the dashboard widget", async () => {
    ui = await renderCrm(createElement(RunLogPage), { path: "/automations/runs", features: [automations] });
    const crm = ui.crm;
    await createAutomationFromTemplate(crm.admin, "stale-deal-followup");
    crm.clock.now += 400 * 86_400_000;
    const report = await runScheduled(crm.admin);
    expect(report.ran).toBeGreaterThan(0);
    await ui.waitFor(() => ui!.text().includes("Deal stale 14 days → follow-up task"));
    expect(ui.findAll("tbody tr").length).toBeGreaterThan(0);
    ui.unmount();
    ui = await renderCrm(createElement(RecentRunsWidget), { crm, features: [automations] });
    await ui.waitFor(() => ui!.text().includes("Automation runs") && ui!.text().includes("OK"));
  });
});
