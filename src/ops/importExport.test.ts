import { describe, expect, it } from "vitest";
import { setupTestCrm } from "./testing";
import { importCsv, parseCsv, suggestMapping } from "./importCsv";
import { exportCsv, exportJson, importJson } from "./exportCsv";
import { createRecord, listRecords } from "./records";
import { objectOf, recordOf } from "./store";
import { createMemoryStore } from "../data/memory";
import { createOpsContext } from "./context";

const PEOPLE_CSV = `First name,Last name,E-mail,Company,Lifecycle stage,Lead source,Owner,Notes
Ada,Lovelace,ada@acme.com,Acme,Customer,Webinar,ada@example.com,x
Alan,Turing,alan@globex.io,globex.io,lead,,,y
Grace,Hopper,not-an-email,Acme,lead,,,z
Ada,Again,ADA@acme.com,Acme,customer,,,dup
`;

describe("importCsv", () => {
  it("parses, suggests a mapping and reports a dry run without writing", async () => {
    const { admin, store } = await setupTestCrm();
    const parsed = parseCsv(PEOPLE_CSV);
    expect(parsed.headers).toHaveLength(8);
    const mapping = suggestMapping(objectOf(store, "people")!, parsed.headers);
    expect(mapping).toMatchObject({ "First name": "firstName", "Last name": "lastName", "E-mail": "email", Company: "company", "Lifecycle stage": "lifecycleStage", "Lead source": "leadSource", Owner: "$owner", Notes: "" });
    const report = await importCsv(admin, { object: "people", csv: PEOPLE_CSV, dryRun: true });
    expect(report).toMatchObject({ total: 4, created: 2, failed: 1, skipped: 1, dryRun: true, unmappedColumns: ["Notes"] });
    expect(report.newOptions).toEqual([{ field: "leadSource", labels: ["Webinar"] }]);
    expect(report.createdRelated.map((r) => r.label)).toEqual(["Acme", "Globex"]);
    expect(report.rows[2]).toMatchObject({ row: 4, action: "error" });
    expect(listRecords(admin, "people").total).toBe(0);
    expect(listRecords(admin, "companies").total).toBe(0);
  });

  it("imports in one write, resolves relations, dedupes by email on re-import", async () => {
    const { admin, store } = await setupTestCrm();
    const acme = await createRecord(admin, "companies", { name: "Acme", domain: "acme.com" });
    const report = await importCsv(admin, { object: "people", csv: PEOPLE_CSV });
    expect(report.created).toBe(2);
    const ada = listRecords(admin, "people", { filters: [{ field: "email", op: "eq", value: "ada@acme.com" }] }).items[0];
    expect(ada.fields).toMatchObject({ name: "Ada Lovelace", company: acme.id, lifecycleStage: "customer", leadSource: "webinar" });
    expect(ada.ownerId).toBe("owner");
    const globex = listRecords(admin, "companies", { search: "globex" }).items[0];
    expect(globex.fields).toMatchObject({ name: "Globex", domain: "https://globex.io" });
    // Re-import with a changed title updates instead of duplicating.
    const again = await importCsv(admin, { object: "people", csv: "Email,Job title\nada@acme.com,CTO\n" });
    expect(again).toMatchObject({ created: 0, updated: 1 });
    expect(recordOf(store, ada.id)!.fields).toMatchObject({ jobTitle: "CTO", name: "Ada Lovelace" });
    const skip = await importCsv(admin, { object: "people", csv: "Email\nada@acme.com\n", onDuplicate: "skip" });
    expect(skip.skipped).toBe(1);
  });

  it("companies dedupe by domain; deals map stages by label; explicit mapping is validated", async () => {
    const { admin } = await setupTestCrm();
    await importCsv(admin, { object: "companies", csv: "Name,Website,Employees\nAcme,https://www.acme.com,1 200\nAcme Inc,acme.com,\n" });
    expect(listRecords(admin, "companies").items.map((c) => c.fields.employees)).toEqual([1200]);
    const deals = await importCsv(admin, { object: "deals", csv: 'Deal name,Amount,Stage,Close date\nBig one,"$12,500",Proposal,03/07/2024\n', dayFirst: true });
    expect(deals.created).toBe(1);
    const d = listRecords(admin, "deals").items[0];
    expect(d.fields).toMatchObject({ name: "Big one", amount: 12500, stage: "proposal", probability: 50, closeDate: "2024-07-03" });
    await expect(importCsv(admin, { object: "deals", csv: "a\n1\n", mapping: { a: "nope" } })).rejects.toThrow(/unknown field/);
    await expect(importCsv(admin.user ? { ...admin, user: { ...admin.user, role: "viewer" } } : admin, { object: "deals", csv: "a\n1" })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("exports", () => {
  it("CSV with labels (round-trips through import) and raw values", async () => {
    const { admin } = await setupTestCrm();
    const acme = await createRecord(admin, "companies", { name: "Acme, Inc", industry: "software", tags: ["vip", "partner"] });
    await createRecord(admin, "people", { name: "Ada Lovelace", email: "ada@acme.com", company: acme.id, lifecycleStage: "customer" });
    const csv = exportCsv(admin, "people", { fields: ["name", "email", "company", "lifecycleStage"] });
    const lines = csv.split("\n");
    expect(lines[0]).toBe("ID,Name,Email,Company,Lifecycle stage");
    expect(lines[1]).toContain('"Acme, Inc"');
    expect(lines[1]).toContain("Customer");
    const raw = exportCsv(admin, "companies", { values: "raw", includeId: false, fields: ["name", "tags"] });
    expect(raw.split("\n")[1]).toBe('"Acme, Inc","vip, partner"');
  });

  it("JSON export / restore into another store", async () => {
    const { admin } = await setupTestCrm({ demo: true });
    const dump = exportJson(admin);
    expect(dump.format).toBe("agentcrm-export");
    expect(dump.collections.records).toHaveLength(150);
    const target = createMemoryStore();
    await target.ready();
    const ctx = createOpsContext(target, null);
    const res = await importJson(ctx, JSON.parse(JSON.stringify(dump)));
    expect(res.written).toBeGreaterThan(300);
    expect(listRecords(ctx, "deals").total).toBe(40);
    await expect(importJson(ctx, { format: "nope" } as never)).rejects.toThrow(/Not an AgentCRM/);
  });
});
