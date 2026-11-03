import { recordOf } from "./store";
import { describe, expect, it } from "vitest";
import { setupTestCrm } from "./testing";
import { createRecord } from "./records";
import { findDuplicates, mergeRecords } from "./dedupe";
import { addNote, listActivities } from "./activities";

describe("dedupe", () => {
  it("finds duplicates by email, domain and normalised name", async () => {
    const { admin, store } = await setupTestCrm();
    await createRecord(admin, "companies", { name: "Acme Inc.", domain: "acme.com" });
    await store.write([{ op: "set", collection: "records", doc: { id: "c2", object: "companies", fields: { name: "ACME", domain: "https://www.acme.com/" }, createdAt: 1, updatedAt: 1 } }]);
    await createRecord(admin, "companies", { name: "Other" });
    const groups = findDuplicates(admin, "companies");
    expect(groups.map((g) => g.reason)).toEqual(["domain"]);
    expect(groups[0].records).toHaveLength(2);
  });

  it("merges fields, relations and activities into the primary in one write", async () => {
    const { admin, store } = await setupTestCrm();
    const c1 = await createRecord(admin, "companies", { name: "Acme", tags: ["vip"] });
    const c2 = await createRecord(admin, "companies", { name: "Acme Corp", industry: "software", tags: ["partner", "vip"], employees: 50 });
    const p = await createRecord(admin, "people", { name: "Ada", company: c2.id });
    const d = await createRecord(admin, "deals", { name: "Deal", company: c2.id });
    await addNote(admin, c2.id, "Note on the duplicate");
    const res = await mergeRecords(admin, c1.id, [c2.id], { pick: { name: c2.id } });
    expect(res.record.fields).toMatchObject({ name: "Acme Corp", industry: "software", employees: 50, tags: ["vip", "partner"] });
    expect(store.get("records", c2.id)).toBeUndefined();
    expect(recordOf(store, p.id)!.fields.company).toBe(c1.id);
    expect(recordOf(store, d.id)!.fields.company).toBe(c1.id);
    expect(listActivities(admin, { target: c1.id }).total).toBe(1);
    expect(res.movedActivities).toBe(1);
    await expect(mergeRecords(admin, c1.id, [p.id])).rejects.toThrow(/Can't merge/);
    await expect(mergeRecords(admin, c1.id, [c1.id])).rejects.toThrow(/Nothing to merge/);
  });
});
