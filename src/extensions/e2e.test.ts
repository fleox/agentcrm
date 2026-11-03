// End to end: the real example extensions of external/ are built with
// Vite (their own config), packed to a ZIP, read back, installed in a
// memory store through src/ops/extensions.ts and loaded through the loader
// with the Node importBundle (the same path the CLI uses) — then their
// routes, tools, automation actions and themes are live.

import "./runtime";
import { resolve } from "node:path";
import { build } from "vite";
import JSZip from "jszip";
import { getFeatures } from "../app/featureRegistry";
import { callTool, listAiTools } from "../ai/tools";
import { getExternalTheme } from "../appearance/themes";
import { getAutomationAction } from "../ops/automations/extensionActions";
import { installExtension } from "../ops/extensions";
import { applyPreset, getAppearance } from "../ops/appearance";
import { setModuleConfig } from "../ops/modules";
import { moveStage } from "../ops/pipelines";
import { updateRecord } from "../ops/records";
import { setupTestCrm } from "../ops/testing";
import { syncExtensions } from "./loader";
import { createNodeImportBundle } from "./nodeImport";
import { packExtension, readExtensionZip } from "./package";
import { deactivateAllExtensions, getLoadedExtension } from "./registry";
import type { ExtensionPackage } from "./types";

const root = resolve(__dirname, "../..");
const importBundle = createNodeImportBundle({ runtimeDir: resolve(root, "public/runtime") });

async function buildPackage(dir: string): Promise<ExtensionPackage> {
  const abs = resolve(root, dir);
  const result = await build({ root: abs, configFile: resolve(abs, "vite.config.ts"), mode: "production", logLevel: "silent", build: { write: false } });
  const out = (Array.isArray(result) ? result : [result as { output: { type: string; fileName: string; code?: string }[] }]).flatMap((r) => (r as { output: { type: string; fileName: string; code?: string }[] }).output);
  const bundle = out.find((o) => o.type === "chunk" && o.fileName === "bundle.js")!.code!;
  const manifest = (await import(resolve(abs, "manifest.json"), { with: { type: "json" } })).default;
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest));
  zip.file("bundle.js", bundle);
  if (manifest.style) zip.file("style.css", (await import("node:fs")).readFileSync(resolve(abs, "src/style.css"), "utf8"));
  // Through the real ZIP reader (validation included).
  return readExtensionZip(await zip.generateAsync({ type: "uint8array" }));
}

afterAll(() => deactivateAllExtensions());

describe("example extensions, end to end", () => {
  it("hello-module: pack → install → load (Node importBundle) → route + AI tool registered", async () => {
    const pkg = await buildPackage("external/modules/hello-module");
    expect(pkg.manifest).toMatchObject({ id: "hello-module", kind: "module" });
    // Round trip through packExtension too.
    const again = await readExtensionZip(await packExtension(pkg));
    expect(again).toEqual(pkg);

    const crm = await setupTestCrm({ demo: true });
    await installExtension(crm.admin, pkg);
    const report = await syncExtensions(crm.store, { importBundle });
    expect(report.failed).toEqual([]);
    expect(report.loaded).toEqual(["hello-module"]);
    const feature = getFeatures().find((f) => f.id === "hello-module")!;
    expect(feature.routes.map((r) => r.path)).toEqual(["/hello"]);
    expect(feature.navItems?.[0]).toMatchObject({ to: "/hello", label: "hello-module:nav" });
    expect(feature.slots?.recordDetailTabs?.[0].id).toBe("hello");
    expect(listAiTools().map((t) => t.name)).toContain("hello_world");
    const res = (await callTool(crm.admin, "hello_world", { name: "Ada" })) as { greeting: string; counts: Record<string, number> };
    expect(res.greeting).toBe("Hello Ada!");
    expect(res.counts.companies).toBeGreaterThan(0);
  }, 60_000);

  it("sales-goals: widget, settings page, get_sales_goals and the goal-reached action", async () => {
    const pkg = await buildPackage("external/modules/sales-goals");
    const crm = await setupTestCrm({ demo: true });
    await installExtension(crm.admin, pkg);
    await syncExtensions(crm.store, { importBundle });
    expect(getLoadedExtension("sales-goals")?.status).toBe("loaded");
    const feature = getFeatures().find((f) => f.id === "sales-goals")!;
    expect(feature.slots?.dashboardWidgets?.[0].id).toBe("sales-goals");
    expect(typeof feature.settingsPage).toBe("function");

    // A won deal this month for the admin, against a 1 000 target.
    const deal = (crm.store.list("records") as { id: string; object: string; ownerId?: string; fields: Record<string, unknown> }[]).find((r) => r.object === "deals" && r.ownerId === "owner")!;
    await setModuleConfig(crm.admin, "sales-goals", { targets: { owner: 1 } });
    const wonStage = (crm.store.list("pipelines")[0] as unknown as { stages: { id: string; kind: string }[] }).stages.find((st) => st.kind === "won")!.id;
    await moveStage(crm.admin, deal.id, wonStage);
    await updateRecord(crm.admin, deal.id, { closeDate: "2024-06-10", amount: 5000 });
    const goals = (await callTool(crm.admin, "get_sales_goals", {})) as { goals: { userId: string; ratio: number }[] };
    const mine = goals.goals.find((g) => g.userId === "owner")!;
    expect(mine.ratio).toBeGreaterThanOrEqual(1);

    const action = getAutomationAction("sales-goals.notifyGoalReached")!;
    const ctx = crm.as(null);
    const record = crm.store.get("records", deal.id) as never;
    const object = crm.store.get("objects", "deals") as never;
    const first = await action.run(ctx, { params: {}, record, object, automation: { id: "a", name: "Goal", enabled: true, object: "deals", trigger: { type: "stage.changed" }, conditions: [], actions: [] }, trigger: "stage.changed" });
    expect(first).toMatch(/note added/);
    const second = await action.run(ctx, { params: {}, record, object, automation: { id: "a", name: "Goal", enabled: true, object: "deals", trigger: { type: "stage.changed" }, conditions: [], actions: [] }, trigger: "stage.changed" });
    expect(second).toMatch(/Already notified/);
  }, 60_000);

  it("midnight theme: install → load → apply", async () => {
    const pkg = await buildPackage("external/themes/midnight");
    expect(pkg.files["style.css"]).toContain("--acc-500");
    const crm = await setupTestCrm();
    await installExtension(crm.admin, pkg);
    await syncExtensions(crm.store, { importBundle });
    expect(getExternalTheme("midnight")).toMatchObject({ name: "Midnight", appearance: { accent: "#7c3aed" } });
    await applyPreset(crm.admin, "midnight");
    expect(getAppearance(crm.admin)).toMatchObject({ themeId: "midnight", accent: "#7c3aed", defaultMode: "dark", sidebar: "dark" });
  }, 60_000);
});
