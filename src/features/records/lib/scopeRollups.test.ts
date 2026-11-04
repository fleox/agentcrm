import { describe, expect, it } from "vitest";
import type { CrmRecord, ObjectDef } from "../../../core/types";
import { computeRows, scopeRollups } from "./viewModel";

const operators: ObjectDef = {
  id: "companies",
  labelSingular: "Operator",
  labelPlural: "Operators",
  icon: "Building2",
  color: "blue",
  standard: false,
  labelField: "name",
  createdAt: 1,
  updatedAt: 1,
  fields: [
    { id: "name", label: "Name", type: "text" },
    { id: "markets", label: "Markets", type: "relation", relation: { object: "markets", cardinality: "many" } },
    {
      id: "status",
      label: "Status",
      type: "multiSelect",
      options: [
        { id: "live", label: "Live", color: "green" },
        { id: "closed", label: "Closed", color: "red" },
      ],
      rollup: { object: "presences", via: "operator", field: "statusLabel", scope: { field: "markets", via: "market" }, where: [{ field: "archived", op: "neq", value: true }] },
    },
    { id: "managers", label: "Account Manager", type: "tags", rollup: { object: "presences", via: "operator", field: "am", scope: { field: "markets", via: "market" } } },
  ],
};
const presences: ObjectDef = {
  id: "presences",
  labelSingular: "Presence",
  labelPlural: "Presences",
  icon: "Globe",
  color: "gray",
  standard: false,
  labelField: "name",
  createdAt: 1,
  updatedAt: 1,
  fields: [
    { id: "operator", label: "Operator", type: "relation", relation: { object: "companies", cardinality: "one" } },
    { id: "market", label: "Market", type: "relation", relation: { object: "markets", cardinality: "one" } },
    { id: "statusLabel", label: "Status", type: "text" },
    { id: "am", label: "AM", type: "text" },
    { id: "archived", label: "Archived", type: "boolean" },
  ],
};
const rec = (id: string, object: string, fields: Record<string, unknown>): CrmRecord => ({ id, object, fields, createdAt: 1, updatedAt: 1 });
const records = [
  rec("op1", "companies", { name: "Acme", markets: ["fr", "gb"], status: ["live", "closed"], managers: ["Ann", "Bob"] }),
  rec("op2", "companies", { name: "Bet", markets: ["fr"], status: ["closed"], managers: ["Bob"] }),
];
const all = [
  ...records,
  rec("p1", "presences", { operator: "op1", market: "fr", statusLabel: "Closed", am: "Bob" }),
  rec("p2", "presences", { operator: "op1", market: "gb", statusLabel: "Live", am: "Ann" }),
  rec("p3", "presences", { operator: "op2", market: "fr", statusLabel: "Closed", am: "Bob" }),
  rec("p4", "presences", { operator: "op2", market: "gb", statusLabel: "Live", am: "Cy", archived: true }),
];
const labels: Record<string, string> = { fr: "FR", gb: "GB" };
const qctx = { recordLabel: (_o: string, id: string) => labels[id] };
const objectOf = (id: string) => [operators, presences].find((o) => o.id === id);

describe("scoped rollups", () => {
  it("rolls up the labels of a child select (ids differ from the parent's)", () => {
    const selectChild: ObjectDef = {
      ...presences,
      fields: presences.fields.map((f) => (f.id === "statusLabel" ? { ...f, type: "select" as const, options: [{ id: "opt-live", label: "Live", color: "green" }, { id: "opt-closed", label: "Closed", color: "red" }] } : f)),
    };
    const ids = all.map((r) => (r.object === "presences" ? { ...r, fields: { ...r.fields, statusLabel: r.fields.statusLabel === "Live" ? "opt-live" : "opt-closed" } } : r));
    const out = scopeRollups(records, ids, operators, [{ field: "markets", op: "eq", value: "gb" }], qctx, (id) => (id === "presences" ? selectChild : objectOf(id)));
    expect(out.records[0].fields.status).toEqual(["live"]);
  });

  it("keeps the stored values without a filter on the scope", () => {
    const out = scopeRollups(records, all, operators, [{ field: "name", op: "contains", value: "a" }], qctx, objectOf);
    expect(out.scoped).toEqual([]);
    expect(out.records).toBe(records);
  });

  it("recomputes from the children of the filtered markets only", () => {
    const out = scopeRollups(records, all, operators, [{ field: "markets", op: "eq", value: "gb" }], qctx, objectOf);
    expect(out.scoped).toEqual(["status", "managers"]);
    expect(out.records[0].fields).toMatchObject({ status: ["live"], managers: ["Ann"] });
    // The scope relation shows the filtered markets only.
    expect(out.records[0].fields.markets).toEqual(["gb"]);
    expect(out.records[1].fields.markets).toEqual([]);
    // op2's GB presence is archived (rollup where): nothing in scope.
    expect(out.records[1].fields.status).toBeUndefined();
    expect(out.records[0]).not.toBe(records[0]);
    expect(records[0].fields.status).toEqual(["live", "closed"]);
  });

  it("matches a market by label (contains) and by id list (in)", () => {
    expect(scopeRollups(records, all, operators, [{ field: "markets", op: "contains", value: "fr" }], qctx, objectOf).records[0].fields.status).toEqual(["closed"]);
    expect(scopeRollups(records, all, operators, [{ field: "markets", op: "in", value: ["fr", "gb"] }], qctx, objectOf).records[0].fields.status).toEqual(["live", "closed"]);
  });

  it("lets the other filters see the scoped values (Live in FR)", () => {
    const filters = [
      { field: "markets", op: "eq" as const, value: "fr" },
      { field: "status", op: "in" as const, value: ["live"] },
    ];
    const scoped = scopeRollups(records, all, operators, filters, qctx, objectOf);
    expect(computeRows(scoped.records, operators, { filters, sorts: [], search: "" }, qctx).map((r) => r.id)).toEqual([]);
    const gb = [{ ...filters[0], value: "gb" }, filters[1]];
    expect(computeRows(scopeRollups(records, all, operators, gb, qctx, objectOf).records, operators, { filters: gb, sorts: [], search: "" }, qctx).map((r) => r.id)).toEqual(["op1"]);
  });
});
