import { describe, expect, it } from "vitest";
import { setupTestCrm } from "./testing";
import { applySchema, parseSchemaSpec, type SchemaSpec } from "./schemaApply";
import { listPipelines } from "./pipelines";
import { listObjects, updateField } from "./schema";
import { listViews } from "./views";

const spec: SchemaSpec = {
  objects: [
    {
      id: "companies",
      labelSingular: "Operator",
      labelPlural: "Operators",
      fields: [{ id: "rankingsId", label: "Rankings id", type: "text", unique: true }],
    },
    {
      id: "accounts",
      labelSingular: "Affiliate account",
      labelPlural: "Affiliate accounts",
      icon: "Handshake",
      labelField: "name",
      fields: [
        { id: "name", label: "Account", type: "text" },
        { id: "status", label: "Status", type: "select", options: ["active", "pending", "closed"] },
        { id: "operators", label: "Operators", type: "relation", relation: { object: "companies", cardinality: "many" } },
        { id: "market", label: "Market", type: "relation", relation: { object: "markets", cardinality: "one" } },
      ],
    },
    { id: "markets", labelSingular: "Market", labelPlural: "Markets", fields: [{ id: "regulated", label: "Regulated", type: "boolean" }] },
  ],
  pipelines: [
    {
      id: "partnerships",
      name: "Partnerships",
      object: "deals",
      stages: [
        { id: "prospect", label: "Prospect", probability: 10 },
        { id: "signed", label: "Signed", probability: 100, kind: "won" },
        { id: "dropped", label: "Lost", probability: 0, kind: "lost" },
      ],
    },
  ],
  views: [{ object: "accounts", name: "Pending accounts", columns: ["name", "status"], filters: [{ field: "status", op: "eq", value: "pending" }], shared: true }],
};

describe("schema apply", () => {
  it("creates what is missing, relations to objects created later included", async () => {
    const { admin } = await setupTestCrm();
    const report = await applySchema(admin, parseSchemaSpec(JSON.parse(JSON.stringify(spec))));
    const objects = listObjects(admin);
    expect(objects.find((o) => o.id === "companies")).toMatchObject({ labelPlural: "Operators" });
    const accounts = objects.find((o) => o.id === "accounts")!;
    expect(accounts.fields.map((f) => f.id)).toEqual(expect.arrayContaining(["name", "status", "operators", "market"]));
    expect(accounts.fields.find((f) => f.id === "name")!.label).toBe("Account");
    expect(accounts.fields.find((f) => f.id === "market")!.relation).toMatchObject({ object: "markets", cardinality: "one" });
    expect(listPipelines(admin).find((p) => p.id === "partnerships")!.stages.map((s) => s.id)).toEqual(["prospect", "signed", "dropped"]);
    expect(listViews(admin, "accounts").some((v) => v.name === "Pending accounts")).toBe(true);
    expect(report.conflicts).toEqual([]);
    expect(report.changes.length).toBeGreaterThan(5);
  });

  it("is idempotent: a second apply changes nothing", async () => {
    const { admin } = await setupTestCrm();
    await applySchema(admin, spec);
    const again = await applySchema(admin, spec);
    expect(again.changes).toEqual([]);
  });

  it("adds options and stages, never removes them, reports type conflicts and extra fields", async () => {
    const { admin } = await setupTestCrm();
    await applySchema(admin, spec);
    await updateField(admin, "markets", "regulated", { type: "text" });
    const next: SchemaSpec = JSON.parse(JSON.stringify(spec));
    next.objects![1].fields!.find((f) => f.id === "status")!.options = ["active", "archived"];
    next.objects![1].fields = next.objects![1].fields!.filter((f) => f.id !== "market");
    next.pipelines![0].stages = [{ id: "prospect", label: "Prospect", probability: 10 }, { id: "p-negotiation", label: "Negotiation", probability: 50 }];
    const report = await applySchema(admin, next);
    const status = listObjects(admin).find((o) => o.id === "accounts")!.fields.find((f) => f.id === "status")!;
    expect(status.options!.map((o) => o.label)).toEqual(["active", "pending", "closed", "archived"]);
    expect(listPipelines(admin).find((p) => p.id === "partnerships")!.stages.map((s) => s.id)).toEqual(["prospect", "p-negotiation", "signed", "dropped"]);
    expect(report.conflicts).toEqual([expect.stringMatching(/markets\.regulated: type is text/)]);
    expect(report.extraFields).toContain("accounts.market");
  });

  it("refuses a stage id another pipeline uses (it would be renamed and re-added)", async () => {
    const { admin } = await setupTestCrm();
    const report = await applySchema(admin, { pipelines: [{ id: "p2", name: "P2", object: "deals", stages: [{ id: "negotiation", label: "Negotiation" }] }] });
    expect(report.conflicts).toEqual([expect.stringMatching(/negotiation \(used by sales\)/)]);
    expect(listPipelines(admin).some((p) => p.id === "p2")).toBe(false);
  });

  it("ignores key order in stored view filters (Firestore reorders map keys)", async () => {
    const { admin } = await setupTestCrm();
    await applySchema(admin, spec);
    const view = listViews(admin, "accounts").find((v) => v.name === "Pending accounts")!;
    await admin.store.write([{ op: "patch", collection: "views", id: view.id, fields: { filters: [{ value: "pending", op: "eq", field: "status" }] } }]);
    expect((await applySchema(admin, spec)).changes).toEqual([]);
  });

  it("sets a URL field as the record image (logo hosted elsewhere)", async () => {
    const { admin } = await setupTestCrm();
    const withLogo: SchemaSpec = { objects: [{ id: "companies", labelSingular: "Company", labelPlural: "Companies", imageField: "logoUrl", fields: [{ id: "logoUrl", label: "Logo URL", type: "url" }] }] };
    expect((await applySchema(admin, withLogo)).changes.map((c) => c.changes)).toContainEqual(["imageField"]);
    expect(listObjects(admin).find((o) => o.id === "companies")!.imageField).toBe("logoUrl");
    expect((await applySchema(admin, withLogo)).changes).toEqual([]);
    const { createRecord } = await import("./records");
    const { recordImageId } = await import("./files");
    const r = await createRecord(admin, "companies", { name: "Acme", logoUrl: "https://cdn.example.com/acme.webp" });
    expect(recordImageId(admin, r)).toBeUndefined(); // a URL is not a stored file
  });

  it("links a count to the related list (drilldown), idempotent, target checked", async () => {
    const { admin } = await setupTestCrm();
    const withCount: SchemaSpec = {
      objects: [
        { id: "markets", labelSingular: "Market", labelPlural: "Markets", fields: [{ id: "operatorCount", label: "Operators", type: "number", drilldown: { object: "companies", field: "markets" } }] },
        { id: "companies", labelSingular: "Operator", labelPlural: "Operators", fields: [{ id: "markets", label: "Markets", type: "relation", relation: { object: "markets", cardinality: "many" } }] },
      ],
    };
    await applySchema(admin, withCount);
    const count = listObjects(admin).find((o) => o.id === "markets")!.fields.find((f) => f.id === "operatorCount")!;
    expect(count.drilldown).toEqual({ object: "companies", field: "markets" });
    expect((await applySchema(admin, withCount)).changes).toEqual([]);
    const broken: SchemaSpec = JSON.parse(JSON.stringify(withCount));
    broken.objects![0].fields![0].drilldown = { object: "companies", field: "name" };
    await expect(applySchema(admin, broken)).rejects.toThrow(/no relation field "name"/);
  });

  it("sets a rollup scoped on a relation, idempotent, fields checked", async () => {
    const { admin } = await setupTestCrm();
    const rollup = { object: "presences", via: "operator", field: "status", scope: { field: "markets", via: "market" } };
    const withRollup: SchemaSpec = {
      objects: [
        { id: "companies", labelSingular: "Operator", labelPlural: "Operators", fields: [{ id: "markets", label: "Markets", type: "relation", relation: { object: "markets", cardinality: "many" } }, { id: "igmStatus", label: "Status", type: "tags", rollup }] },
        { id: "markets", labelSingular: "Market", labelPlural: "Markets", fields: [] },
        {
          id: "presences",
          labelSingular: "Presence",
          labelPlural: "Presences",
          fields: [
            { id: "operator", label: "Operator", type: "relation", relation: { object: "companies", cardinality: "one" } },
            { id: "market", label: "Market", type: "relation", relation: { object: "markets", cardinality: "one" } },
            { id: "status", label: "Status", type: "text" },
          ],
        },
      ],
    };
    await applySchema(admin, withRollup);
    expect(listObjects(admin).find((o) => o.id === "companies")!.fields.find((f) => f.id === "igmStatus")!.rollup).toEqual(rollup);
    expect((await applySchema(admin, withRollup)).changes).toEqual([]);
    const broken: SchemaSpec = JSON.parse(JSON.stringify(withRollup));
    broken.objects![0].fields![1].rollup = { ...rollup, scope: { field: "markets", via: "operator" } };
    await expect(applySchema(admin, broken)).rejects.toThrow(/must be relations to the same object/);
  });

  it("recolours an existing option given as { label, color }, values kept", async () => {
    const { admin } = await setupTestCrm();
    const prio = (color: string): SchemaSpec => ({ objects: [{ id: "companies", labelSingular: "Company", labelPlural: "Companies", fields: [{ id: "prio", label: "Prio", type: "select", options: ["low", { label: "high", color }] }] }] });
    await applySchema(admin, prio("blue"));
    const id = () => listObjects(admin).find((o) => o.id === "companies")!.fields.find((f) => f.id === "prio")!.options!;
    const highId = id().find((o) => o.label === "high")!.id;
    const report = await applySchema(admin, prio("red"));
    expect(report.changes.map((c) => c.changes)).toContainEqual(["colors high"]);
    expect(id().find((o) => o.label === "high")).toMatchObject({ id: highId, color: "red" });
    expect((await applySchema(admin, prio("red"))).changes).toEqual([]);
  });

  it("rejects an object without id", () => {
    expect(() => parseSchemaSpec({ objects: [{ labelSingular: "X", labelPlural: "Xs" }] })).toThrow(/needs id/);
  });
});
