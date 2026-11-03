// Node implementation of the loader's `importBundle` (CLI, tests): writes
// the bundle to a temp .mjs file whose runtime specifiers point at the
// stub files (public/runtime/ in the repo, dist/admin/runtime/ in the npm
// package) and imports it. Requires src/extensions/runtime.ts to be
// imported first (it installs globalThis.__AGENTCRM_RUNTIME__).
//
// Node-only: never imported by browser code.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RUNTIME_MODULES, type RuntimeSpecifier } from "./api";
import type { ImportBundle } from "./loader";
import { rewriteRuntimeImports } from "./package";

export interface NodeImportOptions {
  // Folder holding react.js, agentcrm-runtime.js… (the runtime stubs).
  runtimeDir: string;
  // Where temp bundles go (default: os.tmpdir()).
  tmpDir?: string;
}

export function createNodeImportBundle(opts: NodeImportOptions): ImportBundle {
  const runtimeDir = resolve(opts.runtimeDir);
  return async (code, info) => {
    const dir = await mkdtemp(join(opts.tmpDir ?? tmpdir(), "agentcrm-ext-"));
    const file = join(dir, `${info.id}-${info.version}.mjs`);
    try {
      const rewritten = rewriteRuntimeImports(code, (spec) => pathToFileURL(join(runtimeDir, RUNTIME_MODULES[spec as RuntimeSpecifier])).href);
      await writeFile(file, rewritten, "utf8");
      return await import(/* @vite-ignore */ pathToFileURL(file).href);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}
