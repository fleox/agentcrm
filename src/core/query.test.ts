import { describe, expect, it } from "vitest";
import { applyFilters, applySorts, groupRecords, matchesFilter, paginate } from "./query";
import { dealsObject, peopleObject } from "./schema/standardObjects";
import type { CrmRecord } from "./types";

const now = new Date(2024, 5, 15, 12).getTime();
const deals = dealsObject(0);
const people = peopleObject(0);

function deal(id: string, fields: Record<string, unknown>, extra: Partial<CrmRecord> = {}): CrmRecord {
  return { id, object: "deals", fields, createdAt: now, updatedAt: now, ...extra };
}

const records = [
  deal("d1", { name: "Big Acme", amount: 50000, stage: "proposal", closeDate: "2024-06-20", company: "c1", contacts: ["p1", "p2"] }),
  deal("d2", { name: "Small Globex", amount: 5000, stage: "won", closeDate: "2024-05-01", company: "c2" }),
  deal("d3", { name: "Initech renewal", amount: 12000, stage: "new", closeDate: "2024-09-01" }, { ownerId: "u1" }),
  deal("d4", { name: "No amount", stage: "lost" }),
];
const labels: Record<string, string> = { c1: "Acme Corp", c2: "Globex", p1: "Ada", p2: "Bob" };
const ctx = { object: deals, now, recordLabel: (_o: string, id: string) => labels[id] };

const ids = (rs: CrmRecord[]) => rs.map((r) => r.id);

describe("filters", () => {
  it("eq / neq on select by id or label, and text case-insensitively", () => {
    expect(ids(applyFilters(records, [{ field: "stage", op: "eq", value: "Won" }], ctx))).toEqual(["d2"]);
    expect(ids(applyFilters(records, [{ field: "stage", op: "neq", value: "won" }], ctx))).toEqual(["d1", "d3", "d4"]);
    expect(ids(applyFilters(records, [{ field: "name", op: "eq", value: "big acme" }], ctx))).toEqual(["d1"]);
  });

  it("contains on text and on relation labels", () => {
    expect(ids(applyFilters(records, [{ field: "name", op: "contains", value: "glob" }], ctx))).toEqual(["d2"]);
    expect(ids(applyFilters(records, [{ field: "company", op: "contains", value: "acme" }], ctx))).toEqual(["d1"]);
    expect(ids(applyFilters(records, [{ field: "contacts", op: "eq", value: "p2" }], ctx))).toEqual(["d1"]);
    expect(ids(applyFilters(records, [{ field: "name", op: "notContains", value: "acme" }], ctx))).toEqual(["d2", "d3", "d4"]);
  });

  it("numeric comparisons, empties, in / notIn", () => {
    expect(ids(applyFilters(records, [{ field: "amount", op: "gte", value: 12000 }], ctx))).toEqual(["d1", "d3"]);
    expect(ids(applyFilters(records, [{ field: "amount", op: "lt", value: "10k" }], ctx))).toEqual(["d2"]);
    expect(ids(applyFilters(records, [{ field: "amount", op: "empty" }], ctx))).toEqual(["d4"]);
    expect(ids(applyFilters(records, [{ field: "company", op: "notEmpty" }], ctx))).toEqual(["d1", "d2"]);
    expect(ids(applyFilters(records, [{ field: "stage", op: "in", value: ["new", "Lost"] }], ctx))).toEqual(["d3", "d4"]);
    expect(ids(applyFilters(records, [{ field: "stage", op: "notIn", value: ["new", "lost"] }], ctx))).toEqual(["d1", "d2"]);
  });

  it("dates: before / after / withinDays / eq same day / relative tokens", () => {
    expect(ids(applyFilters(records, [{ field: "closeDate", op: "before", value: "2024-06-01" }], ctx))).toEqual(["d2"]);
    expect(ids(applyFilters(records, [{ field: "closeDate", op: "after", value: "today" }], ctx))).toEqual(["d1", "d3"]);
    expect(ids(applyFilters(records, [{ field: "closeDate", op: "withinDays", value: 30 }], ctx))).toEqual(["d1"]);
    expect(ids(applyFilters(records, [{ field: "closeDate", op: "withinDays", value: -60 }], ctx))).toEqual(["d2"]);
    expect(ids(applyFilters(records, [{ field: "closeDate", op: "eq", value: "2024-06-20" }], ctx))).toEqual(["d1"]);
    expect(ids(applyFilters(records, [{ field: "closeDate", op: "after", value: "+30d" }], ctx))).toEqual(["d3"]);
  });

  it("system props and unknown fields", () => {
    expect(ids(applyFilters(records, [{ field: "ownerId", op: "eq", value: "u1" }], ctx))).toEqual(["d3"]);
    expect(matchesFilter(records[0], { field: "deletedField", op: "eq", value: 1 }, ctx)).toBe(true);
  });

  it("multiSelect / tags contain", () => {
    const p: CrmRecord = { id: "p", object: "people", fields: { tags: ["VIP", "partner"], lifecycleStage: "lead" }, createdAt: 0, updatedAt: 0 };
    expect(matchesFilter(p, { field: "tags", op: "eq", value: "vip" }, { object: people })).toBe(true);
    expect(matchesFilter(p, { field: "tags", op: "contains", value: "part" }, { object: people })).toBe(true);
  });
});

describe("sorts and pagination", () => {
  it("sorts numbers, puts empties last, follows select option order", () => {
    expect(ids(applySorts(records, [{ field: "amount", dir: "desc" }], ctx))).toEqual(["d1", "d3", "d2", "d4"]);
    expect(ids(applySorts(records, [{ field: "amount", dir: "asc" }], ctx))).toEqual(["d2", "d3", "d1", "d4"]);
    expect(ids(applySorts(records, [{ field: "stage", dir: "asc" }], ctx))).toEqual(["d3", "d1", "d2", "d4"]);
    expect(ids(applySorts(records, [{ field: "company", dir: "asc" }], ctx))).toEqual(["d1", "d2", "d3", "d4"]);
  });

  it("paginates", () => {
    const page = paginate([1, 2, 3, 4, 5], { offset: 2, limit: 2 });
    expect(page).toEqual({ items: [3, 4], total: 5, offset: 2, limit: 2, hasMore: true });
    expect(paginate([1, 2], {}).hasMore).toBe(false);
  });

  it("groups by select in option order", () => {
    const groups = groupRecords(records, deals.fields.find((f) => f.id === "stage")!);
    expect([...groups.keys()]).toEqual(["new", "qualified", "proposal", "negotiation", "won", "lost"]);
    expect(groups.get("won")!.map((r) => r.id)).toEqual(["d2"]);
  });
});
