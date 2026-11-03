import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DataStore } from "../../src/data/types";
import type { SyncReport } from "../../src/extensions/loader";
import { distRoot, ownPackageRoot, packageRoot } from "../paths";

// Extensions in the CLI / MCP sessions: the enabled external modules and
// themes of a site are loaded in this Node process exactly like the admin
// loads them (src/extensions/loader.ts), with the Node importer
// (src/extensions/nodeImport.ts) — so their AI tools show in `tools list`
// and MCP `tools/list`, their register() hooks see the CLI's writes and
// their automation actions run in `automations run`.
//
// Nothing is imported when the site has no enabled extension (the runtime
// pulls React & co. — kept out of the common path). `--safe` (or
// AGENTCRM_SAFE=1) skips them all.

// Folder of the runtime stubs (react.js, agentcrm-runtime.js…):
// $AGENTCRM_RUNTIME_DIR, the admin build shipped with the CLI
// (dist/admin/runtime), else the sources (public/runtime, repo checkouts).
export function runtimeDir(): string {
  const own = ownPackageRoot();
  const candidates = [...new Set([process.env.AGENTCRM_RUNTIME_DIR, join(distRoot(), "admin", "runtime"), join(packageRoot(), "public", "runtime"), join(own, "dist", "admin", "runtime"), join(own, "public", "runtime")].filter((p): p is string => !!p))];
  for (const dir of candidates) if (existsSync(join(dir, "agentcrm-runtime.js"))) return resolve(dir);
  throw new Error(`Runtime stubs not found (looked in ${candidates.join(", ")}). Set AGENTCRM_RUNTIME_DIR to an admin build's runtime/ folder.`);
}

export function safeModeFromEnv(): boolean {
  const v = process.env.AGENTCRM_SAFE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

let tmpBase: string | null = null;

function tmpFolder(): string {
  if (!tmpBase) tmpBase = mkdtempSync(join(tmpdir(), "agentcrm-cli-ext-"));
  return tmpBase;
}

// The Node importBundle of this process (the runtime is installed first).
export async function nodeImportBundle() {
  await import("../../src/extensions/runtime");
  const { createNodeImportBundle } = await import("../../src/extensions/nodeImport");
  return createNodeImportBundle({ runtimeDir: runtimeDir(), tmpDir: tmpFolder() });
}

export function hasEnabledExtensions(store: DataStore): boolean {
  return store.list("extensions").some((d) => (d as { enabled?: unknown }).enabled === true);
}

export interface SessionExtensions {
  report: SyncReport | null;
  safeMode: boolean;
  // Re-syncs after the data changed (MCP refresh, after `ext install`).
  sync(): Promise<SyncReport | null>;
  close(): Promise<void>;
}

// Loads the enabled extensions of a store. Never throws: failures are
// reported (and printed on stderr as notes by the caller).
export async function loadSessionExtensions(store: DataStore, opts: { safe?: boolean; force?: boolean } = {}): Promise<SessionExtensions> {
  const safeMode = !!opts.safe || safeModeFromEnv();
  let loadedAny = false;
  const sync = async (): Promise<SyncReport | null> => {
    if (safeMode) return null;
    if (!loadedAny && !opts.force && !hasEnabledExtensions(store)) return null;
    try {
      const importBundle = await nodeImportBundle();
      const { syncExtensions } = await import("../../src/extensions/loader");
      loadedAny = true;
      const original = console.error;
      // The loader logs failures with console.error; they are reported.
      console.error = () => undefined;
      try {
        return await syncExtensions(store, { importBundle });
      } finally {
        console.error = original;
      }
    } catch (err) {
      return { loaded: [], unloaded: [], failed: [{ id: "*", error: (err as Error).message }], skipped: [] };
    }
  };
  const report = await sync();
  return {
    report,
    safeMode,
    sync,
    async close() {
      if (!loadedAny) return;
      (await import("../../src/extensions/registry")).deactivateAllExtensions();
    },
  };
}

// Notes for stderr about a sync report.
export function extensionNotes(report: SyncReport | null): string[] {
  if (!report) return [];
  return report.failed.map((f) => (f.id === "*" ? `extensions could not be loaded: ${f.error}` : `extension ${f.id} failed to load: ${f.error} (\`agentcrm ext disable ${f.id}\`, or --safe to skip extensions)`));
}
