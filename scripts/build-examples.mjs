#!/usr/bin/env node
// Builds the example extensions of external/ and packs each one into an
// installable ZIP (Settings → Modules → Installed extensions, or the CLI):
//
//   external/modules/hello-module   → dist/extensions/hello-module-<version>.zip
//   external/modules/sales-goals    → dist/extensions/sales-goals-<version>.zip
//   external/themes/midnight        → dist/extensions/midnight-<version>.zip
//
// Per example: type-check against types/agentcrm-runtime.d.ts, `vite build`
// with its vite.config.ts (runtime specifiers externalised, one bundle.js),
// then ZIP manifest.json + bundle.js (+ style.css from src/style.css when the
// manifest declares it). Not part of `npm run build`: `npm run build:examples`.
//
//   node scripts/build-examples.mjs [id…]

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { build } from "vite";

// Production JSX whatever the shell says.
process.env.NODE_ENV = "production";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "dist/extensions");

export const EXAMPLES = ["external/modules/hello-module", "external/modules/sales-goals", "external/themes/midnight"];

// Bare imports the admin provides (src/extensions/api.ts RUNTIME_MODULES).
const RUNTIME = new Set(["react", "react/jsx-runtime", "react-dom", "react-dom/client", "react-i18next", "lucide-react", "@agent-crm/runtime"]);

function bareImports(code) {
  const out = new Set();
  const re = /(?:\bimport\s*(?:[\w*{}\s,$]+?\s*from\s*)?|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;
  for (const m of code.matchAll(re)) if (!/^[./]/.test(m[1]) && !/^[a-z]+:/i.test(m[1])) out.add(m[1]);
  return [...out];
}

export async function buildExample(dir, { typecheck = true } = {}) {
  const abs = resolve(root, dir);
  const manifest = JSON.parse(readFileSync(join(abs, "manifest.json"), "utf8"));
  if (typecheck) execFileSync(resolve(root, "node_modules/.bin/tsc"), ["--noEmit", "-p", abs], { stdio: "inherit" });
  const result = await build({ root: abs, configFile: join(abs, "vite.config.ts"), mode: "production", logLevel: "warn", build: { write: false } });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => r.output);
  const chunks = outputs.filter((o) => o.type === "chunk");
  if (chunks.length !== 1 || chunks[0].fileName !== "bundle.js") throw new Error(`${dir}: expected one bundle.js, got ${chunks.map((c) => c.fileName).join(", ")}`);
  const bundle = chunks[0].code;
  const foreign = bareImports(bundle).filter((s) => !RUNTIME.has(s));
  if (foreign.length) throw new Error(`${dir}: bundle.js imports ${foreign.join(", ")} — bundle them or use @agent-crm/runtime.`);
  const files = { "manifest.json": JSON.stringify(manifest, null, 2) + "\n", "bundle.js": bundle };
  if (manifest.style) {
    const css = join(abs, "src", "style.css");
    if (!existsSync(css)) throw new Error(`${dir}: manifest declares style.css but src/style.css is missing.`);
    files["style.css"] = readFileSync(css, "utf8");
  }
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
  return { manifest, files, zip: bytes };
}

async function main() {
  const only = process.argv.slice(2);
  const list = only.length ? EXAMPLES.filter((d) => only.some((id) => d.endsWith(`/${id}`))) : EXAMPLES;
  if (!list.length) throw new Error(`No example matches ${only.join(", ")}. Examples: ${EXAMPLES.join(", ")}`);
  mkdirSync(outDir, { recursive: true });
  for (const dir of list) {
    const { manifest, files, zip } = await buildExample(dir);
    const file = join(outDir, `${manifest.id}-${manifest.version}.zip`);
    writeFileSync(file, zip);
    console.log(`[examples] ${manifest.id} ${manifest.version} → ${relative(root, file)} (bundle ${(files["bundle.js"].length / 1024).toFixed(1)} KB, zip ${(zip.length / 1024).toFixed(1)} KB)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[examples] ${err.message ?? err}`);
    process.exit(1);
  });
}
