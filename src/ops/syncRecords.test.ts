import { describe, expect, it } from "vitest";
import { setupTestCrm } from "./testing";
import { applySchema } from "./schemaApply";
import { syncRecords } from "./syncRecords";
import { recordsOf } from "./store";

async function crm() {
  const t = await setupTestCrm();
  await applySchema(t.admin, {
    objects: [
      { id: "companies", labelSingular: "Operator", labelPlural: "Operators", fields: [{ id: "rid", label: "Source id", type: "text", unique: true }, { id: "archived", label: "Archived", type: "boolean" }] },
      {
        id: "accounts",
        labelSingular: "Account",
        labelPlural: "Accounts",
        fields: [
          { id: "rid", label: "Source id", type: "text", unique: true },
          { id: "status", label: "Status", type: "select", options: ["active", "closed"] },
          { id: "operators", label: "Operators", type: "relation", relation: { object: "companies", cardinality: "many" } },
          { id: "archived", label: "Archived", type: "boolean" },
        ],
      },
    ],
  });
  return t;
}
const ops = (n: number) => Array.from({ length: n }, (_, i) => ({ key: String(i + 1), fields: { name: `Op ${i + 1}` } }));
const fieldsOf = (ctx: Awaited<ReturnType<typeof crm>>["admin"], object: string) =>
  Object.fromEntries(recordsOf(ctx.store, object).map((r) => [String(r.fields.rid), r.fields]));

describe("records sync", () => {
  it("creates, then writes nothing when the source didn't change", async () => {
    const { admin } = await crm();
    const first = await syncRecords(admin, { object: "companies", key: "rid", rows: ops(50), archiveField: "archived" });
    expect(first).toMatchObject({ rows: 50, created: 50, updated: 0, unchanged: 0, errors: [] });
    const writesBefore = recordsOf(admin.store, "companies").map((r) => r.updatedAt);
    const again = await syncRecords(admin, { object: "companies", key: "rid", rows: ops(50), archiveField: "archived" });
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 50, archived: 0 });
    expect(recordsOf(admin.store, "companies").map((r) => r.updatedAt)).toEqual(writesBefore);
  });

  it("updates only what differs and resolves relations by key", async () => {
    const { admin } = await crm();
    await syncRecords(admin, { object: "companies", key: "rid", rows: ops(3) });
    const rows = [{ key: "a1", fields: { name: "Acc 1", status: "active", operators: { $key: ["1", "3", "99"] } } }];
    const r1 = await syncRecords(admin, { object: "accounts", key: "rid", rows });
    expect(r1).toMatchObject({ created: 1, unresolved: 1, unresolvedRefs: [{ key: "a1", field: "operators", refs: ["99"] }] });
    // An unresolved key leaves the relation as it was (nothing, on a creation).
    expect(fieldsOf(admin, "accounts").a1.operators).toBeUndefined();
    const ids = Object.fromEntries(recordsOf(admin.store, "companies").map((r) => [r.fields.rid, r.id]));
    await syncRecords(admin, { object: "accounts", key: "rid", rows: [{ key: "a1", fields: { ...rows[0].fields, operators: { $key: ["1", "3"] } } }] });
    expect(fieldsOf(admin, "accounts").a1.operators).toEqual([ids["1"], ids["3"]]);
    const r2 = await syncRecords(admin, { object: "accounts", key: "rid", rows: [{ key: "a1", fields: { ...rows[0].fields, status: "closed" } }] });
    expect(r2).toMatchObject({ updated: 1, unchanged: 0, unresolved: 1 });
    expect(fieldsOf(admin, "accounts").a1.operators).toEqual([ids["1"], ids["3"]]);
    expect(r2.samples.updated[0].fields).toEqual(["status"]);
  });

  it("archives what left the source, restores it when it comes back, keeps CRM-only fields", async () => {
    const { admin } = await crm();
    await syncRecords(admin, { object: "companies", key: "rid", rows: ops(3), archiveField: "archived" });
    const gone = await syncRecords(admin, { object: "companies", key: "rid", rows: ops(2), archiveField: "archived" });
    expect(gone).toMatchObject({ archived: 1, unchanged: 2 });
    expect(fieldsOf(admin, "companies")["3"]).toMatchObject({ archived: true, name: "Op 3" });
    const back = await syncRecords(admin, { object: "companies", key: "rid", rows: ops(3), archiveField: "archived" });
    expect(back).toMatchObject({ updated: 1 });
    expect(fieldsOf(admin, "companies")["3"].archived).toBe(false);
    expect(recordsOf(admin.store, "companies")).toHaveLength(3);
  });

  it("reports invalid rows and still writes the others", async () => {
    const { admin } = await crm();
    const r = await syncRecords(admin, { object: "accounts", key: "rid", rows: [{ key: "ok", fields: { name: "Ok", status: "active" } }, { key: "bad", fields: { name: "Bad", status: "nope" } }] });
    expect(r.created).toBe(1);
    expect(r.errors).toEqual([expect.objectContaining({ key: "bad" })]);
  });

  it("keeps a relation untouched when a $key does not resolve, clears it on an explicit empty value", async () => {
    const { admin } = await crm();
    await applySchema(admin, { objects: [{ id: "accounts", labelSingular: "Account", labelPlural: "Accounts", fields: [{ id: "main", label: "Main operator", type: "relation", relation: { object: "companies", cardinality: "one" } }] }] });
    await syncRecords(admin, { object: "companies", key: "rid", rows: ops(2) });
    const ids = Object.fromEntries(recordsOf(admin.store, "companies").map((r) => [r.fields.rid, r.id]));
    const row = (fields: Record<string, unknown>) => [{ key: "a1", fields: { name: "Acc 1", ...fields } }];
    await syncRecords(admin, { object: "accounts", key: "rid", rows: row({ main: { $key: "1" }, operators: { $key: ["1", "2"] } }) });
    expect(fieldsOf(admin, "accounts").a1).toMatchObject({ main: ids["1"], operators: [ids["1"], ids["2"]] });

    const missing = await syncRecords(admin, { object: "accounts", key: "rid", rows: row({ main: { $key: "77" }, operators: { $key: ["2", "88"] } }) });
    expect(missing).toMatchObject({ unchanged: 1, updated: 0, unresolved: 2 });
    expect(missing.unresolvedRefs).toEqual([
      { key: "a1", field: "main", refs: ["77"] },
      { key: "a1", field: "operators", refs: ["88"] },
    ]);
    expect(fieldsOf(admin, "accounts").a1).toMatchObject({ main: ids["1"], operators: [ids["1"], ids["2"]] });
    // Idempotent: the same unresolved source writes nothing again.
    const again = await syncRecords(admin, { object: "accounts", key: "rid", rows: row({ main: { $key: "77" }, operators: { $key: ["2", "88"] } }) });
    expect(again).toMatchObject({ unchanged: 1, updated: 0 });

    const cleared = await syncRecords(admin, { object: "accounts", key: "rid", rows: row({ main: null, operators: { $key: [] } }) });
    expect(cleared).toMatchObject({ updated: 1, unresolved: 0, unresolvedRefs: [] });
    expect(fieldsOf(admin, "accounts").a1.main).toBeUndefined();
    expect(fieldsOf(admin, "accounts").a1.operators ?? []).toEqual([]);
    await syncRecords(admin, { object: "accounts", key: "rid", rows: row({ main: { $key: "2" } }) });
    const emptyRef = await syncRecords(admin, { object: "accounts", key: "rid", rows: row({ main: { $key: "" } }) });
    expect(emptyRef).toMatchObject({ updated: 1, unresolved: 0 });
    expect(fieldsOf(admin, "accounts").a1.main).toBeUndefined();
  });

  it("stamps created records like createRecord: createdBy, updatedBy, fieldUpdates; none for the system context", async () => {
    const t = await crm();
    t.clock.now = 5000;
    await syncRecords(t.as("member"), { object: "companies", key: "rid", rows: ops(1), archiveField: "archived" });
    const [c] = recordsOf(t.store, "companies");
    expect(c).toMatchObject({ createdBy: "u-member", updatedBy: "u-member" });
    expect(c.fieldUpdates).toMatchObject({ rid: { by: "u-member", at: 5000 }, name: { by: "u-member", at: 5000 }, archived: { by: "u-member", at: 5000 } });
    expect(Object.keys(c.fieldUpdates!).sort()).toEqual(Object.keys(c.fields).sort());

    await syncRecords(t.as(null), { object: "accounts", key: "rid", rows: [{ key: "s1", fields: { name: "Sys" } }] });
    const [a] = recordsOf(t.store, "accounts");
    expect(a.createdBy).toBeUndefined();
    expect(a.updatedBy).toBeUndefined();
    expect(a.fieldUpdates).toBeUndefined();
  });
});
