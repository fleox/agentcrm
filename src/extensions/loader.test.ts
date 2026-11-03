// Loader + registry with an injected importBundle (no code evaluation).

import { getAllFeatures, getFeatures, getSlot, setDisabledModules } from "../app/featureRegistry";
import { callTool, findTool, listAiTools } from "../ai/tools";
import { getExternalTheme } from "../appearance/themes";
import { plugins } from "../core/pluginRegistry";
import { getAutomationAction } from "../ops/automations/extensionActions";
import { installExtension, setExtensionEnabled, uninstallExtension } from "../ops/extensions";
import { setupTestCrm } from "../ops/testing";
import { isSafeMode, syncExtensions, watchExtensions, type ImportBundle } from "./loader";
import { deactivateAllExtensions, getLoadedExtension, listLoadedExtensions } from "./registry";
import { fakePackage } from "./testing";
import type { ModuleDefinition, ThemeDefinition } from "./types";

function moduleDef(id: string, extra: Partial<ModuleDefinition> = {}): ModuleDefinition {
  return {
    id,
    apiVersion: "1.0.0",
    feature: { routes: [{ path: `/${id}`, element: null }], navItems: [], i18n: { en: { title: "Hi" } }, slots: { dashboardWidgets: [{ id: `${id}-w`, component: () => null }] } },
    aiTools: [{ name: `${id.replace(/-/g, "_")}_ping`, description: "Answers pong for tests only.", inputSchema: { type: "object", properties: {} }, mutating: false, handler: () => ({ pong: true }) }],
    automationActions: [{ id: `${id}.noop`, label: "No-op", run: () => "ok" }],
    ...extra,
  };
}

// Maps bundle code → definition (the code is just a marker here).
function fakeImporter(defs: Record<string, unknown>): ImportBundle & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (_code: string, info: { id: string; version: string }) => {
    calls.push(`${info.id}@${info.version}`);
    const def = defs[`${info.id}@${info.version}`] ?? defs[info.id];
    if (def instanceof Error) throw def;
    return { default: def };
  }) as ImportBundle & { calls: string[] };
  fn.calls = calls;
  return fn;
}

afterEach(() => {
  deactivateAllExtensions();
  setDisabledModules([]);
});

describe("extension loader", () => {
  it("loads enabled modules: feature, slots, AI tools, automation actions, hooks", async () => {
    const crm = await setupTestCrm();
    const seen: string[] = [];
    await installExtension(crm.admin, fakePackage("hello-module"));
    const importer = fakeImporter({
      "hello-module": moduleDef("hello-module", {
        register(api) {
          api.addAction("record.created", (_ctx, { record }) => void seen.push(record.id));
        },
      }),
    });
    const report = await syncExtensions(crm.store, { importBundle: importer });
    expect(report).toEqual({ loaded: ["hello-module"], unloaded: [], failed: [], skipped: [] });
    expect(getFeatures().find((f) => f.id === "hello-module")?.routes[0].path).toBe("/hello-module");
    expect(getFeatures().find((f) => f.id === "hello-module")?.module).toMatchObject({ name: "Hello Module", category: "customisation" });
    expect(getSlot("dashboardWidgets").map((w) => w.id)).toContain("hello-module-w");
    expect(listAiTools().map((t) => t.name)).toContain("hello_module_ping");
    expect(await callTool(crm.admin, "hello_module_ping", {})).toEqual({ pong: true });
    expect(getAutomationAction("hello-module.noop")).toBeTruthy();
    await plugins.doAction("record.created", crm.admin, { record: { id: "r1" } as never });
    expect(seen).toEqual(["r1"]);
    // Nothing reloads when nothing changed.
    await syncExtensions(crm.store, { importBundle: importer });
    expect(importer.calls).toEqual(["hello-module@1.0.0"]);

    // Disable → everything is unregistered.
    await setExtensionEnabled(crm.admin, "hello-module", false);
    const off = await syncExtensions(crm.store, { importBundle: importer });
    expect(off.unloaded).toEqual(["hello-module"]);
    expect(getAllFeatures().some((f) => f.id === "hello-module")).toBe(false);
    expect(findTool("hello_module_ping")).toBeUndefined();
    expect(getAutomationAction("hello-module.noop")).toBeUndefined();
    await plugins.doAction("record.created", crm.admin, { record: { id: "r2" } as never });
    expect(seen).toEqual(["r1"]);
    expect(getLoadedExtension("hello-module")?.status).toBe("disabled");
  });

  it("reloads an upgraded bundle and drops uninstalled ones", async () => {
    const crm = await setupTestCrm();
    await installExtension(crm.admin, fakePackage("hello-module"));
    const importer = fakeImporter({ "hello-module@1.0.0": moduleDef("hello-module"), "hello-module@2.0.0": moduleDef("hello-module", { aiTools: [] }) });
    await syncExtensions(crm.store, { importBundle: importer });
    await installExtension(crm.admin, fakePackage("hello-module", { version: "2.0.0" }));
    await syncExtensions(crm.store, { importBundle: importer });
    expect(importer.calls).toEqual(["hello-module@1.0.0", "hello-module@2.0.0"]);
    expect(findTool("hello_module_ping")).toBeUndefined();
    expect(getLoadedExtension("hello-module")).toMatchObject({ status: "loaded", version: "2.0.0" });
    await uninstallExtension(crm.admin, "hello-module");
    const r = await syncExtensions(crm.store, { importBundle: importer });
    expect(r.unloaded).toEqual(["hello-module"]);
    expect(listLoadedExtensions()).toEqual([]);
  });

  it("records per-entry failures and never throws", async () => {
    const crm = await setupTestCrm();
    await installExtension(crm.admin, fakePackage("broken-ext"));
    await installExtension(crm.admin, fakePackage("wrong-id"));
    await installExtension(crm.admin, fakePackage("good-ext"));
    const errors: string[] = [];
    const report = await syncExtensions(crm.store, {
      importBundle: fakeImporter({ "broken-ext": new Error("boom"), "wrong-id": moduleDef("other-id"), "good-ext": moduleDef("good-ext") }),
      onError: (id) => errors.push(id),
    });
    expect(report.loaded).toEqual(["good-ext"]);
    expect(report.failed.map((f) => f.id)).toEqual(["broken-ext", "wrong-id"]);
    expect(report.failed[1].error).toMatch(/doesn't match/);
    expect(errors).toEqual(["broken-ext", "wrong-id"]);
    expect(getLoadedExtension("broken-ext")).toMatchObject({ status: "error", error: "boom" });
  });

  it("rolls back a module whose registration fails half-way", async () => {
    const crm = await setupTestCrm();
    await installExtension(crm.admin, fakePackage("half-ext"));
    const def = moduleDef("half-ext", { aiTools: [{ name: "describe_schema", description: "Clashes with a built-in tool.", inputSchema: { type: "object" }, mutating: false, handler: () => null }] });
    const report = await syncExtensions(crm.store, { importBundle: fakeImporter({ "half-ext": def }) });
    expect(report.failed[0].error).toMatch(/already exists/);
    expect(getAllFeatures().some((f) => f.id === "half-ext")).toBe(false);
  });

  it("loads themes into the appearance registry", async () => {
    const crm = await setupTestCrm();
    await installExtension(crm.admin, { ...fakePackage("midnight", { kind: "theme" }), files: { "bundle.js": "export default {};", "style.css": ".m{}" } });
    const theme: ThemeDefinition = { id: "midnight", apiVersion: "1.0.0", name: "Midnight", appearance: { accent: "#8b5cf6" }, css: ".t{}" };
    await syncExtensions(crm.store, { importBundle: fakeImporter({ midnight: theme }) });
    expect(getExternalTheme("midnight")).toMatchObject({ name: "Midnight", appearance: { accent: "#8b5cf6" }, css: ".t{}\n.m{}" });
  });

  it("safe mode skips everything", async () => {
    const crm = await setupTestCrm();
    await installExtension(crm.admin, fakePackage("hello-module"));
    const importer = fakeImporter({ "hello-module": moduleDef("hello-module") });
    const r = await syncExtensions(crm.store, { importBundle: importer, safeMode: true });
    expect(r.skipped).toEqual(["hello-module"]);
    expect(importer.calls).toEqual([]);
    expect(getLoadedExtension("hello-module")?.status).toBe("skipped");
    expect(isSafeMode({ search: "?safe=1", hash: "" })).toBe(true);
    expect(isSafeMode({ search: "", hash: "#/settings?safe=1" })).toBe(true);
    expect(isSafeMode({ search: "", hash: "#/" })).toBe(false);
  });

  it("watches the store for installs", async () => {
    const crm = await setupTestCrm();
    const importer = fakeImporter({ "hello-module": moduleDef("hello-module") });
    const synced: string[][] = [];
    const stop = watchExtensions(crm.store, { importBundle: importer, onSync: (r) => synced.push(r.loaded) });
    await installExtension(crm.admin, fakePackage("hello-module"));
    await vi.waitFor(() => expect(synced).toEqual([["hello-module"]]));
    stop();
  });
});
