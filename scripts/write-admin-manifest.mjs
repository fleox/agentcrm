// Writes dist/admin/admin-files.json — the list of every file of the
// built admin (mirror of cms-ia scripts/write-admin-manifest.mjs). The
// admin uses it to copy ITSELF onto a hosting target (setup wizard →
// "Admin hosting", Settings → Admin hosting, `agentcrm deploy-admin`),
// since a browser can't list the folder it was served from. config.js is
// left out: it is generated per CRM at deploy time. No timestamp: the
// build stays reproducible.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const adminDir = join(root, "dist", "admin");
const MANIFEST = "admin-files.json";
const SKIP = new Set(["config.js", MANIFEST]);

if (!existsSync(adminDir)) {
  console.error("[admin-manifest] dist/admin not found — run `vite build` first.");
  process.exit(1);
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else out.push(relative(adminDir, abs).split("\\").join("/"));
  }
  return out;
}

const files = walk(adminDir, []).filter((f) => !SKIP.has(f)).sort();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
// version + dataSchema let agents tell what a hosted admin runs (and
// refuse a downgrade below the stored data format).
writeFileSync(
  join(adminDir, MANIFEST),
  JSON.stringify({ version: pkg.version, dataSchema: pkg.agentcrm?.dataSchema ?? 1, files }, null, 2) + "\n",
);
console.log(`[admin-manifest] ${files.length} files listed in dist/admin/${MANIFEST}`);
