import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "./paths";
import { compareVersions } from "./semver";

// Read-only HTTP probes of a hosted admin — what the browser actually
// gets. No credentials involved.

export interface FetchResult {
  ok: boolean;
  status: number;
  contentType: string;
  text: string;
  headers: Headers | null;
  error?: string;
}

export async function fetchText(url: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<FetchResult> {
  try {
    const u = new URL(url);
    if (!init.method || init.method === "GET") u.searchParams.set("agentcrm", String(Date.now()));
    const res = await fetchImpl(u.href, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(15000), ...init });
    const text = await res.text();
    return { ok: res.ok, status: res.status, contentType: res.headers.get("content-type") ?? "", text, headers: res.headers };
  } catch (err) {
    return { ok: false, status: 0, contentType: "", text: "", headers: null, error: (err as Error).message };
  }
}

// window.__AGENTCRM_CONFIG__ = {...}; → the object (null when empty).
export function parseConfigJs(source: string): Record<string, unknown> | null {
  const m = /window\.__AGENTCRM_CONFIG__\s*=\s*([\s\S]*?);?\s*$/.exec(source.trim());
  if (!m) throw new Error("config.js does not set window.__AGENTCRM_CONFIG__");
  const value = JSON.parse(m[1].trim().replace(/;$/, "")) as unknown;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

// Secret-looking keys that must never be published in config.js.
export function findSecretKeys(value: unknown, path = ""): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
    const here = path ? `${path}.${k}` : k;
    if (/^(token|apiKey|secretAccessKey|accessKeyId|accessToken|password|passphrase|refreshToken|clientSecret)$/.test(k) && typeof v === "string" && v) {
      // The Firebase web apiKey is public by design.
      if (k === "apiKey" && path === "firebase") return [];
      return [here];
    }
    return findSecretKeys(v, here);
  });
}

export interface HostedAdmin {
  version: string | null;
  dataSchema: number | null;
  error?: string;
}

// <admin>/version.json is uploaded with every admin (install / deploy-admin).
export async function fetchHostedAdmin(adminUrl: string, fetchImpl: typeof fetch = fetch): Promise<HostedAdmin> {
  const base = adminUrl.replace(/\/?$/, "/");
  let res = await fetchText(`${base}version.json`, {}, fetchImpl);
  // Admins uploaded by the setup wizard carry admin-files.json (version + files).
  if (!res.ok) {
    const manifest = await fetchText(`${base}admin-files.json`, {}, fetchImpl);
    if (manifest.ok) res = manifest;
  }
  if (!res.ok) return { version: null, dataSchema: null, error: res.error ?? `HTTP ${res.status}` };
  try {
    const m = JSON.parse(res.text) as { version?: string; dataSchema?: number };
    return { version: m.version ?? null, dataSchema: m.dataSchema ?? null };
  } catch {
    return { version: null, dataSchema: null, error: "version.json is not valid JSON" };
  }
}

// An admin uploaded to a `local-folder` hosting without a public URL
// (`siteUrl`) is still on this computer: its folder, or null.
export function localAdminFolder(hosting: { type?: string; connectorId: string; settings: Record<string, unknown>; folder?: string } | null | undefined): string | null {
  if (!hosting || hosting.connectorId !== "local-folder") return null;
  const root = typeof hosting.settings.path === "string" ? hosting.settings.path : "";
  if (!root) return null;
  return join(root, hosting.folder ?? "admin");
}

// Same as fetchHostedAdmin, for an admin in a folder of this computer.
export function readLocalAdmin(folder: string): HostedAdmin {
  for (const name of ["version.json", "admin-files.json"]) {
    const file = join(folder, name);
    if (!existsSync(file)) continue;
    try {
      const m = JSON.parse(readFileSync(file, "utf8")) as { version?: string; dataSchema?: number };
      return { version: m.version ?? null, dataSchema: m.dataSchema ?? null };
    } catch {
      return { version: null, dataSchema: null, error: `${name} is not valid JSON` };
    }
  }
  return { version: null, dataSchema: null, error: `no version.json in ${folder}` };
}

// Version of a site's admin: fetched from its URL, read from its local
// folder, or nothing when it isn't hosted.
export async function siteAdminVersion(site: { adminUrl: string | null; hosting: Parameters<typeof localAdminFolder>[0] }): Promise<HostedAdmin & { source: "url" | "folder" | "none" }> {
  if (site.adminUrl) return { ...(await fetchHostedAdmin(site.adminUrl)), source: "url" };
  const folder = localAdminFolder(site.hosting);
  if (folder) return { ...readLocalAdmin(folder), source: "folder" };
  return { version: null, dataSchema: null, source: "none" };
}

export interface ChangelogEntry {
  version: string;
  date: string;
  breaking: boolean;
  changes: string[];
  actions: string[];
}

export function readChangelog(): ChangelogEntry[] {
  try {
    const data = JSON.parse(readFileSync(join(packageRoot(), "changelog.json"), "utf8")) as { versions?: ChangelogEntry[] };
    return data.versions ?? [];
  } catch {
    return [];
  }
}

// Entries newer than `from` up to and including `to`.
export function changesBetween(entries: ChangelogEntry[], from: string, to: string) {
  const list = entries.filter((e) => compareVersions(e.version, from) > 0 && compareVersions(e.version, to) <= 0);
  return {
    versions: list.map((e) => e.version),
    breaking: list.some((e) => e.breaking),
    changes: list.flatMap((e) => e.changes.map((c) => `${e.version}: ${c}`)),
    actions: [...new Set(list.flatMap((e) => e.actions))],
  };
}

// Latest published version on npm (null when offline).
export async function fetchLatestVersion(pkg: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`https://registry.npmjs.org/${pkg.replace("/", "%2F")}/latest`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const v = (await res.json()) as { version?: string };
    return typeof v.version === "string" ? v.version : null;
  } catch {
    return null;
  }
}
