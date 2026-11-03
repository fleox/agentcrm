import { describe, expect, it } from "vitest";
import {
  coerceFieldValue,
  comparableValue,
  convertValue,
  defaultFieldValues,
  formatFieldValue,
  isEmptyFieldValue,
  normalizeDomain,
  parseDateValue,
  parseNumber,
  recordLabel,
  validateRecordFields,
} from "./fields";
import type { FieldDef } from "./types";
import { companiesObject, dealsObject, peopleObject } from "./schema/standardObjects";

const field = (type: FieldDef["type"], extra: Partial<FieldDef> = {}): FieldDef => ({ id: "f", label: "F", type, ...extra });
const select = field("select", {
  options: [
    { id: "a", label: "Alpha", color: "blue" },
    { id: "b", label: "Beta", color: "red" },
  ],
});

describe("parseNumber", () => {
  it.each([
    ["1,234.5", 1234.5],
    ["1.234,5", 1234.5],
    ["1 234,56 €", 1234.56],
    ["$1,000", 1000],
    ["12,5", 12.5],
    ["12k", 12000],
    ["-3", -3],
    ["45%", 45],
  ])("%s → %d", (input, expected) => expect(parseNumber(input)).toBe(expected));

  it("rejects junk", () => {
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("")).toBeNull();
    expect(parseNumber(NaN)).toBeNull();
  });
});

describe("parseDateValue", () => {
  it("handles ISO, slashes and datetimes", () => {
    expect(parseDateValue("2024-03-05")).toBe("2024-03-05");
    expect(parseDateValue("03/05/2024")).toBe("2024-03-05");
    expect(parseDateValue("03/05/2024", { dayFirst: true })).toBe("2024-05-03");
    expect(parseDateValue("25/12/2024")).toBe("2024-12-25");
    expect(parseDateValue("2024-03-05T23:30:00Z")).toBe("2024-03-05");
    expect(parseDateValue("2024-02-30")).toBeNull();
    expect(parseDateValue("not a date")).toBeNull();
  });
});

describe("coerceFieldValue", () => {
  it("normalises emails, urls, phones", () => {
    expect(coerceFieldValue(field("email"), " Ada@Example.COM ")).toEqual({ ok: true, value: "ada@example.com" });
    expect(coerceFieldValue(field("email"), "nope").ok).toBe(false);
    expect(coerceFieldValue(field("url"), "acme.com")).toEqual({ ok: true, value: "https://acme.com" });
    expect(coerceFieldValue(field("url"), "https://acme.com/about/")).toEqual({ ok: true, value: "https://acme.com/about" });
    expect(coerceFieldValue(field("url"), "not a url").ok).toBe(false);
    expect(coerceFieldValue(field("phone"), "+33 1 23 45 67 89")).toEqual({ ok: true, value: "+33 1 23 45 67 89" });
    expect(coerceFieldValue(field("phone"), "call me").ok).toBe(false);
  });

  it("maps select labels to ids and validates options", () => {
    expect(coerceFieldValue(select, "beta")).toEqual({ ok: true, value: "b" });
    expect(coerceFieldValue(select, "a")).toEqual({ ok: true, value: "a" });
    expect(coerceFieldValue(select, "Gamma")).toMatchObject({ ok: false, code: "unknownOption" });
    expect(coerceFieldValue(select, "Gamma", { unknownOptions: "keep" })).toEqual({ ok: true, value: "Gamma" });
    const multi = { ...select, type: "multiSelect" as const };
    expect(coerceFieldValue(multi, "Alpha, beta, alpha")).toEqual({ ok: true, value: ["a", "b"] });
  });

  it("handles numbers, percent, rating, boolean, tags", () => {
    expect(coerceFieldValue(field("currency"), "€ 1.500,00")).toEqual({ ok: true, value: 1500 });
    expect(coerceFieldValue(field("percent"), 0.45)).toEqual({ ok: true, value: 45 });
    expect(coerceFieldValue(field("percent"), "45%")).toEqual({ ok: true, value: 45 });
    expect(coerceFieldValue(field("rating"), "4")).toEqual({ ok: true, value: 4 });
    expect(coerceFieldValue(field("rating"), 9).ok).toBe(false);
    expect(coerceFieldValue(field("boolean"), "oui")).toEqual({ ok: true, value: true });
    expect(coerceFieldValue(field("boolean"), "no")).toEqual({ ok: true, value: false });
    expect(coerceFieldValue(field("boolean"), "maybe").ok).toBe(false);
    expect(coerceFieldValue(field("tags"), "vip; VIP, partner")).toEqual({ ok: true, value: ["vip", "partner"] });
  });

  it("handles relations, users, addresses, dates and empties", () => {
    const one = field("relation", { relation: { object: "companies", cardinality: "one" } });
    const many = field("relation", { relation: { object: "people", cardinality: "many" } });
    expect(coerceFieldValue(one, "abc123")).toEqual({ ok: true, value: "abc123" });
    expect(coerceFieldValue(one, ["a1", "b2"]).ok).toBe(false);
    expect(coerceFieldValue(many, "a1,b2,a1")).toEqual({ ok: true, value: ["a1", "b2"] });
    expect(coerceFieldValue(field("user"), "u_1")).toEqual({ ok: true, value: "u_1" });
    expect(coerceFieldValue(field("address"), { city: " Paris ", country: "" })).toEqual({ ok: true, value: { city: "Paris" } });
    expect(coerceFieldValue(field("date"), "2024-01-02")).toEqual({ ok: true, value: "2024-01-02" });
    expect(coerceFieldValue(field("datetime"), "2024-01-02T10:00:00Z")).toEqual({ ok: true, value: Date.parse("2024-01-02T10:00:00Z") });
    expect(coerceFieldValue(field("text"), "  ")).toEqual({ ok: true, value: undefined });
    expect(coerceFieldValue(field("text"), { a: 1 }).ok).toBe(false);
  });
});

describe("validateRecordFields", () => {
  const deals = dealsObject(0);
  it("reports required, unknown and invalid fields", () => {
    const res = validateRecordFields(deals, { amount: "abc", nope: 1 });
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.code).sort()).toEqual(["invalidNumber", "required", "unknownField"]);
  });

  it("partial mode only checks provided keys", () => {
    expect(validateRecordFields(deals, { amount: "1000" }, { partial: true })).toEqual({ ok: true, values: { amount: 1000 }, errors: [] });
    expect(validateRecordFields(deals, { name: "" }, { partial: true }).errors[0].code).toBe("required");
  });

  it("drops unknown fields on request and fills defaults", () => {
    expect(validateRecordFields(deals, { name: "X", zzz: 1 }, { unknownFields: "drop" }).ok).toBe(true);
    expect(defaultFieldValues(deals)).toEqual({ stage: "new", pipeline: "sales" });
    expect(defaultFieldValues(peopleObject(0))).toEqual({ lifecycleStage: "lead" });
  });
});

describe("display", () => {
  it("formats values per type", () => {
    expect(formatFieldValue(field("currency", { currency: "EUR" }), 1500, { locale: "en-US" })).toBe("€1,500");
    expect(formatFieldValue(select, "b")).toBe("Beta");
    expect(formatFieldValue(field("boolean"), false)).toBe("No");
    expect(formatFieldValue(field("rating"), 3)).toBe("★★★");
    expect(formatFieldValue(field("address"), { street: "1 rue X", postalCode: "75001", city: "Paris", country: "France" })).toBe("1 rue X, 75001 Paris, France");
    const rel = field("relation", { relation: { object: "companies", cardinality: "many" } });
    expect(formatFieldValue(rel, ["c1", "c2"], { recordLabel: (_o, id) => (id === "c1" ? "Acme" : undefined) })).toBe("Acme, c2");
    expect(formatFieldValue(field("date"), "2024-03-05", { locale: "en-US" })).toBe("Mar 5, 2024");
    expect(formatFieldValue(field("text"), undefined)).toBe("");
  });

  it("empty checks and comparables", () => {
    expect(isEmptyFieldValue(field("boolean"), false)).toBe(false);
    expect(isEmptyFieldValue(field("tags"), [])).toBe(true);
    expect(isEmptyFieldValue(field("address"), { city: "" })).toBe(true);
    expect(comparableValue(select, "b")).toBe(1);
    expect(comparableValue(field("date"), "2024-01-01")).toBe(new Date(2024, 0, 1).getTime());
  });

  it("record labels and domains", () => {
    const people = peopleObject(0);
    expect(recordLabel(people, { id: "x1234", fields: { firstName: "Ada", lastName: "Lovelace" } })).toBe("Ada Lovelace");
    expect(recordLabel(companiesObject(0), { id: "x1234", fields: {} })).toBe("Company 1234");
    expect(normalizeDomain("https://www.Acme.com/about?x")).toBe("acme.com");
    expect(normalizeDomain("ada@acme.io")).toBe("acme.io");
  });
});

describe("convertValue", () => {
  it("migrates between types when possible", () => {
    expect(convertValue(field("text"), field("number"), "1,500")).toBe(1500);
    expect(convertValue(field("text"), field("number"), "abc")).toBeUndefined();
    expect(convertValue(select, field("text"), "a")).toBe("Alpha");
    expect(convertValue(field("text"), select, "beta")).toBe("b");
    expect(convertValue({ ...select, type: "multiSelect" }, field("tags"), ["a", "b"])).toEqual(["Alpha", "Beta"]);
    expect(convertValue(field("datetime"), field("date"), new Date(2024, 0, 2, 10).getTime())).toBe("2024-01-02");
  });
});
