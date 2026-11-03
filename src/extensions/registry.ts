// Live list of the external extensions of this tab (or CLI process) and
// their activation: a module's Feature joins the feature registry, its AI
// tools the AI catalog, its automation actions the automations engine, its
// `register(api)` hooks the plugin registry; a theme joins the appearance
// theme registry. Everything is undone by deactivate() (disable,
// uninstall, upgrade).

import { isCompatibleApiVersion } from "./api";
import type { ExtensionDoc, ExtensionStatus, LoadedExtension, ModuleApi, ModuleDefinition, ThemeDefinition } from "./types";
import { registerExternalFeature } from "../app/featureRegistry";
import { registerAiTool } from "../ai/tools";
import { registerAutomationAction } from "../ops/automations/extensionActions";
import { plugins } from "../core/pluginRegistry";
import { registerExternalTheme } from "../appearance/themes";
import type { Feature } from "../features/types";

interface Active {
  state: LoadedExtension;
  dispose: () => void;
}

const entries = new Map<string, Active>();
const listeners = new Set<() => void>();
let snapshot: LoadedExtension[] = [];

function notify(): void {
  snapshot = [...entries.values()].map((e) => e.state).sort((a, b) => a.id.localeCompare(b.id));
  for (const l of [...listeners]) l();
}

export function listLoadedExtensions(): LoadedExtension[] {
  return snapshot;
}

export function getLoadedExtension(id: string): LoadedExtension | undefined {
  return entries.get(id)?.state;
}

export function subscribeLoadedExtensions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Records a non-loaded state (disabled, skipped, error…).
export function setExtensionStatus(doc: Pick<ExtensionDoc, "id" | "kind" | "manifest">, status: ExtensionStatus, error?: string): void {
  const prev = entries.get(doc.id);
  if (prev) prev.dispose();
  entries.set(doc.id, { state: { id: doc.id, kind: doc.kind, version: doc.manifest.version, status, ...(error ? { error } : {}) }, dispose: () => undefined });
  notify();
}

export function deactivateExtension(id: string): void {
  const e = entries.get(id);
  if (!e) return;
  entries.delete(id);
  try {
    e.dispose();
  } catch (err) {
    console.error(`[extensions] dispose of ${id} failed:`, err);
  }
  notify();
}

export function deactivateAllExtensions(): void {
  for (const id of [...entries.keys()]) deactivateExtension(id);
}

function asDefinition(mod: unknown): Record<string, unknown> | null {
  const m = mod as { default?: unknown } | null;
  const def = m && typeof m === "object" && "default" in m ? m.default : null;
  return def && typeof def === "object" ? (def as Record<string, unknown>) : null;
}

function checkDefinition(doc: ExtensionDoc, def: Record<string, unknown> | null): asserts def is Record<string, unknown> {
  if (!def) throw new Error("bundle.js has no default export (export default defineModule({...}) / defineTheme({...})).");
  if (def.id !== doc.id) throw new Error(`bundle id "${String(def.id)}" doesn't match manifest id "${doc.id}".`);
  if (!isCompatibleApiVersion(def.apiVersion)) throw new Error(`bundle apiVersion "${String(def.apiVersion)}" is not supported.`);
}

function styleInjector(id: string, css: string | undefined): () => void {
  if (!css || typeof document === "undefined") return () => undefined;
  const el = document.createElement("style");
  el.dataset.agentcrmExtension = id;
  el.textContent = css;
  document.head.appendChild(el);
  return () => el.remove();
}

function activateModule(doc: ExtensionDoc, def: ModuleDefinition): () => void {
  const disposers: (() => void)[] = [];
  const track = (off: () => void) => {
    disposers.push(off);
    return off;
  };
  try {
    const m = doc.manifest;
    const feature: Feature = {
      routes: [],
      i18n: { en: {} },
      ...(def.feature ?? {}),
      id: doc.id,
      module: { name: m.name, description: m.description, icon: m.icon ?? "Puzzle", category: m.category ?? "customisation", ...(m.dependsOn?.length ? { dependsOn: m.dependsOn } : {}) },
      ...(def.settingsPage ? { settingsPage: def.settingsPage } : {}),
    };
    track(registerExternalFeature(feature));
    for (const tool of def.aiTools ?? []) track(registerAiTool(tool));
    for (const action of def.automationActions ?? []) track(registerAutomationAction(action));
    track(styleInjector(doc.id, doc.files["style.css"]));
    if (typeof def.register === "function") {
      const api: ModuleApi = {
        moduleId: doc.id,
        addAction: ((hook: string, fn: (...args: never[]) => void | Promise<void>, priority?: number) => track(plugins.addAction(hook, fn, priority))) as ModuleApi["addAction"],
        addFilter: (hook, fn, priority) => track(plugins.addFilter(hook, fn, priority)),
        registerAiTool: (tool) => track(registerAiTool(tool)),
        registerAutomationAction: (action) => track(registerAutomationAction(action)),
        onDispose: (fn) => void disposers.push(fn),
      };
      const cleanup = def.register(api);
      if (typeof cleanup === "function") disposers.push(cleanup);
    }
  } catch (err) {
    for (const d of disposers.reverse()) d();
    throw err;
  }
  return () => {
    for (const d of disposers.reverse()) {
      try {
        d();
      } catch (err) {
        console.error(`[extensions] cleanup of ${doc.id} failed:`, err);
      }
    }
  };
}

function activateTheme(doc: ExtensionDoc, def: ThemeDefinition): () => void {
  if (!def.appearance || typeof def.appearance !== "object") throw new Error("defineTheme({ appearance }) is required.");
  if (typeof def.name !== "string" || !def.name) throw new Error("defineTheme({ name }) is required.");
  const css = [def.css, doc.files["style.css"]].filter(Boolean).join("\n");
  return registerExternalTheme({ id: doc.id, apiVersion: def.apiVersion, name: def.name, ...(def.description ? { description: def.description } : {}), appearance: { ...def.appearance }, ...(css ? { css } : {}) });
}

// Registers the default export of an imported bundle. Throws on an
// invalid definition (nothing stays registered).
export function activateExtension(doc: ExtensionDoc, mod: unknown, fingerprint: string): void {
  const def = asDefinition(mod);
  checkDefinition(doc, def);
  deactivateExtension(doc.id);
  const dispose = doc.kind === "theme" ? activateTheme(doc, def as unknown as ThemeDefinition) : activateModule(doc, def as unknown as ModuleDefinition);
  entries.set(doc.id, { state: { id: doc.id, kind: doc.kind, version: doc.manifest.version, status: "loaded", fingerprint }, dispose });
  notify();
}
