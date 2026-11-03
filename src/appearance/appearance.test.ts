import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contrastRatio, generateScale, hexToOklch, normalizeHex, oklchToHex, SCALE_STEPS } from "./color";
import { appearanceVars, computeAppearanceCss } from "./css";
import { buildAppearanceCache } from "./apply";
import { googleFontHref } from "./fonts";
import { DEFAULT_ACCENT_SCALE, NEUTRAL_SCALES } from "./palettes";
import { PRESETS } from "./presets";
import { DEFAULT_APPEARANCE, resolveAppearance, validateAppearancePatch } from "./schema";

const root = resolve(__dirname, "../..");

describe("color", () => {
  it("round-trips hex ↔ OKLCH", () => {
    for (const hex of ["#3366ff", "#16a34a", "#ea580c", "#000000", "#ffffff", "#7c3aed"]) expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
  });

  it("generates a monotonic scale whose 500 is the input", () => {
    for (const hex of ["#0891b2", "#e11d48", "#facc15", "#52525b"]) {
      const scale = generateScale(hex);
      expect(scale[500]).toBe(hex);
      const l = SCALE_STEPS.map((s) => hexToOklch(scale[s]).l);
      for (let i = 1; i < l.length; i++) expect(l[i]).toBeLessThan(l[i - 1]);
      expect(contrastRatio(scale[50], scale[950])).toBeGreaterThan(8);
    }
  });
});

describe("css", () => {
  it("the default appearance reproduces the CSS defaults of src/index.css (visual equivalence)", () => {
    const css = readFileSync(resolve(root, "src/index.css"), "utf8");
    const block = /:root \{([\s\S]*?)\}/.exec(css)![1];
    const defaults = Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
    const vars = appearanceVars(DEFAULT_APPEARANCE);
    for (const [k, v] of Object.entries(vars)) {
      if (k.startsWith("--primary")) continue;
      expect(defaults[k], k).toBe(v.replace(/"Segoe UI"/, '"Segoe UI"'));
    }
    // The pre-v0.2 Tailwind palette.
    expect(NEUTRAL_SCALES.zinc[500]).toBe("#71717a");
    expect(DEFAULT_ACCENT_SCALE[500]).toBe("#3366ff");
  });

  it("compiles attributes, radius, density, font and button styles", () => {
    const out = computeAppearanceCss({ ...DEFAULT_APPEARANCE, accent: "#16a34a", radius: "xl", density: "compact", font: "inter", buttons: "accent", contrast: "high", sidebar: "dark" });
    expect(out.attrs).toEqual({ "data-density": "compact", "data-sidebar": "dark", "data-contrast": "high", "data-buttons": "accent", "data-radius": "xl" });
    expect(out.css).toContain("--radius-scale:1.75");
    expect(out.css).toContain("--row-h:1.75rem");
    expect(out.css).toContain("--primary:var(--acc-600)");
    expect(out.css).toContain("html:root.dark");
    expect(out.css).toContain(`--acc-500:22 163 74`);
    expect(out.fontHref).toBe("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");
    expect(googleFontHref("system")).toBeNull();
    expect(googleFontHref("ibm-plex-sans")).toContain("family=IBM+Plex+Sans");
  });

  it("caches what the anti-FOUC script of index.html applies", () => {
    const cache = buildAppearanceCache({ ...DEFAULT_APPEARANCE, customCss: ".a{}", favicon: "data:image/png;base64,AA==", defaultMode: "dark" }, { id: "t", apiVersion: "1.0.0", name: "T", appearance: {}, css: ".theme{}" });
    expect(cache).toMatchObject({ v: 1, customCss: ".a{}", themeCss: ".theme{}", favicon: "data:image/png;base64,AA==", defaultMode: "dark", fontHref: null });
    const html = readFileSync(resolve(root, "index.html"), "utf8");
    for (const key of ['"agentcrm.appearance"', "cache.css", "cache.attrs", "cache.fontHref", "cache.themeCss", "cache.customCss", "cache.favicon", "cache.defaultMode", "agentcrm-custom-css", "agentcrm-appearance"]) expect(html).toContain(key);
  });
});

describe("schema", () => {
  it("validates and normalises patches", () => {
    expect(validateAppearancePatch({ accent: "#ABCDEF", neutral: "slate", logo: "" })).toEqual({ value: { accent: "#abcdef", neutral: "slate", logo: undefined }, errors: [] });
    expect(validateAppearancePatch({ sidebar: "purple" }).errors).toHaveLength(1);
    expect(validateAppearancePatch(null).errors).toHaveLength(1);
  });

  it("resolves defaults ← theme ← stored, ignoring invalid stored values", () => {
    const a = resolveAppearance({ accent: "#00ff00", radius: "bogus" as never }, { appearance: { accent: "#ff0000", neutral: "slate", logo: "data:image/png;base64,AA==" } });
    expect(a).toMatchObject({ accent: "#00ff00", neutral: "slate", radius: "md" });
    expect(a.logo).toBeUndefined();
  });

  it("presets are complete and valid", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["default", "ocean", "forest", "sunset", "graphite", "rose", "high-contrast"]);
    for (const p of PRESETS) {
      expect(validateAppearancePatch(p.values).errors, p.id).toEqual([]);
      expect(Object.keys(p.values).sort(), p.id).toEqual(["accent", "buttons", "contrast", "density", "font", "neutral", "radius", "sidebar"]);
    }
  });
});
