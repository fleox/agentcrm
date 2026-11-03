import { describe, expect, it } from "vitest";
import { setupTestCrm } from "./testing";
import { createRecord, listRecords } from "./records";
import { addOption, changeFieldType, createField, createObject, deleteField, deleteObject, describeSchema, removeOption, reorderFields, updateField, updateObject, updateOption } from "./schema";
import { objectOf, recordOf } from "./store";
import { createView } from "./views";

describe("schema ops", () => {
  it("creates custom objects with a label field and default view", async () => {
    const { admin, store } = await setupTestCrm();
    const o = await createObject(admin, { labelSingular: "Project", labelPlural: "Projects", fields: [{ label: "Budget", type: "currency" }] });
    expect(o.id).toBe("projects");
    expect(o.fields.map((f) => f.id)).toEqual(["name", "budget"]);
    expect(store.get("views", "projects-all")).toBeTruthy();
    await expect(createObject(admin, { labelSingular: "Project", labelPlural: "Projects", id: "projects" })).rejects.toMatchObject({ code: "conflict" });
    await expect(createObject(admin, { labelSingular: "X", labelPlural: "Xs" }).then(() => createObject(admin, { labelSingular: "", labelPlural: "" }))).rejects.toThrow(/name/);
    const renamed = await updateObject(admin, "projects", { labelPlural: "Initiatives", icon: "Rocket" });
    expect(renamed).toMatchObject({ labelPlural: "Initiatives", icon: "Rocket" });
  });

  it("adds new visible fields to the default view while it has room", async () => {
    const { admin, store } = await setupTestCrm();
    await createObject(admin, { labelSingular: "Ticket", labelPlural: "Tickets" });
    const columns = () => (store.get("views", "tickets-all") as unknown as { columns: string[] }).columns;
    expect(columns()).toEqual(["name"]);
    await createField(admin, "tickets", { label: "Priority", type: "select", options: ["Low", "High"] });
    await createField(admin, "tickets", { label: "Secret", type: "text", hidden: true });
    await createField(admin, "tickets", { label: "Screenshot", type: "image" });
    expect(columns()).toEqual(["name", "priority"]);
    for (const label of ["A", "B", "C", "D", "E", "F"]) await createField(admin, "tickets", { label, type: "text" });
    expect(columns()).toEqual(["name", "priority", "a", "b", "c", "d", "e"]);
  });

  it("adds fields with generated ids; relation targets must exist", async () => {
    const { admin } = await setupTestCrm();
    const f = await createField(admin, "companies", { label: "Customer since", type: "date" });
    expect(f.id).toBe("customerSince");
    const g = await createField(admin, "companies", { label: "Customer since", type: "date" });
    expect(g.id).toBe("customerSince2");
    const s = await createField(admin, "people", { label: "Tier", type: "select", options: ["Gold", "Silver"] });
    expect(s.options!.map((o) => o.id)).toEqual(["gold", "silver"]);
    await expect(createField(admin, "people", { label: "Proj", type: "relation", relation: { object: "nope", cardinality: "one" } })).rejects.toThrow(/Unknown object/);
    await expect(createField(admin, "people", { label: "X", type: "weird" as never })).rejects.toThrow(/Unknown field type/);
  });

  it("protects system, standard and pipeline fields", async () => {
    const { admin } = await setupTestCrm();
    await expect(deleteField(admin, "deals", "name")).rejects.toThrow(/system/);
    await expect(deleteField(admin, "companies", "industry")).rejects.toThrow(/standard/);
    await expect(changeFieldType(admin, "deals", "stage", "text")).rejects.toThrow(/system/);
    await expect(updateField(admin, "deals", "stage", { options: ["A"] })).rejects.toThrow(/pipeline/);
    await expect(deleteObject(admin, "people")).rejects.toThrow(/standard/);
    const hidden = await updateField(admin, "companies", "industry", { hidden: true, label: "Sector" });
    expect(hidden.field).toMatchObject({ hidden: true, label: "Sector" });
    await expect(updateField(admin, "companies", "name", { hidden: true })).rejects.toThrow(/label field/);
  });

  it("migrates values on type change", async () => {
    const { admin, store } = await setupTestCrm();
    await createField(admin, "companies", { label: "Size", type: "text" });
    const a = await createRecord(admin, "companies", { name: "A", size: "1,500" });
    const b = await createRecord(admin, "companies", { name: "B", size: "big" });
    const res = await changeFieldType(admin, "companies", "size", "number");
    expect(res).toMatchObject({ converted: 1, cleared: 1 });
    expect(recordOf(store, a.id)!.fields.size).toBe(1500);
    expect(recordOf(store, b.id)!.fields).not.toHaveProperty("size");
    // text → select builds options from the distinct values.
    await createField(admin, "companies", { label: "Region", type: "text" });
    await createRecord(admin, "companies", { name: "C", region: "EMEA" });
    await createRecord(admin, "companies", { name: "D", region: "APAC" });
    const sel = await changeFieldType(admin, "companies", "region", "select");
    expect(sel.field.options!.map((o) => o.label).sort()).toEqual(["APAC", "EMEA"]);
    expect(listRecords(admin, "companies", { filters: [{ field: "region", op: "eq", value: "EMEA" }] }).items.map((r) => r.fields.name)).toEqual(["C"]);
  });

  it("edits options and clears / replaces removed values", async () => {
    const { admin, store } = await setupTestCrm();
    const c = await createRecord(admin, "companies", { name: "A", industry: "Media" });
    const opt = await addOption(admin, "companies", "industry", { label: "Gaming", color: "pink" });
    expect(opt).toMatchObject({ id: "gaming", label: "Gaming", color: "pink" });
    await updateOption(admin, "companies", "industry", "gaming", { label: "Video games" });
    expect(objectOf(store, "companies")!.fields.find((f) => f.id === "industry")!.options!.find((o) => o.id === "gaming")!.label).toBe("Video games");
    const res = await removeOption(admin, "companies", "industry", "media", { replaceWith: "gaming" });
    expect(res.moved).toBe(1);
    expect(recordOf(store, c.id)!.fields.industry).toBe("gaming");
  });

  it("deletes custom fields (values + view references) and custom objects (records + inverse fields)", async () => {
    const { admin, store } = await setupTestCrm();
    await createField(admin, "companies", { label: "Score", type: "number" });
    const c = await createRecord(admin, "companies", { name: "A", score: 3 });
    const view = await createView(admin, { object: "companies", name: "Scored", columns: ["name", "score"], sorts: [{ field: "score", dir: "desc" }], shared: true });
    const res = await deleteField(admin, "companies", "score");
    expect(res.cleared).toBe(1);
    expect(recordOf(store, c.id)!.fields).not.toHaveProperty("score");
    expect(store.get("views", view.id)).toMatchObject({ columns: ["name"], sorts: [] });

    await createObject(admin, { labelSingular: "Project", labelPlural: "Projects" });
    await createField(admin, "companies", { label: "Main project", type: "relation", relation: { object: "projects", cardinality: "one" } });
    const p = await createRecord(admin, "projects", { name: "P" });
    await createRecord(admin, "companies", { name: "B", mainProject: p.id });
    const del = await deleteObject(admin, "projects");
    expect(del.records).toBe(1);
    expect(objectOf(store, "companies")!.fields.some((f) => f.id === "mainProject")).toBe(false);
    expect(store.get("views", "projects-all")).toBeUndefined();
  });

  it("reorders fields, describes the schema, requires admin", async () => {
    const crm = await setupTestCrm();
    const o = await reorderFields(crm.admin, "companies", ["tags", "name"]);
    expect(o.fields.slice(0, 3).map((f) => f.id)).toEqual(["tags", "name", "domain"]);
    const schema = describeSchema(crm.admin);
    expect(schema.map((s) => s.id)).toEqual(["companies", "people", "deals"]);
    expect(schema[2].pipelines[0].stages).toHaveLength(6);
    await expect(createField(crm.as("member"), "companies", { label: "X", type: "text" })).rejects.toMatchObject({ code: "forbidden" });
  });
});
