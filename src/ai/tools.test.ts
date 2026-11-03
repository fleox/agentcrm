import { describe, expect, it } from "vitest";
import { AI_TOOLS, callTool, findTool } from "./tools";
import { setupTestCrm } from "../ops/testing";
import { createRecord } from "../ops/records";
import { createJournalStore } from "../data/journal";
import { createMemoryConnector } from "../shared/storage/connectors/memory";
import { createOpsContext } from "../ops/context";
import { seedCrm } from "../ops/seed";

describe("AI tool catalog", () => {
  it("declares unique names, object schemas and the required tools", () => {
    const names = AI_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const required of [
      "search_records",
      "get_record",
      "list_records",
      "create_record",
      "update_record",
      "delete_record",
      "merge_records",
      "add_note",
      "create_task",
      "complete_task",
      "list_tasks",
      "move_deal_stage",
      "pipeline_summary",
      "run_report",
      "describe_schema",
      "create_field",
      "import_csv",
      "list_activities",
    ]) {
      expect(names).toContain(required);
    }
    for (const t of AI_TOOLS) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(20);
      expect(/^[a-z_]+$/.test(t.name)).toBe(true);
    }
    expect(findTool("list_records")!.mutating).toBe(false);
    expect(findTool("create_record")!.mutating).toBe(true);
  });

  it("create → search → get → move stage → summary on a memory store", async () => {
    const { admin } = await setupTestCrm();
    const company = (await callTool(admin, "create_record", { object: "companies", fields: { name: "Acme", domain: "acme.com", industry: "Software" } })) as { id: string; fields: Record<string, unknown> };
    expect(company.fields.industry).toEqual({ value: "software", label: "Software" });
    const deal = (await callTool(admin, "create_record", { object: "deals", fields: { name: "Acme deal", amount: 10000, company: company.id } })) as { id: string; fields: Record<string, unknown> };
    expect(deal.fields.company).toEqual({ id: company.id, label: "Acme" });
    const hits = (await callTool(admin, "search_records", { query: "acme" })) as { id: string }[];
    expect(hits.map((h) => h.id)).toContain(company.id);
    await callTool(admin, "add_note", { recordId: company.id, body: "Great call" });
    const details = (await callTool(admin, "get_record", { id: company.id })) as { related: { object: string; count: number }[]; activities: unknown[] };
    expect(details.related).toEqual([expect.objectContaining({ object: "deals", count: 1 })]);
    expect(details.activities).toHaveLength(1);
    await callTool(admin, "move_deal_stage", { id: deal.id, stage: "Negotiation" });
    const summary = (await callTool(admin, "pipeline_summary", {})) as { weightedAmount: number; pipelines: unknown[] };
    expect(summary.weightedAmount).toBe(7500);
    expect(summary.pipelines).toHaveLength(1);
  });

  it("tasks, reports, schema, import dry run vs confirm", async () => {
    const { admin } = await setupTestCrm();
    const p = await createRecord(admin, "people", { name: "Ada" });
    const task = (await callTool(admin, "create_task", { title: "Follow up", dueAt: "2024-06-10", recordIds: [p.id] })) as { id: string };
    expect(((await callTool(admin, "list_tasks", { overdue: true })) as { total: number }).total).toBe(1);
    await callTool(admin, "complete_task", { id: task.id });
    expect(((await callTool(admin, "list_tasks", {})) as { total: number }).total).toBe(0);
    expect(((await callTool(admin, "list_activities", { recordId: p.id })) as { total: number }).total).toBe(1);
    expect(await callTool(admin, "run_report", { name: "conversion" })).toHaveProperty("stages");
    const schema = (await callTool(admin, "describe_schema", { object: "deals" })) as { fields: unknown[] }[];
    expect(schema[0].fields.length).toBeGreaterThan(5);
    await callTool(admin, "create_field", { object: "people", label: "Tier", type: "select", options: ["Gold"] });
    const csv = "Name,Email,Tier\nBob,bob@x.io,Gold\n";
    const dry = (await callTool(admin, "import_csv", { object: "people", csv })) as { dryRun: boolean; created: number };
    expect(dry).toMatchObject({ dryRun: true, created: 1 });
    expect(((await callTool(admin, "list_records", { object: "people" })) as { total: number }).total).toBe(1);
    await callTool(admin, "import_csv", { object: "people", csv, confirm: true });
    const list = (await callTool(admin, "list_records", { object: "people", filters: [{ field: "tier", op: "eq", value: "Gold" }] })) as { total: number };
    expect(list.total).toBe(1);
  });

  it("validates input and enforces roles", async () => {
    const crm = await setupTestCrm();
    await expect(callTool(crm.admin, "nope", {})).rejects.toThrow(/Unknown tool/);
    await expect(callTool(crm.admin, "get_record", {})).rejects.toThrow(/missing required "id"/);
    await expect(callTool(crm.as("viewer"), "create_record", { object: "companies", fields: { name: "X" } })).rejects.toMatchObject({ code: "forbidden" });
    await expect(callTool(crm.as("member"), "create_field", { object: "people", label: "X", type: "text" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("works end-to-end on the journal backend (two clients)", async () => {
    const conn = createMemoryConnector();
    const a = createJournalStore({ connector: conn, root: "crm", passphrase: "pw", iterations: 1000 });
    await a.ready();
    const ctxA = createOpsContext(a, null);
    await seedCrm(ctxA, { admin: { name: "Admin", email: "admin@x.io" } });
    await callTool(ctxA, "create_record", { object: "companies", fields: { name: "Journal Co" } });
    const b = createJournalStore({ connector: conn, root: "crm", passphrase: "pw" });
    await b.ready();
    const ctxB = createOpsContext(b, null);
    const list = (await callTool(ctxB, "list_records", { object: "companies" })) as { records: { label: string }[] };
    expect(list.records.map((r) => r.label)).toEqual(["Journal Co"]);
  });
});
