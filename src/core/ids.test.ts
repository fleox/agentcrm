import { describe, expect, it } from "vitest";
import { isId, newId, seededId, slugId } from "./ids";

describe("ids", () => {
  it("are short and sortable by time", () => {
    const a = newId(1_000_000);
    const b = newId(2_000_000);
    expect(a).toHaveLength(16);
    expect(a < b).toBe(true);
    expect(isId(a)).toBe(true);
  });

  it("stay sorted within the same millisecond", () => {
    const ids = Array.from({ length: 50 }, () => newId(5_000_000));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(50);
  });

  it("seeded ids are deterministic", () => {
    expect(seededId("company-1")).toBe(seededId("company-1"));
    expect(seededId("company-1")).not.toBe(seededId("company-2"));
    expect(seededId("x")).toHaveLength(14);
  });

  it("slugId avoids taken ids", () => {
    expect(slugId("Lead Source")).toBe("lead-source");
    expect(slugId("Équipe", ["equipe"])).toBe("equipe-2");
  });
});
