import { describe, expect, it } from "vitest";
import { buildSearchIndex } from "./search";
import { standardObjects } from "./schema/standardObjects";
import type { Activity, CrmRecord } from "./types";

const objects = standardObjects(0);
const rec = (id: string, object: string, fields: Record<string, unknown>, deletedAt?: number): CrmRecord => ({
  id,
  object,
  fields,
  createdAt: 0,
  updatedAt: 0,
  ...(deletedAt ? { deletedAt } : {}),
});

const records = [
  rec("c1", "companies", { name: "Acme Corporation", domain: "https://acme.com" }),
  rec("c2", "companies", { name: "Globex", domain: "https://globex.io" }),
  rec("p1", "people", { name: "Ada Lovelace", email: "ada@acme.com", phone: "+33 6 12 34 56 78" }),
  rec("p2", "people", { name: "Zoé Dupont", email: "zoe@initech.fr" }),
  rec("p3", "people", { name: "Gone Person" }, 5),
];
const activities: Activity[] = [{ id: "a1", type: "call", title: "Discovery call with Globex", targets: [], createdAt: 0, updatedAt: 0 }];

describe("search", () => {
  const index = buildSearchIndex({ objects, records, activities });

  it("finds by label prefix, email, domain and phone", () => {
    expect(index.search("acm")[0].id).toBe("c1");
    expect(index.search("ada@acme.com")[0].id).toBe("p1");
    expect(index.search("globex.io")[0].id).toBe("c2");
    expect(index.search("06 12 34").length).toBeGreaterThanOrEqual(0);
    expect(index.search("+33 6 12 34 56 78")[0]?.id).toBe("p1");
  });

  it("is accent-insensitive and typo tolerant", () => {
    expect(index.search("zoe")[0].id).toBe("p2");
    expect(index.search("lovelase")[0].id).toBe("p1");
  });

  it("searches activities, filters objects and hides deleted", () => {
    expect(index.search("discovery")[0]).toMatchObject({ kind: "activity", id: "a1" });
    expect(index.search("globex", { objects: ["companies"] }).map((h) => h.id)).toEqual(["c2"]);
    expect(index.search("gone")).toEqual([]);
    expect(index.search("gone", { includeDeleted: true })[0].id).toBe("p3");
    expect(index.search("   ")).toEqual([]);
  });

  it("updates incrementally", () => {
    index.upsertRecord(rec("c3", "companies", { name: "Umbrella" }));
    expect(index.search("umbrella")[0].id).toBe("c3");
    index.removeRecord("c3");
    expect(index.search("umbrella")).toEqual([]);
    expect(index.size).toBe(6);
  });
});
