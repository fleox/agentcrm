// Extension loader: reads the `extensions` collection of a DataStore,
// imports the bundle of every enabled + compatible extension and
// activates it (src/extensions/registry.ts). Per-entry failures are
// recorded (status "error", onError) — never thrown, never abort boot.
//
// The import itself is injectable (`importBundle(code, info)`): the admin
// uses a Blob-URL import (createBrowserImportBundle), the CLI / tests a
// temp-file import (src/extensions/nodeImport.ts). Both rewrite the
// runtime specifiers (react, @agent-crm/runtime…) to the stubs of
// public/runtime/, which read globalThis.__AGENTCRM_RUNTIME__ (installed
// by src/extensions/runtime.ts) — one React, one store, one i18n.
//
// Safe mode (`?safe=1`, `#/?safe=1`, or Shift held while the admin boots)
// loads nothing.

import type { DataStore } from "../data/types";
import { isCompatibleApiVersion, RUNTIME_DIR, RUNTIME_GLOBAL, RUNTIME_MODULES, type RuntimeSpecifier } from "./api";
import { bundleImports, fingerprint, rewriteRuntimeImports } from "./package";
import { activateExtension, deactivateExtension, getLoadedExtension, listLoadedExtensions, setExtensionStatus } from "./registry";
import type { ExtensionDoc } from "./types";

export type ImportBundle = (code: string, info: { id: string; version: string }) => Promise<unknown>;

export interface LoaderOptions {
  importBundle?: ImportBundle;
  safeMode?: boolean;
  onError?(id: string, error: Error): void;
}

export interface SyncReport {
  loaded: string[];
  unloaded: string[];
  failed: { id: string; error: string }[];
  skipped: string[];
}

// The runtime global may need to load optional modules (lucide-react is
// only fetched when a bundle imports it).
async function prepareRuntime(specifiers: string[]): Promise<void> {
  const g = globalThis as unknown as Record<string, { prepare?: (specs: string[]) => Promise<void> } | undefined>;
  await g[RUNTIME_GLOBAL]?.prepare?.(specifiers);
}

// Blob-URL import for the browser. Stubs are resolved against the admin's
// index.html (document.baseURI), not the calling module.
export function createBrowserImportBundle(baseUrl?: string): ImportBundle {
  return async (code) => {
    const base = baseUrl ?? document.baseURI;
    const rewritten = rewriteRuntimeImports(code, (spec) => new URL(`${RUNTIME_DIR}/${RUNTIME_MODULES[spec as RuntimeSpecifier]}`, base).href);
    const url = URL.createObjectURL(new Blob([rewritten], { type: "text/javascript" }));
    try {
      return await import(/* @vite-ignore */ url);
    } finally {
      URL.revokeObjectURL(url);
    }
  };
}

let shiftHeldAtBoot = false;

// Call as early as possible (main.tsx): holding Shift while the admin
// loads boots in safe mode.
export function trackSafeModeKey(win: Window = window): () => void {
  const on = (e: KeyboardEvent) => {
    if (e.key === "Shift" || e.shiftKey) shiftHeldAtBoot = true;
  };
  win.addEventListener("keydown", on);
  const t = setTimeout(() => win.removeEventListener("keydown", on), 2500);
  return () => {
    clearTimeout(t);
    win.removeEventListener("keydown", on);
  };
}

export function isSafeMode(loc: Pick<Location, "search" | "hash"> | undefined = typeof location !== "undefined" ? location : undefined): boolean {
  if (shiftHeldAtBoot) return true;
  if (!loc) return false;
  const hashQuery = loc.hash.includes("?") ? loc.hash.slice(loc.hash.indexOf("?")) : "";
  return [loc.search, hashQuery].some((q) => {
    const v = new URLSearchParams(q).get("safe");
    return v === "1" || v === "true";
  });
}

// Tests only.
export function resetSafeModeKey(): void {
  shiftHeldAtBoot = false;
}

function wantedDocs(store: DataStore): ExtensionDoc[] {
  return (store.list("extensions") as unknown as ExtensionDoc[]).filter((d) => d && typeof d.id === "string" && d.manifest);
}

async function loadOne(doc: ExtensionDoc, importBundle: ImportBundle): Promise<void> {
  const code = doc.files?.["bundle.js"];
  if (typeof code !== "string" || !code) throw new Error("bundle.js is missing (upload incomplete?).");
  await prepareRuntime(bundleImports(code));
  const mod = await importBundle(code, { id: doc.id, version: doc.manifest.version });
  activateExtension(doc, mod, fingerprint(doc.manifest, doc.files));
}

let queue: Promise<unknown> = Promise.resolve();

// Brings the loaded set in line with the store. Serialised: concurrent
// calls run one after the other.
export function syncExtensions(store: DataStore, opts: LoaderOptions = {}): Promise<SyncReport> {
  const run = async (): Promise<SyncReport> => {
    const report: SyncReport = { loaded: [], unloaded: [], failed: [], skipped: [] };
    const importBundle = opts.importBundle ?? createBrowserImportBundle();
    const docs = wantedDocs(store);
    const ids = new Set(docs.map((d) => d.id));
    // Uninstalled.
    for (const e of listLoadedExtensions()) {
      if (!ids.has(e.id)) {
        if (e.status === "loaded") report.unloaded.push(e.id);
        deactivateExtension(e.id);
      }
    }
    for (const doc of docs) {
      const current = getLoadedExtension(doc.id);
      if (opts.safeMode) {
        if (current?.status !== "skipped") setExtensionStatus(doc, "skipped");
        report.skipped.push(doc.id);
        continue;
      }
      if (!doc.enabled) {
        if (current?.status === "loaded") report.unloaded.push(doc.id);
        if (current?.status !== "disabled") setExtensionStatus(doc, "disabled");
        continue;
      }
      if (!isCompatibleApiVersion(doc.manifest.apiVersion)) {
        if (current?.status !== "incompatible") setExtensionStatus(doc, "incompatible", `apiVersion ${doc.manifest.apiVersion} is not supported.`);
        continue;
      }
      const fp = doc.files?.["bundle.js"] ? fingerprint(doc.manifest, doc.files) : "";
      if (current?.status === "loaded" && current.fingerprint === fp) continue;
      if (current?.status === "error" && current.fingerprint === fp) continue;
      try {
        await loadOne(doc, importBundle);
        report.loaded.push(doc.id);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        // A caller that handles errors (CLI check / sessions) reports them
        // its own way; otherwise log them for the developer console.
        if (!opts.onError) console.error(`[extensions] ${doc.id} failed to load:`, error);
        setExtensionStatus(doc, "error", error.message);
        const st = getLoadedExtension(doc.id);
        if (st) st.fingerprint = fp;
        report.failed.push({ id: doc.id, error: error.message });
        opts.onError?.(doc.id, error);
      }
    }
    return report;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

// Initial load + live updates (install / upgrade / enable / uninstall from
// this tab, another tab or another user). Returns the stop function.
export function watchExtensions(store: DataStore, opts: LoaderOptions & { onSync?(report: SyncReport): void } = {}): () => void {
  let stopped = false;
  const sync = () =>
    void syncExtensions(store, opts).then((r) => {
      if (!stopped) opts.onSync?.(r);
    });
  const off = store.subscribe((changed) => {
    if (changed.has("extensions")) sync();
  });
  return () => {
    stopped = true;
    off();
  };
}
