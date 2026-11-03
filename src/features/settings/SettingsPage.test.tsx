// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { renderCrm, type RenderedCrm } from "../records/testing/renderCrm";
import type { CrmRecord, CrmSettings, ObjectDef } from "../../core/types";
import { SettingsPage } from "./SettingsPage";

let c: RenderedCrm | null = null;
afterEach(() => {
  c?.unmount();
  c = null;
});

const PATH = "/settings/:section";

function submitOf(scope = "[role=dialog]"): HTMLElement {
  const dialogs = [...document.querySelectorAll(scope)];
  const last = dialogs[dialogs.length - 1];
  const btn = last?.querySelector<HTMLElement>('button[type="submit"]');
  if (!btn) throw new Error("no submit button");
  return btn;
}

describe("settings page", () => {
  it("renders every built-in section for an admin", async () => {
    c = await renderCrm(<SettingsPage />, { path: PATH, route: "/settings/general" });
    await c.waitFor(() => c!.text().includes("CRM name"));
    const checks: [string, string][] = [
      ["Users & roles", "Who can see and change the CRM."],
      ["Data model", "Standard objects"],
      ["Pipelines", "Sales"],
      ["Import", "Drop a CSV file here"],
      ["Export & backup", "Full backup (JSON)"],
      ["Danger zone", "Compact storage"],
    ];
    for (const [nav, expected] of checks) {
      c.click(c.find("nav button", nav));
      await c.waitFor(() => c!.text().includes(expected));
    }
  });

  it("general save updates settings", async () => {
    c = await renderCrm(<SettingsPage />, { path: PATH, route: "/settings/general" });
    await c.waitFor(() => c!.text().includes("CRM name"));
    c.type(c.find("#crm-name"), "Acme CRM");
    c.type(c.find("#crm-currency"), "eur");
    c.type(c.find("#crm-stale"), "21");
    c.type(c.find("#crm-week"), "0");
    c.type(c.find("#crm-locale"), "fr-FR");
    c.click(c.find('form button[type="submit"]'));
    await c.waitFor(() => (c!.store.get("settings", "general") as unknown as CrmSettings | undefined)?.name === "Acme CRM");
    const s = c.store.get("settings", "general") as unknown as CrmSettings;
    expect(s.defaultCurrency).toBe("EUR");
    expect(s.staleDealDays).toBe(21);
    expect(s.weekStartsOn).toBe(0);
    expect(s.locale).toBe("fr-FR");
    await c.waitFor(() => c!.text().includes("Settings saved"));
  });

  it("data model: create a custom object and add a select field", async () => {
    c = await renderCrm(<SettingsPage />, { path: PATH, route: "/settings/data-model" });
    await c.waitFor(() => c!.text().includes("Standard objects"));
    c.click(c.find("button", "New object"));
    await c.waitFor(() => !!document.querySelector("#obj-singular"));
    c.type(c.find("#obj-singular"), "Project");
    expect((c.find<HTMLInputElement>("#obj-plural")).value).toBe("Projects");
    c.click(c.find("[role=radio][aria-label=Rocket]"));
    c.click(submitOf());
    await c.waitFor(() => !!c!.store.get("objects", "projects"));
    expect((c.store.get("objects", "projects") as unknown as ObjectDef).icon).toBe("Rocket");
    // Opens the new object's fields editor.
    await c.waitFor(() => !!document.querySelector('[data-testid="fields-list"]'));
    c.click(c.find("button", "Add field"));
    await c.waitFor(() => !!document.querySelector("#field-label"));
    c.type(c.find("#field-label"), "Priority");
    c.type(c.find("#field-type"), "select");
    await c.waitFor(() => !!document.querySelector('input[aria-label="New option…"]'));
    for (const label of ["High", "Low"]) {
      c.type(c.find('input[aria-label="New option…"]'), label);
      c.click(c.find("[role=dialog] button", "Add"));
    }
    await c.waitFor(() => c!.findAll('input[aria-label="Option label"]').length === 2);
    c.click(submitOf());
    await c.waitFor(() => !!(c!.store.get("objects", "projects") as unknown as ObjectDef).fields.find((f) => f.id === "priority"));
    const field = (c.store.get("objects", "projects") as unknown as ObjectDef).fields.find((f) => f.id === "priority")!;
    expect(field.type).toBe("select");
    expect(field.options?.map((o) => o.label)).toEqual(["High", "Low"]);
    await c.waitFor(() => !!document.querySelector('[data-testid="field-row-priority"]'));
  });

  it("import wizard dry run then real import", async () => {
    c = await renderCrm(<SettingsPage />, { path: PATH, route: "/settings/import" });
    await c.waitFor(() => !!document.querySelector("#import-csv"));
    const csv = "First name,Last name,Email,Company\nGrace,Hopper,grace@navy.example,Navy Labs\nAlan,Turing,alan@bletchley.example,Bletchley Park";
    c.type(c.find("#import-object"), "people");
    c.type(c.find("#import-csv"), csv);
    const before = c.store.list("records").length;
    c.click(c.find("button", "Map columns"));
    await c.waitFor(() => !!document.querySelector('[data-testid="mapping-table"]'));
    expect(c.find<HTMLSelectElement>('select[data-header="Email"]').value).toBe("email");
    expect(c.find<HTMLSelectElement>('select[data-header="First name"]').value).toBe("firstName");
    expect(c.find<HTMLSelectElement>('select[data-header="Company"]').value).toBe("company");

    c.click(c.find("button", "Dry run"));
    await c.waitFor(() => !!document.querySelector('[data-testid="import-report"]'));
    expect(c.text()).toContain("Dry run: nothing was written yet");
    const createdTile = c.findAll('[data-testid="import-report"] div', /^Created\d+$/)[0];
    expect(createdTile?.textContent).toBe("Created2");
    expect(c.store.list("records").length).toBe(before);
    const people = () => (c!.store.list("records") as unknown as CrmRecord[]).filter((r) => r.object === "people");
    expect(people().some((r) => r.fields.email === "grace@navy.example")).toBe(false);

    c.click(c.find("button", "Import 2 records"));
    await c.waitFor(() => !!document.querySelector('[data-testid="import-done"]'));
    expect(people().some((r) => r.fields.email === "grace@navy.example")).toBe(true);
    expect(people().some((r) => r.fields.email === "alan@bletchley.example")).toBe(true);
    expect(c.find("a", "Open People").getAttribute("href")).toContain("/objects/people");
  });

  it("field type change shows the migration warning and converts values", async () => {
    c = await renderCrm(<SettingsPage />, { path: PATH, route: "/settings/data-model?object=companies" });
    await c.waitFor(() => !!document.querySelector('[data-testid="field-row-employees"]'));
    const row = c.find('[data-testid="field-row-employees"]');
    c.click(row.querySelector('button[aria-label="Edit"]'));
    await c.waitFor(() => !!document.querySelector("#field-type"));
    c.type(c.find("#field-type"), "text");
    await c.waitFor(() => !!document.querySelector('[data-testid="type-change-warning"]'));
    c.click(submitOf());
    await c.waitFor(() => c!.text().includes("Convert Number to Text?"));
    c.click(c.find("[role=dialog] button", "Convert"));
    await c.waitFor(() => (c!.store.get("objects", "companies") as unknown as ObjectDef).fields.find((f) => f.id === "employees")?.type === "text");
    await c.waitFor(() => /values converted/.test(c!.text()));
  });

  it("viewer sees read-only settings", async () => {
    c = await renderCrm(<SettingsPage />, { path: PATH, route: "/settings/general", role: "viewer" });
    await c.waitFor(() => c!.text().includes("CRM name"));
    expect(document.querySelector('[data-testid="read-only-note"]')).not.toBeNull();
    expect(c.find<HTMLInputElement>("#crm-name").disabled).toBe(true);
    expect(document.querySelector('form button[type="submit"]')).toBeNull();
    expect(c.findAll("nav button", "Danger zone")).toHaveLength(0);

    c.click(c.find("nav button", "Data model"));
    await c.waitFor(() => c!.text().includes("Standard objects"));
    expect(c.findAll("button", "New object")).toHaveLength(0);
    expect(document.querySelector('[data-testid="read-only-note"]')).not.toBeNull();

    c.click(c.find("nav button", "Users & roles"));
    await c.waitFor(() => c!.text().includes("Who can see and change the CRM."));
    expect(c.findAll("button", "Add user")).toHaveLength(0);
    expect(c.text()).toContain("you");

    c.click(c.find("nav button", "Import"));
    await c.waitFor(() => c!.text().includes("Your role can't import records."));
    expect(document.querySelector("#import-csv")).toBeNull();
  });
});
