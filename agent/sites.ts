import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { RuntimeConfig } from "../src/lib/runtimeConfig";
import { homePath, readJsonFile, writeJsonFile } from "./home";
import { CliError } from "./output";

// Registry of the CRMs this computer manages (mirror of cms-ia
// agent/sites.ts). One agent can drive many CRMs; every command that
// touches one resolves which explicitly (--site, ./agentcrm.json, the
// only site, the default) and refuses to guess when several are
// possible. Never holds secrets: credentials are referenced by account id.

export interface SiteHosting {
  // Install plan hosting type ("s3", "github-pages", "local-folder"…).
  type: string;
  connectorId: string;
  // Public settings only (secrets come from the hosting credential).
  settings: Record<string, unknown>;
  // Folder of the admin on the hosting ("admin" by convention).
  folder: string;
}

export interface SiteRecord {
  alias: string;
  name?: string;
  // What config.js holds: backend + public settings.
  runtime: RuntimeConfig;
  // Journal datasets in a folder of this computer (local-folder).
  dataPath?: string;
  hosting: SiteHosting | null;
  // Where the hosted admin is served (…/admin/), null when not hosted.
  adminUrl: string | null;
  // Account ids: data location / git / Firebase login, hosting, passphrase.
  credentials: { data?: string; hosting?: string; passphrase?: string };
  // Email of the CRM user the CLI acts as (the install's admin).
  user?: string;
  adminVersion?: string;
  installedAt: string;
  updatedAt: string;
}

interface SitesFile {
  version: 1;
  default: string | null;
  sites: Record<string, SiteRecord>;
}

const ALIAS_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

function file(): string {
  return homePath("sites.json");
}

function load(): SitesFile {
  return readJsonFile<SitesFile>(file(), { version: 1, default: null, sites: {} });
}

function save(data: SitesFile): void {
  writeJsonFile(file(), data);
}

export function validateAlias(alias: string): string {
  if (!ALIAS_RE.test(alias)) {
    throw new CliError("invalid-alias", `Invalid site alias "${alias}".`, "Lower-case letters, digits and dashes, e.g. acme-crm.", 2);
  }
  return alias;
}

export function listSites(): { default: string | null; sites: SiteRecord[] } {
  const data = load();
  return { default: data.default, sites: Object.values(data.sites).sort((a, b) => a.alias.localeCompare(b.alias)) };
}

export function getSite(alias: string): SiteRecord | null {
  return load().sites[alias] ?? null;
}

export function putSite(site: SiteRecord): void {
  const data = load();
  data.sites[site.alias] = { ...site, updatedAt: new Date().toISOString() };
  save(data);
}

export function removeSite(alias: string): boolean {
  const data = load();
  if (!data.sites[alias]) return false;
  delete data.sites[alias];
  if (data.default === alias) data.default = null;
  save(data);
  return true;
}

export function renameSite(from: string, to: string): void {
  validateAlias(to);
  const data = load();
  const site = data.sites[from];
  if (!site) throw siteNotFound(from, data);
  if (data.sites[to]) throw new CliError("site-exists", `A site named "${to}" already exists.`);
  delete data.sites[from];
  data.sites[to] = { ...site, alias: to, updatedAt: new Date().toISOString() };
  if (data.default === from) data.default = to;
  save(data);
}

export function setDefaultSite(alias: string): void {
  const data = load();
  if (!data.sites[alias]) throw siteNotFound(alias, data);
  data.default = alias;
  save(data);
}

// agentcrm.json in the current folder or a parent: { "site": "<alias>" }
// — lets a project folder pin the CRM it belongs to.
export function findProjectSite(cwd = process.cwd()): { alias: string; file: string } | null {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = join(dir, "agentcrm.json");
    if (existsSync(candidate)) {
      try {
        const alias = (JSON.parse(readFileSync(candidate, "utf8")) as { site?: unknown }).site;
        if (typeof alias === "string" && alias) return { alias, file: candidate };
      } catch {
        /* not ours */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function siteNotFound(alias: string, data: SitesFile): CliError {
  const known = Object.keys(data.sites);
  return new CliError(
    "site-not-found",
    `No site named "${alias}".`,
    known.length ? `Known sites: ${known.join(", ")}.` : "No CRM registered yet — run `agentcrm install --plan …` or `agentcrm site add`.",
  );
}

// --site > $AGENTCRM_SITE > ./agentcrm.json > the only site > the default
// chosen with `site use`. With several sites and nothing chosen, refuses:
// the agent must ask the user.
export function resolveSite(explicit?: string): SiteRecord {
  const data = load();
  const chosen = explicit || process.env.AGENTCRM_SITE?.trim() || findProjectSite()?.alias;
  if (chosen) {
    const site = data.sites[chosen];
    if (!site) throw siteNotFound(chosen, data);
    return site;
  }
  const all = Object.values(data.sites);
  if (all.length === 1) return all[0];
  if (all.length === 0) throw siteNotFound("(none)", data);
  if (data.default && data.sites[data.default]) return data.sites[data.default];
  throw new CliError(
    "site-required",
    `Several CRMs are registered: ${all.map((s) => s.alias).join(", ")}.`,
    "Ask the user which one, then pass --site <alias> (or `agentcrm site use <alias>`).",
    2,
  );
}

// One write operation per site at a time. Stale locks (dead pid) are taken over.
export function lockSite(alias: string): () => void {
  const dir = homePath("locks");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${alias}.lock`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => {
        try {
          unlinkSync(path);
        } catch {
          // Already gone.
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const pid = Number(readFileSync(path, "utf8"));
      if (pid && pid !== process.pid && isAlive(pid)) {
        throw new CliError("site-busy", `Another agentcrm process (pid ${pid}) is writing to "${alias}".`, "Wait for it to finish, then retry.");
      }
      if (pid === process.pid) {
        // Same process (MCP server, tests): re-entrant.
        return () => undefined;
      }
      unlinkSync(path);
    }
  }
  throw new CliError("site-busy", `Could not lock "${alias}".`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
