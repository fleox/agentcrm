import { isAbsolute, resolve } from "node:path";
import { splitSecretSettings, type RuntimeConfig } from "../../src/lib/runtimeConfig";
import { findBackend, findHosting, findLocation, LOCATIONS, HOSTINGS } from "../catalog";
import { getCredential, parseAccount, requireCredential } from "../credentials";
import { CliError } from "../output";
import type { SiteHosting } from "../sites";
import { validateAlias } from "../sites";

// An install plan is what the agent writes after asking the user (data
// location first, then the admin hosting). It never contains secrets —
// only account ids of stored credentials. `agentcrm options --json`
// documents every field.

export interface TargetSpec {
  type: string;
  settings?: Record<string, unknown>;
  credential?: string;
}

export interface InstallPlan {
  alias: string;
  name?: string;
  // The first CRM admin; the CLI acts as this user on the site.
  owner: { name: string; email: string };
  data:
    | { backend: "journal"; location: TargetSpec; root?: string; encryption?: { credential?: string } | false }
    | { backend: "git-json"; git: Record<string, unknown>; credential: string }
    | { backend: "firebase"; firebase: Record<string, unknown>; credential: string; signInMethods?: string[] };
  // Where the admin app is uploaded; false = not hosted (use `agentcrm serve`).
  hosting?: (TargetSpec & { folder?: string }) | false;
  demo?: boolean;
  currency?: string;
  locale?: string;
}

export interface Target {
  connectorId: string;
  // Connector settings WITH secrets (never persisted).
  settings: Record<string, unknown>;
}

export interface ResolvedPlan {
  alias: string;
  name: string;
  owner: { name: string; email: string };
  backend: "journal" | "git-json" | "firebase";
  runtime: RuntimeConfig;
  // Journal: the data location connector (with secrets) and its type.
  dataTarget?: Target;
  dataType?: string;
  dataPath?: string;
  // Backend secrets (git token / Firebase login) for createDataStore.
  backendSecrets?: Record<string, unknown>;
  passphraseAccount?: string;
  passphrase?: string;
  hostingTarget: Target | null;
  hosting: SiteHosting | null;
  adminUrl: string | null;
  credentials: { data?: string; hosting?: string; passphrase?: string };
  demo: boolean;
  currency?: string;
  locale?: string;
  warnings: string[];
}

const SECRET_KEYS = ["token", "apiKey", "accessKeyId", "secretAccessKey", "passphrase", "password"];

function fail(message: string, hint?: string): never {
  throw new CliError("invalid-plan", message, hint ?? "Run `agentcrm options --json` for the expected fields.", 2);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function cleanFolder(folder: string): string {
  return folder.trim().replace(/^\/+|\/+$/g, "");
}

function copySettings(spec: TargetSpec, field: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec.settings ?? {})) {
    if (v === undefined || v === null) continue;
    if (SECRET_KEYS.includes(k)) fail(`${field}.settings.${k} must not be in the plan — store it with \`agentcrm credentials set\` and reference the account in ${field}.credential.`);
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

function credentialValues(account: string, allowed: string[], field: string): Record<string, string> {
  const { type } = parseAccount(account);
  if (!allowed.includes(type)) fail(`${field}.credential must be a ${allowed.join(" / ")} account, got ${type}.`);
  return requireCredential(account).values;
}

// Data location of a journal dataset.
export function resolveLocation(spec: TargetSpec, field = "data.location"): { target: Target; account?: string; type: string; path?: string } {
  const type = str(spec?.type);
  const loc = findLocation(type);
  if (!loc) fail(`Unknown ${field}.type "${type}" (one of ${LOCATIONS.map((l) => l.id).join(", ")}).`);
  const s = copySettings(spec, field);
  if (type === "local-folder") {
    const path = str(s.path);
    if (!path || !isAbsolute(path)) fail(`${field}.settings.path must be an absolute folder path.`);
    return { target: { connectorId: "local-folder", settings: { handleKey: "data-folder", path: resolve(path) } }, type, path: resolve(path) };
  }
  const account = str(spec.credential);
  if (!account) fail(`${field}.credential is required (${loc.credentialTypes.join(" / ")} account).`);
  const secrets = credentialValues(account, loc.credentialTypes, field);
  if (type === "s3") {
    if (!str(s.bucket)) fail(`${field}.settings.bucket is required.`);
    if (!str(s.region) && !str(s.endpoint)) fail(`${field}.settings.region is required.`);
    return { target: { connectorId: "s3", settings: { region: str(s.region) || "us-east-1", ...s, siteUrl: "", ...secrets } }, account, type };
  }
  if (type === "github" && (!str(s.owner) || !str(s.repo))) fail(`${field}.settings.owner and .repo are required.`);
  if (type === "gitlab" && !str(s.project)) fail(`${field}.settings.project is required.`);
  return {
    target: { connectorId: "git-pages", settings: { ...s, provider: type, branch: str(s.branch) || "main", host: "other", siteUrl: "", ...secrets } },
    account,
    type,
  };
}

// Where the admin app is uploaded.
export function resolveHosting(
  spec: TargetSpec & { folder?: string },
  reuse?: string,
): { target: Target; hosting: SiteHosting; adminUrl: string | null; account?: string } {
  const type = str(spec?.type);
  const h = findHosting(type);
  if (!h) fail(`Unknown hosting.type "${type}" (one of ${HOSTINGS.map((x) => x.id).join(", ")}).`);
  if (!h.cli) fail(`hosting "${type}" can't be set up from the CLI.`, h.notes.join(" "));
  const s = copySettings(spec, "hosting");
  const folder = cleanFolder(str(spec.folder) || "admin");
  if (!/^[\w.-]+(\/[\w.-]+)*$/.test(folder)) fail("hosting.folder must be a relative folder name, e.g. admin.");
  let settings: Record<string, unknown>;
  let account = str(spec.credential);
  if (type === "local-folder") {
    const path = str(s.path);
    if (!path || !isAbsolute(path)) fail("hosting.settings.path must be an absolute folder path.");
    settings = { path: resolve(path), siteUrl: str(s.siteUrl) };
    account = "";
  } else {
    if (type === "s3") {
      if (!str(s.bucket)) fail("hosting.settings.bucket is required.");
      settings = { region: str(s.region) || "us-east-1", ...s };
    } else {
      const provider = type === "github-pages" ? "github" : type === "gitlab-pages" ? "gitlab" : str(s.provider) || "github";
      if (provider === "github" && (!str(s.owner) || !str(s.repo))) fail("hosting.settings.owner and .repo are required.");
      if (provider === "gitlab" && !str(s.project)) fail("hosting.settings.project is required.");
      const siteUrl = str(s.siteUrl) || (type === "github-pages" ? `https://${str(s.owner).toLowerCase()}.github.io/${str(s.repo)}` : "");
      settings = {
        ...s,
        provider,
        branch: str(s.branch) || "main",
        dir: cleanFolder(str(s.dir) || (type === "gitlab-pages" ? "public" : "")),
        host: type === "cloudflare-pages" ? "cloudflare-pages" : type,
        siteUrl,
      };
      // Same git provider as the data → the data token publishes too.
      if (!account && reuse && parseAccount(reuse).type === provider) account = reuse;
    }
    if (!account) fail(`hosting.credential is required (${h.credentialTypes.join(" / ")} account).`);
  }
  const siteUrl = str(settings.siteUrl).replace(/\/+$/, "");
  if (type !== "local-folder" && !/^https?:\/\/[^/]+/.test(siteUrl)) fail("hosting.settings.siteUrl must be an http(s) URL.");
  if (siteUrl) settings.siteUrl = siteUrl;
  const secrets = account ? credentialValues(account, h.credentialTypes, "hosting") : {};
  const publicSettings = Object.fromEntries(Object.entries(splitSecretSettings(settings).publicSettings));
  return {
    target: { connectorId: h.connectorId, settings: { ...settings, ...secrets } },
    hosting: { type, connectorId: h.connectorId, settings: publicSettings, folder },
    adminUrl: siteUrl ? `${siteUrl}/${folder}/` : null,
    account: account || undefined,
  };
}

export function resolvePlan(plan: InstallPlan, opts: { kdfDefault?: boolean } = {}): ResolvedPlan {
  void opts;
  if (!plan || typeof plan !== "object") fail("The plan must be a JSON object.");
  const alias = validateAlias(str(plan.alias));
  const name = str(plan.name) || alias;
  const ownerEmail = str(plan.owner?.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) fail("owner.email (the first CRM admin) is required.", 'e.g. "owner": { "name": "Ada Lovelace", "email": "ada@acme.com" }');
  const owner = { name: str(plan.owner?.name) || ownerEmail.split("@")[0], email: ownerEmail };

  const backendId = str(plan.data?.backend);
  const backend = findBackend(backendId);
  if (!backend) fail(`Unknown data.backend "${backendId}" (journal, git-json, firebase).`);
  if (!backend.cli) fail(`Data backend "${backend.id}" can't be set up from the CLI.`, backend.notes.join(" "));

  const credentials: ResolvedPlan["credentials"] = {};
  const warnings: string[] = [];
  let runtime: RuntimeConfig;
  let dataTarget: Target | undefined;
  let dataType: string | undefined;
  let dataPath: string | undefined;
  let backendSecrets: Record<string, unknown> | undefined;
  let passphraseAccount: string | undefined;
  let passphrase: string | undefined;

  if (plan.data.backend === "journal") {
    const data = plan.data;
    const loc = resolveLocation(data.location);
    dataTarget = loc.target;
    dataType = loc.type;
    dataPath = loc.path;
    if (loc.account) credentials.data = loc.account;
    const root = cleanFolder(str(data.root) || "agentcrm");
    const encrypted = data.encryption !== false;
    if (encrypted) {
      const enc = data.encryption === undefined ? {} : (data.encryption as { credential?: string });
      passphraseAccount = str(enc.credential) || `passphrase:${alias}`;
      if (parseAccount(passphraseAccount).type !== "passphrase") fail("data.encryption.credential must be a passphrase account.");
      const stored = getCredential(passphraseAccount)?.values.passphrase;
      if (!stored && enc.credential) requireCredential(passphraseAccount);
      passphrase = stored;
      credentials.passphrase = passphraseAccount;
    } else {
      warnings.push("The dataset is NOT encrypted: anyone who can read the storage reads every contact. Keep the location private.");
    }
    const publicSettings = splitSecretSettings(dataTarget.settings).publicSettings;
    delete publicSettings.path;
    delete publicSettings.siteUrl;
    runtime = { backend: "journal", name, journal: { connectorId: dataTarget.connectorId, settings: publicSettings, root, encrypted } };
  } else if (plan.data.backend === "git-json") {
    const g = (plan.data.git ?? {}) as Record<string, unknown>;
    const provider = str(g.provider);
    if (provider !== "github" && provider !== "gitlab") fail('data.git.provider must be "github" or "gitlab".');
    if (provider === "github" && (!str(g.owner) || !str(g.repo))) fail("data.git.owner and data.git.repo are required for GitHub.");
    if (provider === "gitlab" && !str(g.project)) fail("data.git.project is required for GitLab.");
    const account = str(plan.data.credential);
    if (!account) fail("data.credential is required (e.g. github:acme).");
    backendSecrets = credentialValues(account, [provider], "data");
    credentials.data = account;
    runtime = {
      backend: "git-json",
      name,
      git: {
        provider,
        ...(provider === "github" ? { owner: str(g.owner), repo: str(g.repo) } : { project: str(g.project) }),
        branch: str(g.branch) || "main",
        ...(str(g.apiBaseUrl) ? { apiBaseUrl: str(g.apiBaseUrl) } : {}),
        dir: cleanFolder(str(g.dir)),
      },
    };
    warnings.push("git-json keeps every past value in the repository history: deleted records stay readable there. Keep the repository private.");
  } else {
    const fb = (plan.data.firebase ?? {}) as Record<string, unknown>;
    for (const k of ["apiKey", "authDomain", "projectId", "appId"]) if (!str(fb[k])) fail(`data.firebase.${k} is required (Firebase console → Project settings → Your apps → config).`);
    const account = str(plan.data.credential);
    if (!account) fail("data.credential is required (firebase:<name>, email + password of the first admin).");
    backendSecrets = credentialValues(account, ["firebase"], "data");
    credentials.data = account;
    const methods = Array.isArray(plan.data.signInMethods) ? plan.data.signInMethods.filter((m) => m === "password" || m === "google") : [];
    runtime = {
      backend: "firebase",
      name,
      firebase: Object.fromEntries(["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "measurementId"].filter((k) => str(fb[k])).map((k) => [k, str(fb[k])])),
      ...(methods.length ? { signInMethods: [...new Set(["password", ...methods])] as ("password" | "google")[] } : {}),
    };
  }

  let hostingTarget: Target | null = null;
  let hosting: SiteHosting | null = null;
  let adminUrl: string | null = null;
  if (plan.hosting) {
    const h = resolveHosting(plan.hosting, credentials.data);
    hostingTarget = h.target;
    hosting = h.hosting;
    adminUrl = h.adminUrl;
    if (h.account) credentials.hosting = h.account;
    if (adminUrl && !adminUrl.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(adminUrl)) {
      warnings.push(`${adminUrl} is plain HTTP: browsers only allow the admin's request signing and encryption on HTTPS pages. Put HTTPS (a CDN) in front.`);
    }
    if (dataTarget && hostingTarget.connectorId === "s3" && dataTarget.connectorId === "s3" && hostingTarget.settings.bucket === dataTarget.settings.bucket && hostingTarget.settings.endpoint === dataTarget.settings.endpoint) {
      warnings.push(
        runtime.backend === "journal" && runtime.journal.encrypted
          ? "The data lives in the bucket that serves the admin: the encrypted files are downloadable by anyone. Prefer a separate private bucket."
          : "The data lives UNENCRYPTED in the public bucket that serves the admin: anyone can download every contact. Use a separate private bucket or encryption.",
      );
    }
  }

  return {
    alias,
    name,
    owner,
    backend: runtime.backend as ResolvedPlan["backend"],
    runtime,
    dataTarget,
    dataType,
    dataPath,
    backendSecrets,
    passphraseAccount,
    passphrase,
    hostingTarget,
    hosting,
    adminUrl,
    credentials,
    demo: plan.demo === true,
    currency: str(plan.currency) || undefined,
    locale: str(plan.locale) || undefined,
    warnings,
  };
}

export const PLAN_EXAMPLE: InstallPlan = {
  alias: "acme-crm",
  name: "Acme CRM",
  owner: { name: "Ada Lovelace", email: "ada@acme.com" },
  data: {
    backend: "journal",
    location: { type: "s3", settings: { endpoint: "https://s3.gra.io.cloud.ovh.net", region: "gra", bucket: "acme-crm-data" }, credential: "s3:ovh" },
    root: "agentcrm",
  },
  hosting: { type: "s3", settings: { endpoint: "https://s3.gra.io.cloud.ovh.net", region: "gra", bucket: "acme-crm-admin", siteUrl: "https://crm.acme.com", publicRead: true }, credential: "s3:ovh", folder: "admin" },
  demo: false,
};
