// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { Activity, CrmRecord, ViewDef } from "../../core/types";
import { emitShellEvent } from "../../app/shellEvents";
import { renderCrm, type RenderedCrm } from "./testing/renderCrm";
import { ObjectListPage } from "./ObjectListPage";
import { RecordPage } from "./RecordPage";
import { TrashPage } from "./trash/TrashPage";
import { LogActivityHost, QuickCreateHost } from "./create/Overlays";
import { computeRows, defaultsFromFilters, kanbanColumns, columnTotals, applyManualOrder, visibleColumns } from "./lib/viewModel";
import { setupTestCrm } from "../../ops/testing";

let current: RenderedCrm | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});

const listRoute = { path: "/objects/:objectId" };
const records = (c: RenderedCrm, object: string) => (c.store.list("records") as unknown as CrmRecord[]).filter((r) => r.object === object && !r.deletedAt);

function ListWithOverlays() {
  return (
    <>
      <ObjectListPage />
      <QuickCreateHost />
    </>
  );
}

describe("view model", () => {
  it("computes rows, defaults from filters, kanban columns and totals", async () => {
    const crm = await setupTestCrm({ demo: true });
    const deals = crm.store.get("objects", "deals") as never;
    const all = (crm.store.list("records") as unknown as CrmRecord[]).filter((r) => r.object === "deals");
    const won = computeRows(all, deals, { filters: [{ field: "stage", op: "eq", value: "won" }], sorts: [], search: "" }, {});
    expect(won.length).toBeGreaterThan(0);
    expect(won.every((r) => r.fields.stage === "won")).toBe(true);
    expect(defaultsFromFilters(deals, [{ field: "stage", op: "eq", value: "Won" }, { field: "amount", op: "gt", value: 3 }])).toEqual({ stage: "won" });
    const pipeline = crm.store.get("pipelines", "sales") as never;
    const stageField = (deals as { fields: { id: string }[] }).fields.find((f) => f.id === "stage") as never;
    const cols = kanbanColumns(stageField, { pipeline, noValueLabel: "None" });
    expect(cols.map((c) => c.key)).toEqual(["new", "qualified", "proposal", "negotiation", "won", "lost"]);
    const totals = columnTotals([{ ...all[0], fields: { amount: 1000, probability: 50 } }], { id: "amount", label: "", type: "currency" }, cols[0].stage);
    expect(totals).toEqual({ count: 1, amount: 1000, weighted: 500 });
    expect(applyManualOrder(all.slice(0, 3), [all[2].id]).map((r) => r.id)).toEqual([all[2].id, all[0].id, all[1].id]);
    expect(visibleColumns(deals, ["amount", "nope", "name"])).toEqual(["name", "amount"]);
  });
});

describe("table view", () => {
  it("edits a cell inline with the keyboard and with the mouse", async () => {
    const c = (current = await renderCrm(<ObjectListPage />, { ...listRoute, route: "/objects/companies" }));
    await c.waitFor(() => c.text().includes("Hooli"));
    const grid = c.find('[data-testid="data-grid"]');
    // Keyboard: ↓ (row 2), → (domain column), Enter opens the editor.
    act(() => grid.focus());
    c.key(grid, "ArrowDown");
    c.key(grid, "ArrowRight");
    c.key(grid, "Enter");
    await c.waitFor(() => !!document.querySelector('[data-testid="cell-editor"] input'));
    const rowId = c.find("tr[aria-rowindex='2']").getAttribute("data-row-id")!;
    const input = c.find<HTMLInputElement>('[data-testid="cell-editor"] input');
    c.type(input, "https://renamed.example");
    c.key(input, "Enter");
    await c.waitFor(() => (c.store.get("records", rowId) as unknown as CrmRecord).fields.domain === "https://renamed.example");
    await c.waitFor(() => !document.querySelector('[data-testid="cell-editor"]'));

    // Mouse: click to activate, click again to edit the employees number.
    const hooli = records(c, "companies").find((r) => r.fields.name === "Hooli")!;
    const cell = () => c.find(`tr[data-row-id="${hooli.id}"] td[data-col="employees"]`);
    c.click(cell());
    c.click(cell());
    const num = c.find<HTMLInputElement>('[data-testid="cell-editor"] input');
    c.type(num, "6100");
    c.key(num, "Enter");
    await c.waitFor(() => (c.store.get("records", hooli.id) as unknown as CrmRecord).fields.employees === 6100);
    // Escape cancels without saving.
    c.click(cell());
    const again = c.find<HTMLInputElement>('[data-testid="cell-editor"] input');
    c.type(again, "1");
    c.key(again, "Escape");
    await c.flush();
    expect((c.store.get("records", hooli.id) as unknown as CrmRecord).fields.employees).toBe(6100);
  });

  it("filters with the builder, saves the view, then resets", async () => {
    const c = (current = await renderCrm(<ObjectListPage />, { ...listRoute, route: "/objects/people" }));
    await c.waitFor(() => !!document.querySelector('[data-testid="data-grid"]'));
    const total = records(c, "people").length;
    c.click(c.find("button", "Filter"));
    c.click(c.find("button", /^Lifecycle stageSelect$/));
    await c.waitFor(() => !!document.querySelector('[data-testid="filter-editor"]'));
    // "is any of" → tick "Customer".
    const customer = c.findAll("label", "Customer").find((l) => l.closest('[data-testid="filter-editor"]'))!;
    c.click(customer.querySelector("input"));
    const expected = records(c, "people").filter((r) => r.fields.lifecycleStage === "customer").length;
    expect(expected).toBeGreaterThan(0);
    await c.waitFor(() => c.find('[data-testid="record-count"]').textContent === `${expected} of ${total}`);
    expect(document.querySelectorAll("tr[data-row-id]").length).toBe(expected);
    await c.waitFor(() => !!document.querySelector('[data-testid="view-dirty"]'));
    c.click(c.find("button", "Save view"));
    await c.waitFor(() => (c.store.get("views", "people-all") as unknown as ViewDef).filters.length === 1);
    expect((c.store.get("views", "people-all") as unknown as ViewDef).filters[0]).toEqual({ field: "lifecycleStage", op: "in", value: ["customer"] });
    await c.waitFor(() => !document.querySelector('[data-testid="view-dirty"]'));
    // Remove the filter locally → dirty → reset restores it.
    c.click(c.find("button", "Clear filters"));
    await c.waitFor(() => !!document.querySelector('[data-testid="view-dirty"]'));
    c.click(c.find("button", "Reset"));
    await c.waitFor(() => c.find('[data-testid="record-count"]').textContent === `${expected} of ${total}`);
  });

  it("bulk-updates selected rows and quick-creates a record", async () => {
    const c = (current = await renderCrm(<ListWithOverlays />, { ...listRoute, route: "/objects/companies" }));
    await c.waitFor(() => c.text().includes("Hooli"));
    const rows = c.findAll("tr[data-row-id]").slice(0, 2);
    for (const r of rows) c.click(r.querySelector('input[type="checkbox"]'));
    await c.waitFor(() => !!document.querySelector('[data-testid="bulk-actions"]'));
    expect(c.find('[data-testid="bulk-actions"]').textContent).toContain("2 selected");
    c.click(c.find("button", "Update field"));
    const select = c.find<HTMLSelectElement>('select[aria-label="Field"]');
    c.type(select, "employees");
    const input = document.querySelector<HTMLInputElement>('form input[inputmode="decimal"]')!;
    c.type(input, "42");
    c.click(c.find("button", "Apply"));
    const ids = rows.map((r) => r.getAttribute("data-row-id")!);
    await c.waitFor(() => ids.every((id) => (c.store.get("records", id) as unknown as CrmRecord).fields.employees === 42));

    // "+ New" → quick create modal (record.create shell event).
    c.click(c.find("header button", "New"));
    await c.waitFor(() => !!document.querySelector('[data-testid="quick-create"]'));
    const name = c.find<HTMLInputElement>('[data-testid="quick-create"] input');
    c.type(name, "Initech");
    c.click(c.find('[data-testid="quick-create"] button[type="submit"]'));
    await c.waitFor(() => records(c, "companies").some((r) => r.fields.name === "Initech"));
  });
});

describe("kanban view", () => {
  it("moves deals between stages with won / lost confirmation and shows totals", async () => {
    const c = (current = await renderCrm(<ObjectListPage />, { ...listRoute, route: "/objects/deals?view=deals-pipeline" }));
    await c.waitFor(() => !!document.querySelector('[data-testid="kanban"]'));
    expect(c.findAll("section[data-column]").map((s) => s.getAttribute("data-column"))).toEqual(["new", "qualified", "proposal", "negotiation", "won", "lost"]);
    const open = records(c, "deals").filter((r) => ["new", "qualified", "proposal"].includes(String(r.fields.stage)) && r.fields.pipeline === "sales");
    expect(open.length).toBeGreaterThan(1);
    expect(c.find('[data-testid="totals-new"]').textContent).toMatch(/\d/);

    const [a, b] = open;
    const label = (r: CrmRecord) => String(r.fields.name);
    // Move to Won → confirm dialog.
    c.click(c.find(`[data-card-id="${a.id}"] button[aria-label="Actions for ${label(a)}"]`));
    c.click(c.find('[role="menuitem"]', "Move to Won"));
    await c.waitFor(() => c.text().includes(`Mark ${label(a)} as won?`));
    c.click(c.find("button", "Mark as won"));
    await c.waitFor(() => (c.store.get("records", a.id) as unknown as CrmRecord).fields.stage === "won");
    expect((c.store.get("records", a.id) as unknown as CrmRecord).fields.probability).toBe(100);
    await c.waitFor(() => !!document.querySelector(`section[data-column="won"] [data-card-id="${a.id}"]`));

    // Move to Lost → lost reason modal.
    c.click(c.find(`[data-card-id="${b.id}"] button[aria-label="Actions for ${label(b)}"]`));
    c.click(c.find('[role="menuitem"]', "Move to Lost"));
    await c.waitFor(() => !!document.querySelector("#lost-reason"));
    c.click(c.find("button", "Competitor"));
    c.click(c.find('button[type="submit"]', "Mark as lost"));
    await c.waitFor(() => (c.store.get("records", b.id) as unknown as CrmRecord).fields.stage === "lost");
    expect((c.store.get("records", b.id) as unknown as CrmRecord).fields.lostReason).toBe("Competitor");
  });

  it("quick-adds a card in a column", async () => {
    const c = (current = await renderCrm(<ObjectListPage />, { ...listRoute, route: "/objects/deals?view=deals-pipeline" }));
    await c.waitFor(() => !!document.querySelector('[data-testid="kanban"]'));
    c.click(c.find('section[data-column="proposal"] button', "New"));
    const input = c.find<HTMLInputElement>('input[aria-label="New record in Proposal"]');
    c.type(input, "Big expansion");
    act(() => input.form!.requestSubmit());
    await c.waitFor(() => records(c, "deals").some((r) => r.fields.name === "Big expansion"));
    const deal = records(c, "deals").find((r) => r.fields.name === "Big expansion")!;
    expect(deal.fields.stage).toBe("proposal");
    expect(deal.fields.pipeline).toBe("sales");
  });
});

describe("record detail", () => {
  const detail = { path: "/objects/:objectId/:recordId", routes: [{ path: "/objects/:objectId", element: <div>list-page</div> }] };

  it("creates a note from the timeline composer and lists it in Notes", async () => {
    const crm = await setupTestCrm({ demo: true });
    const hooli = (crm.store.list("records") as unknown as CrmRecord[]).find((r) => r.fields.name === "Hooli")!;
    const c = (current = await renderCrm(<RecordPage />, { ...detail, crm, route: `/objects/companies/${hooli.id}` }));
    await c.waitFor(() => !!document.querySelector('[data-testid="timeline"]'));
    expect(c.text()).toContain("Hooli");
    // Inverse relations get their own tabs (people, deals of the company).
    expect(c.findAll('[role="tab"]').map((t) => t.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("People"), expect.stringContaining("Deals")]));

    c.click(c.find("button", "Log a note"));
    const composer = c.find('[data-testid="activity-composer"]');
    c.type(composer.querySelector('input[aria-label="Title"]'), "Kickoff recap");
    c.type(composer.querySelector("textarea"), "Discussed **pricing** and next steps.");
    // Preview renders sanitised markdown.
    c.click(c.find('[data-testid="activity-composer"] button', "Preview"));
    await c.waitFor(() => !!document.querySelector('[data-testid="markdown-preview"] strong'));
    c.click(c.find('[data-testid="activity-composer"] button[type="submit"]'));
    await c.waitFor(() => (c.store.list("activities") as unknown as Activity[]).some((a) => a.title === "Kickoff recap"));
    const note = (c.store.list("activities") as unknown as Activity[]).find((a) => a.title === "Kickoff recap")!;
    expect(note.type).toBe("note");
    expect(note.targets).toEqual([{ object: "companies", id: hooli.id }]);
    await c.waitFor(() => !!document.querySelector(`[data-activity-id="${note.id}"]`));

    c.click(c.find('[role="tab"]', "Notes"));
    await c.waitFor(() => !!document.querySelector('[data-testid="notes-tab"]'));
    expect(document.querySelector(`[data-testid="notes-tab"] [data-activity-id="${note.id}"] strong`)?.textContent).toBe("pricing");
  });

  it("edits a field inline, logs a call through the activity.log overlay, deletes and restores", async () => {
    const crm = await setupTestCrm({ demo: true });
    const person = (crm.store.list("records") as unknown as CrmRecord[]).find((r) => r.object === "people" && r.fields.jobTitle)!;
    function Page() {
      return (
        <>
          <RecordPage />
          <LogActivityHost />
        </>
      );
    }
    const c = (current = await renderCrm(<Page />, { ...detail, crm, route: `/objects/people/${person.id}` }));
    await c.waitFor(() => !!document.querySelector('[data-testid="fields-panel"]'));
    c.click(c.find('[data-field="jobTitle"] button'));
    const input = c.find<HTMLInputElement>('[data-testid="cell-editor"] input');
    c.type(input, "Chief Hacker");
    c.key(input, "Enter");
    await c.waitFor(() => (c.store.get("records", person.id) as unknown as CrmRecord).fields.jobTitle === "Chief Hacker");

    act(() => emitShellEvent("activity.log", { type: "call", target: { object: "people", id: person.id } }));
    await c.waitFor(() => c.text().includes("Log Call"));
    const composer = c.find('[role="dialog"] [data-testid="activity-composer"]');
    c.type(composer.querySelector('input[aria-label="Title"]'), "Discovery call");
    c.click(composer.querySelector('button[type="submit"]'));
    await c.waitFor(() => (c.store.list("activities") as unknown as Activity[]).some((a) => a.title === "Discovery call" && a.type === "call" && a.meta?.durationMin === 15));

    c.click(c.find('button[aria-label="Record actions"]'));
    c.click(c.find('[role="menuitem"]', "Delete record"));
    await c.waitFor(() => c.text().includes("Delete "));
    c.click(c.findAll('[role="dialog"] button', "Delete").pop());
    await c.waitFor(() => !!(c.store.get("records", person.id) as unknown as CrmRecord).deletedAt);
  });

  it("lists deleted records in the trash and restores them", async () => {
    const crm = await setupTestCrm({ demo: true });
    const r = (crm.store.list("records") as unknown as CrmRecord[]).find((x) => x.object === "companies")!;
    await crm.store.write([{ op: "patch", collection: "records", id: r.id, fields: { deletedAt: Date.now() } }]);
    const c = (current = await renderCrm(<TrashPage />, { path: "/objects/:objectId/trash", route: "/objects/companies/trash", crm }));
    await c.waitFor(() => c.text().includes(String(r.fields.name)));
    c.click(c.find("button", "Restore"));
    await c.waitFor(() => !(c.store.get("records", r.id) as unknown as CrmRecord).deletedAt);
  });
});
