// Writes dist/version.json — what agents compare to decide whether the
// skills, the downloaded dist/ or a hosted admin are out of date:
//   version          release of this repo / npm package (package.json)
//   minSkillsVersion oldest skills that still work with this dist
//   dataSchema       format of stored data; bumped when an older admin
//                    could no longer read data written by this one
// The last two live under "agentcrm" in package.json.

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const info = {
  name: pkg.name,
  version: pkg.version,
  minSkillsVersion: pkg.agentcrm.minSkillsVersion,
  dataSchema: pkg.agentcrm.dataSchema,
};
writeFileSync(join(root, "dist", "version.json"), JSON.stringify(info, null, 2) + "\n");
// The npm bin entry; executable so `./dist/agent/agentcrm.mjs` works in a clone.
const bin = join(root, "dist", "agent", "agentcrm.mjs");
if (existsSync(bin)) chmodSync(bin, 0o755);
console.log(`[version] dist/version.json → ${info.version}`);
