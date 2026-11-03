import { registerExternalTheme } from "../appearance/themes";
import { DEFAULT_APPEARANCE } from "../appearance/schema";
import { fakePackage } from "../extensions/testing";
import { applyPreset, getAppearance, getAppearanceDoc, listPresets, resetAppearance, setAppearance, setLogo } from "./appearance";
import { installExtension } from "./extensions";
import { setupTestCrm } from "./testing";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("ops/appearance", () => {
  it("defaults when nothing is stored; everyone reads", async () => {
    const crm = await setupTestCrm();
    expect(getAppearance(crm.as("viewer"))).toEqual(DEFAULT_APPEARANCE);
    expect(getAppearanceDoc(crm.admin)).toBeUndefined();
  });

  it("merges a validated patch (admin only) and marks it custom", async () => {
    const crm = await setupTestCrm();
    await expect(setAppearance(crm.as("member"), { accent: "#ff0000" })).rejects.toMatchObject({ code: "forbidden" });
    const a = await setAppearance(crm.admin, { accent: "#F00", density: "compact" });
    expect(a).toMatchObject({ accent: "#ff0000", density: "compact", preset: "custom", neutral: "zinc" });
    await setAppearance(crm.admin, { density: null });
    expect(getAppearance(crm.admin).density).toBe("comfortable");
    expect(getAppearanceDoc(crm.admin)).toMatchObject({ accent: "#ff0000", updatedBy: "owner" });
    // Branding / mode changes don't touch the preset.
    await applyPreset(crm.admin, "ocean");
    await setAppearance(crm.admin, { defaultMode: "dark" });
    expect(getAppearance(crm.admin).preset).toBe("ocean");
  });

  it("rejects invalid values with every error", async () => {
    const crm = await setupTestCrm();
    const err = await setAppearance(crm.admin, { accent: "blue", radius: "huge" as never, font: "comic", nope: 1 } as never).catch((e) => e);
    expect(err).toMatchObject({ code: "validation" });
    expect((err.details as string[]).length).toBe(4);
    await expect(setAppearance(crm.admin, { customCss: "x".repeat(60 * 1024) })).rejects.toMatchObject({ code: "validation" });
    await expect(setAppearance(crm.admin, { customCss: "</style><script>alert(1)</script>" })).rejects.toMatchObject({ code: "validation" });
    await expect(setAppearance(crm.admin, { themeId: "ghost" })).rejects.toMatchObject({ code: "notFound" });
    await expect(setAppearance(crm.admin, { preset: "ghost" })).rejects.toMatchObject({ code: "validation" });
  });

  it("applies presets, keeping logo / favicon / custom CSS / default mode", async () => {
    const crm = await setupTestCrm();
    await setLogo(crm.admin, PNG);
    await setAppearance(crm.admin, { customCss: ".x{color:red}", defaultMode: "dark", accent: "#123456" });
    const a = await applyPreset(crm.admin, "forest");
    expect(a).toMatchObject({ preset: "forest", accent: "#16a34a", neutral: "stone", sidebar: "dark", logo: PNG, customCss: ".x{color:red}", defaultMode: "dark" });
    await expect(applyPreset(crm.admin, "nope")).rejects.toMatchObject({ code: "notFound" });
  });

  it("selects an installed theme; its values show under explicit overrides", async () => {
    const crm = await setupTestCrm();
    await installExtension(crm.admin, fakePackage("midnight", { kind: "theme" }));
    const off = registerExternalTheme({ id: "midnight", apiVersion: "1.0.0", name: "Midnight", appearance: { accent: "#8b5cf6", defaultMode: "dark", sidebar: "dark" }, css: ".m{}" });
    try {
      const a = await applyPreset(crm.admin, "midnight");
      expect(a).toMatchObject({ preset: "midnight", themeId: "midnight", accent: "#8b5cf6", defaultMode: "dark", sidebar: "dark" });
      const b = await setAppearance(crm.admin, { accent: "#00ff00" });
      expect(b).toMatchObject({ themeId: "midnight", accent: "#00ff00", sidebar: "dark" });
      const presets = listPresets(crm.admin);
      expect(presets.map((p) => p.id)).toEqual(["default", "ocean", "forest", "sunset", "graphite", "rose", "high-contrast", "midnight"]);
      expect(presets.at(-1)).toMatchObject({ source: "extension", loaded: true, enabled: true, name: "Midnight" });
    } finally {
      off();
    }
    expect(listPresets(crm.admin).at(-1)).toMatchObject({ loaded: false });
  });

  it("validates the logo (image data URL ≤ 200 KB) and resets", async () => {
    const crm = await setupTestCrm();
    await expect(setLogo(crm.admin, "https://example.com/logo.png")).rejects.toMatchObject({ code: "validation" });
    await expect(setLogo(crm.admin, `data:image/png;base64,${"A".repeat(300 * 1024)}`)).rejects.toThrow(/200 KB/);
    await setLogo(crm.admin, PNG, { kind: "favicon" });
    await setLogo(crm.admin, PNG);
    await setAppearance(crm.admin, { accent: "#111111" });
    let a = await resetAppearance(crm.admin);
    expect(a).toEqual({ ...DEFAULT_APPEARANCE, logo: PNG, favicon: PNG });
    a = await resetAppearance(crm.admin, { branding: true });
    expect(a).toEqual(DEFAULT_APPEARANCE);
    expect(getAppearanceDoc(crm.admin)).toBeUndefined();
    await setLogo(crm.admin, PNG);
    expect((await setLogo(crm.admin, null)).logo).toBeUndefined();
  });
});
