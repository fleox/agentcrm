import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json";

// The CLI runs either bundled (dist/agent/agentcrm.mjs, inside the npm
// package or a clone) or from source (agent/*.ts under vitest). Both
// layouts resolve to the same dist/ folder. $AGENTCRM_DIST overrides it
// (tests point it at a fake admin build).

declare const __AGENTCRM_BUNDLED__: boolean | undefined;

export function isBundled(): boolean {
  return typeof __AGENTCRM_BUNDLED__ !== "undefined" && !!__AGENTCRM_BUNDLED__;
}

export function distRoot(): string {
  if (process.env.AGENTCRM_DIST) return resolve(process.env.AGENTCRM_DIST);
  const here = dirname(fileURLToPath(import.meta.url));
  return isBundled() ? resolve(here, "..") : resolve(here, "..", "dist");
}

// Root of the package (changelog.json, README…).
export function packageRoot(): string {
  return resolve(distRoot(), "..");
}

export interface VersionInfo {
  name: string;
  version: string;
  minSkillsVersion: string;
  dataSchema: number;
}

// dist/version.json when built, else package.json (source runs, tests
// before a build): the CLI always knows its own version.
export function readVersionInfo(): VersionInfo {
  const file = join(distRoot(), "version.json");
  if (existsSync(file)) {
    try {
      const v = JSON.parse(readFileSync(file, "utf8")) as Partial<VersionInfo>;
      if (v.version) return { name: v.name ?? pkg.name, version: v.version, minSkillsVersion: v.minSkillsVersion ?? pkg.agentcrm.minSkillsVersion, dataSchema: v.dataSchema ?? pkg.agentcrm.dataSchema };
    } catch {
      /* fall back to package.json */
    }
  }
  return { name: pkg.name, version: pkg.version, minSkillsVersion: pkg.agentcrm.minSkillsVersion, dataSchema: pkg.agentcrm.dataSchema };
}

export const PACKAGE_NAME = pkg.name;
