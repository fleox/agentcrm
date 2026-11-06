// Runtime configuration resolver (mirror of cms-ia src/lib/runtimeConfig.ts).
// Picks the data backend + its PUBLIC settings from, in order:
//
//   1. window.__AGENTCRM_CONFIG__ — set synchronously by <admin>/config.js
//      before the bundle loads (written by the setup wizard or the CLI
//      next to the admin on its hosting);
//   2. localStorage `agentcrm.runtimeConfig` — admins running locally (or
//      on a host where config.js can't be written).
//
// config.js wins when both exist. It NEVER contains a secret: tokens,
// access keys and passphrases stay in each browser (localStorage keys
// `agentcrm.secrets:<…>`, see the helpers at the bottom) or in the CLI
// credentials file.

import type { FirebaseOptions } from "firebase/app";

declare global {
  interface Window {
    __AGENTCRM_CONFIG__?: RuntimeConfig | null;
  }
}

export type RuntimeBackendKind = "local" | "journal" | "git-json" | "firebase";

// Single-user data in this browser (IndexedDB). No login.
export interface LocalRuntimeConfig {
  backend: "local";
  name?: string;
}

// Encrypted snapshot + append-only journal on any storage connector
// (src/data/journal/). Only the connector's public settings live here
// (bucket, endpoint, repo…); its secrets are per browser.
export interface JournalRuntimeConfig {
  backend: "journal";
  name?: string;
  journal: {
    // "s3" | "git-pages" | "local-folder" | "browser-mirror"
    connectorId: string;
    settings: Record<string, unknown>;
    // Folder of the dataset on that connector, e.g. "agentcrm".
    root: string;
    // Files encrypted with a passphrase each browser enters once.
    encrypted: boolean;
  };
}

// One JSON file per document in a private git repo (src/data/gitJson.ts).
export interface GitJsonRuntimeConfig {
  backend: "git-json";
  name?: string;
  git: {
    provider: "github" | "gitlab" | "local";
    owner?: string;
    repo?: string;
    project?: string;
    branch: string;
    apiBaseUrl?: string;
    // Repo sub-folder holding the data ("" = repo root).
    dir: string;
  };
}

export type FirebaseSignInMethod = "password" | "google";
export const FIREBASE_SIGN_IN_METHODS: readonly FirebaseSignInMethod[] = ["password", "google"];

// Firestore + Firebase Auth (src/data/firebase.ts). The web config is public.
export interface FirebaseRuntimeConfig {
  backend: "firebase";
  name?: string;
  firebase: FirebaseOptions;
  signInMethods?: FirebaseSignInMethod[];
  // Files (images, attachments) through an HTTP endpoint instead of
  // Firebase Storage (src/data/files/http.ts): absolute URL, or relative
  // to the admin page.
  files?: { endpoint: string };
}

export type RuntimeConfig = LocalRuntimeConfig | JournalRuntimeConfig | GitJsonRuntimeConfig | FirebaseRuntimeConfig;

function nonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// Validates an untrusted value (config.js, localStorage, CLI site file)
// and returns a normalised config, or null.
export function parseRuntimeConfig(raw: unknown): RuntimeConfig | null {
  if (!isObject(raw)) return null;
  const name = nonEmpty(raw.name) ? raw.name : undefined;
  const withName = <T extends object>(c: T): T => (name ? { ...c, name } : c);
  switch (raw.backend) {
    case "local":
      return withName({ backend: "local" as const });
    case "journal": {
      const j = raw.journal;
      if (!isObject(j) || !nonEmpty(j.connectorId) || !isObject(j.settings)) return null;
      return withName({
        backend: "journal" as const,
        journal: {
          connectorId: j.connectorId,
          settings: j.settings,
          root: typeof j.root === "string" ? j.root.replace(/^\/+|\/+$/g, "") : "",
          encrypted: j.encrypted !== false,
        },
      });
    }
    case "git-json": {
      const g = raw.git;
      if (!isObject(g)) return null;
      const provider = g.provider as GitJsonRuntimeConfig["git"]["provider"];
      if (provider !== "github" && provider !== "gitlab" && provider !== "local") return null;
      if (provider === "github" && !(nonEmpty(g.owner) && nonEmpty(g.repo))) return null;
      if (provider === "gitlab" && !nonEmpty(g.project)) return null;
      if (provider !== "local" && !nonEmpty(g.branch)) return null;
      return withName({
        backend: "git-json" as const,
        git: {
          provider,
          ...(nonEmpty(g.owner) ? { owner: g.owner } : {}),
          ...(nonEmpty(g.repo) ? { repo: g.repo } : {}),
          ...(nonEmpty(g.project) ? { project: g.project } : {}),
          branch: nonEmpty(g.branch) ? g.branch : "main",
          ...(nonEmpty(g.apiBaseUrl) ? { apiBaseUrl: g.apiBaseUrl } : {}),
          dir: typeof g.dir === "string" ? g.dir.replace(/^\/+|\/+$/g, "") : "",
        },
      });
    }
    case "firebase": {
      const fb = raw.firebase;
      if (!isObject(fb) || !nonEmpty(fb.apiKey) || !nonEmpty(fb.projectId)) return null;
      const methods = Array.isArray(raw.signInMethods)
        ? (raw.signInMethods.filter((m) => FIREBASE_SIGN_IN_METHODS.includes(m as FirebaseSignInMethod)) as FirebaseSignInMethod[])
        : [];
      const files = isObject(raw.files) && nonEmpty(raw.files.endpoint) ? { endpoint: raw.files.endpoint.trim() } : null;
      return withName({
        backend: "firebase" as const,
        firebase: fb as FirebaseOptions,
        ...(methods.length ? { signInMethods: methods } : {}),
        ...(files ? { files } : {}),
      });
    }
    default:
      return null;
  }
}

export const LOCAL_RUNTIME_CONFIG_KEY = "agentcrm.runtimeConfig";

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function readFromLocalStorage(): unknown {
  try {
    const raw = storage()?.getItem(LOCAL_RUNTIME_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let cached: RuntimeConfig | null | undefined;
// Set by the CLI / tests: bypasses window + localStorage entirely.
let override: RuntimeConfig | null | undefined;

export function getRuntimeConfig(): RuntimeConfig | null {
  if (override !== undefined) return override;
  if (cached !== undefined) return cached;
  const fromScript = typeof window !== "undefined" ? window.__AGENTCRM_CONFIG__ : undefined;
  cached = parseRuntimeConfig(fromScript) ?? parseRuntimeConfig(readFromLocalStorage());
  return cached;
}

// The CLI (one process per site) and tests set the config explicitly.
// Pass undefined to go back to window / localStorage resolution.
export function setRuntimeConfigOverride(config: RuntimeConfig | null | undefined): void {
  override = config;
}

export function resetRuntimeConfigCache(): void {
  cached = undefined;
}

export function saveLocalRuntimeConfig(config: RuntimeConfig | null): void {
  try {
    const s = storage();
    if (config) s?.setItem(LOCAL_RUNTIME_CONFIG_KEY, JSON.stringify(stripSecrets(config)));
    else s?.removeItem(LOCAL_RUNTIME_CONFIG_KEY);
  } catch {
    // Storage blocked — the caller falls back to config.js.
  }
  cached = undefined;
}

export function getBackendKind(): RuntimeBackendKind | null {
  return getRuntimeConfig()?.backend ?? null;
}

// ─── Secrets ─────────────────────────────────────────────────────────────

// Setting keys that are secret wherever they appear in connector settings.
export const SECRET_SETTING_KEYS: ReadonlySet<string> = new Set([
  "token",
  "secretAccessKey",
  "accessKeyId",
  "password",
  "passphrase",
  "apiToken",
  "clientSecret",
  "refreshToken",
]);

export function splitSecretSettings(settings: Record<string, unknown>): {
  publicSettings: Record<string, unknown>;
  secrets: Record<string, unknown>;
} {
  const publicSettings: Record<string, unknown> = {};
  const secrets: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settings)) {
    if (SECRET_SETTING_KEYS.has(k)) {
      if (v !== "" && v != null) secrets[k] = v;
    } else {
      publicSettings[k] = v;
    }
  }
  return { publicSettings, secrets };
}

// Defensive: a config about to be serialised never carries secrets, even
// if a caller passed connector settings straight from a form.
function stripSecrets(config: RuntimeConfig): RuntimeConfig {
  if (config.backend !== "journal") return config;
  return { ...config, journal: { ...config.journal, settings: splitSecretSettings(config.journal.settings).publicSettings } };
}

// Serialises a runtime config into the JS source of <admin>/config.js.
// Never contains a secret.
export function buildConfigJsSource(config: RuntimeConfig): string {
  const banner =
    "// Generated by AgentCRM setup. Do not edit by hand — re-run the setup\n" +
    "// (or `agentcrm install`) to update. Contains no secrets.\n";
  const clean = stripSecrets(parseRuntimeConfig(config) ?? config);
  return `${banner}window.__AGENTCRM_CONFIG__ = ${JSON.stringify(clean, null, 2)};\n`;
}

export const SECRET_PREFIX = "agentcrm.secrets:";

// Stable id of the dataset a config points at — secrets are scoped to it
// so one browser can hold credentials for several CRMs.
export function datasetId(config: RuntimeConfig): string {
  switch (config.backend) {
    case "local":
      return "local";
    case "journal": {
      const s = config.journal.settings;
      const where = [s.endpoint, s.bucket, s.prefix, s.owner, s.repo, s.project, s.branch, s.dir, s.handleKey]
        .filter((v) => typeof v === "string" && v)
        .join("/");
      return `journal:${config.journal.connectorId}:${where}:${config.journal.root}`;
    }
    case "git-json":
      return `git:${gitRepoId(config.git)}:${config.git.dir}`;
    case "firebase":
      return `firebase:${config.firebase.projectId}`;
  }
}

export function gitRepoId(git: GitJsonRuntimeConfig["git"] | { provider: string; owner?: string; repo?: string; project?: string }): string {
  if (git.provider === "github") return `github:${git.owner}/${git.repo}`;
  if (git.provider === "gitlab") return `gitlab:${git.project}`;
  return "local";
}

export function getSecret(key: string): string | null {
  try {
    return storage()?.getItem(SECRET_PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export function setSecret(key: string, value: string | null): void {
  try {
    const s = storage();
    if (value) s?.setItem(SECRET_PREFIX + key, value);
    else s?.removeItem(SECRET_PREFIX + key);
  } catch {
    // Storage blocked — the secret won't survive a reload.
  }
}

export function getSecretJson<T extends object>(key: string): T | null {
  const raw = getSecret(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setSecretJson(key: string, value: object | null): void {
  setSecret(key, value && Object.keys(value).length ? JSON.stringify(value) : null);
}

// Secret connector settings of a journal dataset (token, keys).
export function getConnectorSecrets(config: RuntimeConfig): Record<string, unknown> {
  return getSecretJson<Record<string, unknown>>(`connector:${datasetId(config)}`) ?? {};
}

export function setConnectorSecrets(config: RuntimeConfig, secrets: Record<string, unknown> | null): void {
  setSecretJson(`connector:${datasetId(config)}`, secrets);
}

// Passphrase of an encrypted dataset.
export function getPassphrase(config: RuntimeConfig): string | null {
  return getSecret(`passphrase:${datasetId(config)}`);
}

export function setPassphrase(config: RuntimeConfig, passphrase: string | null): void {
  setSecret(`passphrase:${datasetId(config)}`, passphrase);
}

// Secret settings of the hosting target (config/hosting holds the public
// part) — used by the siteFiles facade to publish the admin / forms.
export function getHostingSecrets(config: RuntimeConfig): Record<string, unknown> {
  return getSecretJson<Record<string, unknown>>(`hosting:${datasetId(config)}`) ?? {};
}

export function setHostingSecrets(config: RuntimeConfig, secrets: Record<string, unknown> | null): void {
  setSecretJson(`hosting:${datasetId(config)}`, secrets);
}

// Per-user git token (git-json backend, git-pages connector token reuse).
export function getGitToken(git: { provider: string; owner?: string; repo?: string; project?: string }): string | null {
  return getSecret(`gitToken:${gitRepoId(git)}`);
}

export function setGitToken(git: { provider: string; owner?: string; repo?: string; project?: string }, token: string | null): void {
  setSecret(`gitToken:${gitRepoId(git)}`, token?.trim() || null);
}

// Removes every secret this browser holds for a dataset ("sign out").
export function forgetSecrets(config: RuntimeConfig): void {
  setConnectorSecrets(config, null);
  setHostingSecrets(config, null);
  setPassphrase(config, null);
  if (config.backend === "git-json") setGitToken(config.git, null);
}
