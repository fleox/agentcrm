import { describe, expect, it } from "vitest";
import { defaultCurrencyFor, localizeObjects, localizePipeline } from "./localize";
import { defaultPipeline, standardObjects } from "./standardObjects";

describe("schema localisation", () => {
  it("translates labels for French and keeps ids", () => {
    const objects = localizeObjects(standardObjects(0), "fr-FR");
    const deals = objects.find((o) => o.id === "deals")!;
    expect(deals.labelPlural).toBe("Affaires");
    expect(deals.fields.find((f) => f.id === "amount")!.label).toBe("Montant");
    const stage = deals.fields.find((f) => f.id === "stage")!;
    expect(stage.options!.find((o) => o.id === "won")!.label).toBe("Gagné");
    const industry = objects.find((o) => o.id === "companies")!.fields.find((f) => f.id === "industry")!;
    expect(industry.options!.find((o) => o.id === "real-estate")!.label).toBe("Immobilier");
    expect(localizePipeline(defaultPipeline(), "fr").stages.map((s) => s.id)).toEqual(defaultPipeline().stages.map((s) => s.id));
  });

  it("leaves unknown locales untouched", () => {
    expect(localizeObjects(standardObjects(0), "en")).toEqual(standardObjects(0));
    expect(localizeObjects(standardObjects(0), undefined)).toEqual(standardObjects(0));
  });

  it("suggests a currency from the locale", () => {
    expect(defaultCurrencyFor("fr-FR")).toBe("EUR");
    expect(defaultCurrencyFor("fr-CA")).toBe("CAD");
    expect(defaultCurrencyFor("en-US")).toBe("USD");
  });
});
