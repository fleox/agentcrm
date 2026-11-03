import { recordOf } from "./store";
import { describe, expect, it, vi } from "vitest";
import { setupTestCrm } from "./testing";
import {
  bulkDelete,
  bulkUpdate,
  createRecord,
  deleteRecord,
  getRecordDetails,
  listRecords,
  restoreRecord,
  searchRecords,
  updateRecord,
} from "./records";
import { linkRecords, unlinkRecords, inverseRelations } from "./relations";
import { OpsError } from "./context";

describe("records ops", () => {
  it("creates with validation, coercion, defaults and derived fields", async () => {
    const { admin } = await setupTestCrm();
    const acme = await createRecord(admin, "companies", { name: "Acme", domain: "acme.com", employees: "1,200" });
    expect(acme.fields).toMatchObject({ name: "Acme", domain: "https://acme.com", employees: 1200 });
    expect(acme.ownerId).toBe("owner");
    const ada = await createRecord(admin, "people", { firstName: "Ada", lastName: "Lovelace", email: "ADA@acme.com", company: acme.id });
    expect(ada.fields).toMatchObject({ name: "Ada Lovelace", email: "ada@acme.com", lifecycleStage: "lead", company: acme.id });
    await expect(createRecord(admin, "deals", { amount: 10 })).rejects.toMatchObject({ code: "validation" });
    await expect(createRecord(admin, "people", { name: "X", company: "nope" })).rejects.toThrow(/not found/);
    await expect(createRecord(admin, "people", { name: "Dup", email: "ada@acme.com" })).rejects.toThrow(/already used/);
    await expect(createRecord(admin, "nope", {})).rejects.toThrow(/Unknown object/);
  });

  it("deal stage drives probability and pipeline and emits stage.changed", async () => {
    const { admin, plugins } = await setupTestCrm();
    const changes: string[] = [];
    plugins.addAction("stage.changed", (_c, p) => void changes.push(`${p.from}->${p.to}`));
    const deal = await createRecord(admin, "deals", { name: "Big", amount: 1000 });
    expect(deal.fields).toMatchObject({ stage: "new", pipeline: "sales", probability: 10 });
    const moved = await updateRecord(admin, deal.id, { stage: "Proposal" });
    expect(moved.fields).toMatchObject({ stage: "proposal", probability: 50 });
    const custom = await updateRecord(admin, deal.id, { stage: "negotiation", probability: 60 });
    expect(custom.fields.probability).toBe(60);
    expect(changes).toEqual(["null->new", "new->proposal", "proposal->negotiation"]);
  });

  it("updates per field, emits record.updated with the changed keys, skips no-ops", async () => {
    const { admin, plugins, store } = await setupTestCrm();
    const updated = vi.fn();
    plugins.addAction("record.updated", (_c, p) => void updated(p.changed));
    const c = await createRecord(admin, "companies", { name: "Acme", industry: "Software" });
    const writeSpy = vi.spyOn(store, "write");
    await updateRecord(admin, c.id, { industry: "finance", tags: "vip, partner" });
    expect(writeSpy.mock.calls[0][0][0]).toMatchObject({ op: "patch", fields: { "fields.industry": "finance", "fields.tags": ["vip", "partner"] } });
    expect(updated).toHaveBeenCalledWith(["industry", "tags"]);
    await updateRecord(admin, c.id, { industry: "Finance" });
    expect(updated).toHaveBeenCalledTimes(1);
    await updateRecord(admin, c.id, { tags: null });
    expect(recordOf(store, c.id)!.fields).not.toHaveProperty("tags");
  });

  it("lists with filters, sorts, search, views and pagination", async () => {
    const { admin } = await setupTestCrm({ demo: true });
    const all = listRecords(admin, "companies", { limit: 5 });
    expect(all.total).toBe(30);
    // Demo addresses are plausible: the country is the city's.
    const addresses = listRecords(admin, "companies", { limit: 30 }).items.map((r) => r.fields.address as { city: string; country: string });
    expect(addresses.filter((a) => a.city === "New York").every((a) => a.country === "United States")).toBe(true);
    expect(addresses.filter((a) => a.city === "Paris" || a.city === "Lyon").every((a) => a.country === "France")).toBe(true);
    expect(all.items).toHaveLength(5);
    expect(all.hasMore).toBe(true);
    const software = listRecords(admin, "companies", { filters: [{ field: "industry", op: "eq", value: "Software" }], sorts: [{ field: "employees", dir: "desc" }] });
    expect(software.items[0].fields.name).toBe("Hooli");
    expect(software.items.every((r) => r.fields.industry === "software")).toBe(true);
    expect(listRecords(admin, "companies", { search: "globex" }).items[0].fields.name).toBe("Globex");
    const pipelineView = listRecords(admin, "deals", { viewId: "deals-pipeline" });
    expect(pipelineView.total).toBe(40);
    expect(() => listRecords(admin, "deals", { viewId: "people-all" })).toThrow(OpsError);
    // A typo in an explicit filter / sort is an error, not "every record".
    expect(() => listRecords(admin, "deals", { filters: [{ field: "stg", op: "eq", value: "won" }] })).toThrow(/Unknown field "stg" on Deals/);
    expect(() => listRecords(admin, "deals", { sorts: [{ field: "amout", dir: "desc" }] })).toThrow(/Unknown field "amout"/);
    expect(listRecords(admin, "deals", { filters: [{ field: "createdAt", op: "notEmpty" }] }).total).toBe(40);
  });

  it("soft delete, restore, hard delete with reference cleanup", async () => {
    const { admin, store } = await setupTestCrm();
    const c = await createRecord(admin, "companies", { name: "Acme" });
    const p = await createRecord(admin, "people", { name: "Ada", company: c.id });
    await deleteRecord(admin, c.id);
    expect(listRecords(admin, "companies").total).toBe(0);
    expect(listRecords(admin, "companies", { onlyDeleted: true }).total).toBe(1);
    await restoreRecord(admin, c.id);
    expect(listRecords(admin, "companies").total).toBe(1);
    await deleteRecord(admin, c.id, { hard: true });
    expect(store.get("records", c.id)).toBeUndefined();
    expect(recordOf(store, p.id)!.fields).not.toHaveProperty("company");
  });

  it("bulk update and delete in one write, reporting failures", async () => {
    const { admin, store } = await setupTestCrm();
    const a = await createRecord(admin, "companies", { name: "A" });
    const b = await createRecord(admin, "companies", { name: "B" });
    const spy = vi.spyOn(store, "write");
    const res = await bulkUpdate(admin, [a.id, b.id, "missing"], { industry: "retail" });
    expect(res.updated).toEqual([a.id, b.id]);
    expect(res.errors[0].id).toBe("missing");
    expect(spy).toHaveBeenCalledTimes(1);
    await bulkDelete(admin, [a.id, b.id]);
    expect(listRecords(admin, "companies").total).toBe(0);
  });

  it("details expand relations both ways; link / unlink", async () => {
    const { admin } = await setupTestCrm();
    const c = await createRecord(admin, "companies", { name: "Acme" });
    const p = await createRecord(admin, "people", { name: "Ada Lovelace" });
    const d = await createRecord(admin, "deals", { name: "Deal", company: c.id });
    await linkRecords(admin, p.id, "company", c.id);
    await linkRecords(admin, d.id, "contacts", p.id);
    const details = getRecordDetails(admin, c.id);
    expect(details.inverse.find((i) => i.object === "people")!.records.map((r) => r.label)).toEqual(["Ada Lovelace"]);
    expect(details.inverse.find((i) => i.object === "deals")!.records).toHaveLength(1);
    expect(getRecordDetails(admin, d.id).relations.contacts.map((r) => r.id)).toEqual([p.id]);
    await unlinkRecords(admin, d.id, "contacts", p.id);
    expect(inverseRelations(admin, p).find((i) => i.object === "deals")!.records).toEqual([]);
    await expect(linkRecords(admin, d.id, "company", p.id)).rejects.toThrow(/expected companies/);
  });

  it("enforces roles", async () => {
    const crm = await setupTestCrm();
    const viewer = crm.as("viewer");
    const member = crm.as("member");
    await expect(createRecord(viewer, "companies", { name: "X" })).rejects.toMatchObject({ code: "forbidden" });
    const c = await createRecord(member, "companies", { name: "X" });
    expect(c.ownerId).toBe("u-member");
    expect(listRecords(viewer, "companies").total).toBe(1);
    expect(searchRecords(viewer, "x").length).toBeGreaterThan(0);
  });
});
