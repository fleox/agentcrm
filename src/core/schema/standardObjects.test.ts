import { describe, expect, it } from "vitest";
import { defaultPipeline, defaultViews, normalizeStandardFields, standardObjects, stageOptions } from "./standardObjects";

describe("standard objects", () => {
  const objects = standardObjects(1);

  it("defines companies, people and deals with the contract fields", () => {
    const byId = Object.fromEntries(objects.map((o) => [o.id, o.fields.map((f) => f.id)]));
    expect(byId.companies).toEqual(["name", "domain", "industry", "employees", "annualRevenue", "address", "linkedin", "phone", "tags", "logo"]);
    expect(byId.people).toEqual(["firstName", "lastName", "name", "email", "phone", "jobTitle", "company", "city", "linkedin", "lifecycleStage", "leadSource", "tags", "avatar"]);
    expect(byId.deals).toEqual(["name", "amount", "stage", "pipeline", "closeDate", "probability", "company", "contacts", "lostReason"]);
    for (const o of objects) expect(o.fields.some((f) => f.id === o.labelField)).toBe(true);
    // Record avatars (0.3.0).
    expect(objects.find((o) => o.id === "people")?.imageField).toBe("avatar");
    expect(objects.find((o) => o.id === "companies")?.imageField).toBe("logo");
  });

  it("has the Sales pipeline and its stages as deal stage options", () => {
    const p = defaultPipeline();
    expect(p.stages.map((s) => s.label)).toEqual(["New", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]);
    expect(p.stages.filter((s) => s.kind !== "open").map((s) => s.id)).toEqual(["won", "lost"]);
    const deals = objects.find((o) => o.id === "deals")!;
    expect(deals.fields.find((f) => f.id === "stage")!.options).toEqual(stageOptions([p]));
    expect(new Set(deals.fields.find((f) => f.id === "people")?.options ?? []).size).toBe(0);
  });

  it("views reference existing fields", () => {
    for (const v of defaultViews()) {
      const o = objects.find((x) => x.id === v.object)!;
      for (const c of v.columns) expect(o.fields.some((f) => f.id === c)).toBe(true);
      if (v.groupBy) expect(o.fields.some((f) => f.id === v.groupBy)).toBe(true);
    }
  });

  it("derives person names both ways and company names from domains", () => {
    expect(normalizeStandardFields("people", { firstName: "Ada", lastName: "Lovelace" }, null).name).toBe("Ada Lovelace");
    expect(normalizeStandardFields("people", { name: "Grace Brewster Hopper" }, null)).toMatchObject({ firstName: "Grace", lastName: "Brewster Hopper" });
    const prev = { firstName: "Ada", lastName: "Lovelace", name: "Ada Lovelace" };
    expect(normalizeStandardFields("people", { ...prev, lastName: "King" }, prev).name).toBe("Ada King");
    const custom = { firstName: "Ada", lastName: "Lovelace", name: "Countess" };
    expect(normalizeStandardFields("people", { ...custom, lastName: "King" }, custom).name).toBe("Countess");
    expect(normalizeStandardFields("companies", { domain: "https://www.acme.com" }, null).name).toBe("Acme");
  });
});
