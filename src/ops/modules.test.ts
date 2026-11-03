import { BUILTIN_MODULES, REQUIRED_MODULES } from "../core/modules";
import { FEATURES } from "../features";
import { fakePackage } from "../extensions/testing";
import { installExtension } from "./extensions";
import { disabledObjectIds, getModule, getModuleConfig, isModuleEnabled, listModules, setModuleConfig, setModuleEnabled } from "./modules";
import { setupTestCrm } from "./testing";

describe("module catalog", () => {
  it("every built-in feature carries the module metadata of the catalog", () => {
    const ids = FEATURES.map((f) => f.id).sort();
    expect(ids).toEqual(BUILTIN_MODULES.map((m) => m.id).sort());
    for (const f of FEATURES) {
      const m = BUILTIN_MODULES.find((x) => x.id === f.id)!;
      expect(f.module?.name, f.id).toBe(m.name);
      expect(!!f.module?.required, f.id).toBe(!!m.required);
    }
  });

  it("required modules are the core ones", () => {
    expect([...REQUIRED_MODULES].sort()).toEqual(["customize", "records", "search", "settings", "setup"]);
  });
});

describe("ops/modules", () => {
  it("lists built-in modules, all enabled by default", async () => {
    const crm = await setupTestCrm();
    const list = listModules(crm.as("viewer"));
    expect(list.map((m) => m.id)).toContain("deals");
    expect(list.every((m) => m.enabled)).toBe(true);
    expect(getModule(crm.admin, "deals")).toMatchObject({ source: "builtin", objects: ["deals"], required: false, name: "Deals & pipelines" });
  });

  it("disables / re-enables a module (admin only) and hides its objects", async () => {
    const crm = await setupTestCrm();
    await expect(setModuleEnabled(crm.as("member"), "deals", false)).rejects.toMatchObject({ code: "forbidden" });
    const res = await setModuleEnabled(crm.admin, "deals", false);
    expect(res.changed).toEqual([{ id: "deals", enabled: false }]);
    expect(isModuleEnabled(crm.store, "deals")).toBe(false);
    expect([...disabledObjectIds(crm.store)]).toEqual(["deals"]);
    expect(crm.store.get("config", "modules")).toMatchObject({ disabled: ["deals"] });
    // Data kept.
    expect(crm.store.get("objects", "deals")).toBeTruthy();
    await setModuleEnabled(crm.admin, "deals", true);
    expect(isModuleEnabled(crm.store, "deals")).toBe(true);
    expect((await setModuleEnabled(crm.admin, "deals", true)).changed).toEqual([]);
  });

  it("refuses to disable a required module and unknown ids", async () => {
    const crm = await setupTestCrm();
    await expect(setModuleEnabled(crm.admin, "records", false)).rejects.toMatchObject({ code: "invalid" });
    await expect(setModuleEnabled(crm.admin, "nope", false)).rejects.toMatchObject({ code: "notFound" });
  });

  it("checks dependencies both ways (with an extension depending on deals)", async () => {
    const crm = await setupTestCrm();
    await installExtension(crm.admin, fakePackage("sales-goals", { dependsOn: ["deals"] }));
    expect(getModule(crm.admin, "deals").dependents).toEqual(["sales-goals"]);
    // Disabling deals is blocked by its enabled dependent…
    await expect(setModuleEnabled(crm.admin, "deals", false)).rejects.toMatchObject({ code: "conflict", details: { blockers: ["sales-goals"] } });
    // …unless cascading.
    const res = await setModuleEnabled(crm.admin, "deals", false, { cascade: true });
    expect(res.changed.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "deals", enabled: false },
      { id: "sales-goals", enabled: false },
    ]);
    expect(crm.store.get("extensions", "sales-goals")?.enabled).toBe(false);
    expect(getModule(crm.admin, "sales-goals").missingDependencies).toEqual(["deals"]);
    // Enabling the dependent needs deals back.
    await expect(setModuleEnabled(crm.admin, "sales-goals", true)).rejects.toMatchObject({ code: "conflict" });
    await setModuleEnabled(crm.admin, "sales-goals", true, { cascade: true });
    expect(isModuleEnabled(crm.store, "deals")).toBe(true);
    expect(isModuleEnabled(crm.store, "sales-goals")).toBe(true);
  });

  it("stores per-module configuration without secrets", async () => {
    const crm = await setupTestCrm();
    expect(getModuleConfig(crm.admin, "deals")).toBeUndefined();
    await setModuleConfig(crm.admin, "deals", { a: 1 });
    await setModuleEnabled(crm.admin, "tasks", false);
    await setModuleConfig(crm.admin, "reports", { b: [1, 2] });
    expect(getModuleConfig(crm.as("viewer"), "deals")).toEqual({ a: 1 });
    expect(getModuleConfig(crm.admin, "reports")).toEqual({ b: [1, 2] });
    expect(isModuleEnabled(crm.store, "tasks")).toBe(false);
    await setModuleConfig(crm.admin, "deals", null);
    expect(getModuleConfig(crm.admin, "deals")).toBeUndefined();
    await expect(setModuleConfig(crm.admin, "deals", { secretAccessKey: "x" })).rejects.toMatchObject({ code: "validation" });
    await expect(setModuleConfig(crm.admin, "nope", {})).rejects.toMatchObject({ code: "notFound" });
    await expect(setModuleConfig(crm.as("member"), "deals", {})).rejects.toMatchObject({ code: "forbidden" });
  });
});
