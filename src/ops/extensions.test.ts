import { fakePackage } from "../extensions/testing";
import { applyPreset } from "./appearance";
import { getExtension, getExtensionPackage, installExtension, listExtensions, setExtensionEnabled, uninstallExtension } from "./extensions";
import { setModuleEnabled } from "./modules";
import { setupTestCrm } from "./testing";

describe("ops/extensions", () => {
  it("installs a package (admin only) and lists it without the code", async () => {
    const crm = await setupTestCrm();
    await expect(installExtension(crm.as("member"), fakePackage("hello-module"))).rejects.toMatchObject({ code: "forbidden" });
    const res = await installExtension(crm.admin, fakePackage("hello-module"));
    expect(res).toEqual({ id: "hello-module", kind: "module", version: "1.0.0", mode: "install", enabled: true, warnings: [] });
    const [summary] = listExtensions(crm.as("viewer"));
    expect(summary).toMatchObject({ id: "hello-module", name: "Hello Module", enabled: true, compatible: true, installedBy: "owner" });
    expect(summary).not.toHaveProperty("files");
    expect(summary.size.bundle).toBeGreaterThan(10);
    expect(getExtensionPackage(crm.admin, "hello-module").files["bundle.js"]).toContain("export default");
  });

  it("upgrades in place, keeping the enabled state and recording the previous version", async () => {
    const crm = await setupTestCrm();
    await installExtension(crm.admin, fakePackage("hello-module"));
    await setExtensionEnabled(crm.admin, "hello-module", false);
    crm.clock.now += 1000;
    const res = await installExtension(crm.admin, fakePackage("hello-module", { version: "1.1.0" }));
    expect(res).toMatchObject({ mode: "upgrade", previousVersion: "1.0.0", version: "1.1.0", enabled: false });
    expect(getExtension(crm.admin, "hello-module")).toMatchObject({ version: "1.1.0", previousVersion: "1.0.0", enabled: false });
    expect(listExtensions(crm.admin)).toHaveLength(1);
  });

  it("refuses a kind change on upgrade", async () => {
    const crm = await setupTestCrm();
    await installExtension(crm.admin, fakePackage("midnight", { kind: "theme" }));
    await expect(installExtension(crm.admin, fakePackage("midnight"))).rejects.toMatchObject({ code: "conflict" });
  });

  it("validates manifest, api version, ids, sizes and imports", async () => {
    const crm = await setupTestCrm();
    await expect(installExtension(crm.admin, fakePackage("Bad_Id"))).rejects.toMatchObject({ code: "validation" });
    await expect(installExtension(crm.admin, fakePackage("deals"))).rejects.toMatchObject({ code: "validation" });
    await expect(installExtension(crm.admin, fakePackage("future-ext", { apiVersion: "9.0.0" }))).rejects.toMatchObject({ code: "invalid" });
    await expect(installExtension(crm.admin, fakePackage("big-ext", { code: `export default {};\n//${"x".repeat(1.6 * 1024 * 1024)}` }))).rejects.toThrow(/limit/);
    await expect(installExtension(crm.admin, fakePackage("dep-ext", { code: 'import dayjs from "dayjs";\nexport default {};' }))).rejects.toThrow(/dayjs/);
    await expect(installExtension(crm.admin, fakePackage("nodefault-ext", { code: "export const x = 1;" }))).rejects.toThrow(/default export/);
    expect(listExtensions(crm.admin)).toEqual([]);
  });

  it("installs a module disabled when its dependency is off", async () => {
    const crm = await setupTestCrm();
    await setModuleEnabled(crm.admin, "deals", false);
    const res = await installExtension(crm.admin, fakePackage("sales-goals", { dependsOn: ["deals"] }));
    expect(res.enabled).toBe(false);
    expect(res.warnings[0]).toMatch(/deals/);
    await expect(setExtensionEnabled(crm.admin, "sales-goals", true)).rejects.toMatchObject({ code: "conflict" });
    await setExtensionEnabled(crm.admin, "sales-goals", true, { cascade: true });
    expect(getExtension(crm.admin, "sales-goals").enabled).toBe(true);
  });

  it("uninstalls (blocked by dependents unless forced) and clears a selected theme", async () => {
    const crm = await setupTestCrm();
    await installExtension(crm.admin, fakePackage("base-ext"));
    await installExtension(crm.admin, fakePackage("child-ext", { dependsOn: ["base-ext"] }));
    await expect(uninstallExtension(crm.admin, "base-ext")).rejects.toMatchObject({ code: "conflict" });
    await uninstallExtension(crm.admin, "base-ext", { force: true });
    expect(listExtensions(crm.admin).map((e) => e.id)).toEqual(["child-ext"]);

    await installExtension(crm.admin, fakePackage("midnight", { kind: "theme" }));
    await applyPreset(crm.admin, "midnight");
    expect(crm.store.get("config", "appearance")?.themeId).toBe("midnight");
    await setExtensionEnabled(crm.admin, "midnight", false);
    expect(crm.store.get("config", "appearance")?.themeId).toBeUndefined();
    await uninstallExtension(crm.admin, "midnight");
    await expect(uninstallExtension(crm.admin, "midnight")).rejects.toMatchObject({ code: "notFound" });
  });
});
