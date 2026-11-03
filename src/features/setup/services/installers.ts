// Setup logic without UI (mirror of cms-ia src/pages/setup/installers.ts).
// The wizard: Terms → Data model → Location / connection (verified with
// a side-effect-free test that also detects an existing dataset) →
// Admin hosting (optional) → Workspace → Install (everything below).
// Failures throw SetupError so the wizard can render a precise message.

import type { FirebaseOptions } from "firebase/app";
import { createDataStore, type DataStore, type StoreIdentity } from "../../../data";
import { checkJournalPassphrase } from "../../../data/journal/rekey";
import type { BackendOptions } from "../../../data/registry";
import {
  datasetId,
  saveLocalRuntimeConfig,
  setConnectorSecrets,
  setGitToken,
  setHostingSecrets,
  setPassphrase,
  splitSecretSettings,
  type FirebaseRuntimeConfig,
  type FirebaseSignInMethod,
  type GitJsonRuntimeConfig,
  type JournalRuntimeConfig,
  type RuntimeConfig,
} from "../../../lib/runtimeConfig";
import { createOpsContext } from "../../../ops/context";
import { seedCrm } from "../../../ops/seed";
import { setConfigDoc } from "../../../ops/settings";
import type { FirebaseSignup } from "../../../ops/firebaseRules";
import type { CrmUser } from "../../../core/types";
import { instantiateStorageConnector, type StorageConfig } from "../../../shared/storage/registry";
import { testStorageConnection } from "../../../shared/storage/testConnection";
import { createRemoteGitTransport } from "../../../shared/git";
import { buildAdminZip, DEFAULT_ADMIN_FOLDER, deployAdmin, downloadBlob } from "./adminDeploy";
import { DATA_FIELDS, dataLocation, HOSTING_FIELDS, hostingOption, missingRequired, type DataLocationId, type HostingOptionId } from "./locations";

export type DataModel = "journal" | "firebase" | "git-json" | "local";

export type SetupErrorKind =
  | "missingFields"
  | "connection"
  | "publicRepo"
  | "readOnly"
  | "wrongPassphrase"
  | "passphraseRequired"
  | "folderRequired"
  | "firebaseAuth"
  | "firebaseUnverified"
  | "firebaseWrongEmail"
  | "firebaseRules"
  | "firebaseNotAdmin"
  | "noManifest"
  | "generic";

export class SetupError extends Error {
  constructor(
    public readonly kind: SetupErrorKind,
    public readonly detail?: string,
  ) {
    super(detail ?? kind);
    this.name = "SetupError";
  }
}

// ─── Inputs ──────────────────────────────────────────────────────────────

export interface JournalInput {
  locationId: DataLocationId;
  // Connector settings incl. secrets (split before saving).
  settings: Record<string, unknown>;
  root: string;
  encrypted: boolean;
  passphrase: string;
}

export interface FirebaseInput {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  adminEmail: string;
  adminPassword: string;
  signInMethods: FirebaseSignInMethod[];
  signup: FirebaseSignup;
  allowedDomains: string;
}

export interface GitInput {
  provider: "github" | "gitlab" | "local";
  owner: string;
  repo: string;
  project: string;
  branch: string;
  dir: string;
  apiBaseUrl: string;
  token: string;
}

export interface HostingInput {
  optionId: HostingOptionId;
  settings: Record<string, unknown>;
  folder: string;
}

export interface WorkspaceInput {
  name: string;
  currency: string;
  adminName: string;
  adminEmail: string;
  demo: boolean;
  locale?: string;
}

export interface ExistingDataset {
  exists: boolean;
  encrypted?: boolean;
  name?: string;
  documents?: number;
}

// ─── Runtime configs ─────────────────────────────────────────────────────

export function journalRuntime(j: JournalInput, name?: string): { runtime: JournalRuntimeConfig; secrets: Record<string, unknown> } {
  const loc = dataLocation(j.locationId);
  const { publicSettings, secrets } = splitSecretSettings({ ...loc.preset, ...j.settings });
  const root = j.root.trim().replace(/^\/+|\/+$/g, "");
  return {
    runtime: {
      backend: "journal",
      ...(name ? { name } : {}),
      journal: { connectorId: loc.connectorId, settings: publicSettings, root, encrypted: j.encrypted },
    },
    secrets,
  };
}

export function gitRuntime(g: GitInput, name?: string): GitJsonRuntimeConfig {
  return {
    backend: "git-json",
    ...(name ? { name } : {}),
    git: {
      provider: g.provider,
      ...(g.provider === "github" ? { owner: g.owner.trim(), repo: g.repo.trim() } : {}),
      ...(g.provider === "gitlab" ? { project: g.project.trim() } : {}),
      branch: g.branch.trim() || "main",
      ...(g.apiBaseUrl.trim() ? { apiBaseUrl: g.apiBaseUrl.trim() } : {}),
      dir: g.dir.trim().replace(/^\/+|\/+$/g, ""),
    },
  };
}

export function firebaseOptions(f: FirebaseInput): FirebaseOptions {
  return {
    apiKey: f.apiKey.trim(),
    authDomain: f.authDomain.trim(),
    projectId: f.projectId.trim(),
    ...(f.storageBucket.trim() ? { storageBucket: f.storageBucket.trim() } : {}),
    ...(f.messagingSenderId.trim() ? { messagingSenderId: f.messagingSenderId.trim() } : {}),
    appId: f.appId.trim(),
  };
}

export function firebaseRuntime(f: FirebaseInput, name?: string): FirebaseRuntimeConfig {
  return {
    backend: "firebase",
    ...(name ? { name } : {}),
    firebase: firebaseOptions(f),
    ...(f.signInMethods.length ? { signInMethods: f.signInMethods } : {}),
  };
}

// Parses the snippet the Firebase console shows ("const firebaseConfig =
// { apiKey: "…", … }") — keys may be unquoted, values single-quoted.
export function parseFirebaseSnippet(text: string): Partial<Record<keyof FirebaseOptions, string>> {
  const out: Record<string, string> = {};
  for (const key of ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "measurementId"]) {
    const m = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`).exec(text);
    if (m) out[key] = m[1];
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function firebaseFieldsComplete(f: FirebaseInput): boolean {
  return [f.apiKey, f.authDomain, f.projectId, f.appId, f.adminPassword].every((v) => v.trim()) && EMAIL_RE.test(f.adminEmail.trim());
}

// ─── Step checks (side-effect free) ──────────────────────────────────────

// Journal location: credentials work (probe file written + deleted; git
// targets only check permissions), and whether a dataset is already there.
export async function testJournalLocation(j: JournalInput): Promise<{ detail: string; existing: ExistingDataset; publicRepo?: boolean }> {
  const loc = dataLocation(j.locationId);
  const settings = { ...loc.preset, ...j.settings };
  if (missingRequired(DATA_FIELDS[loc.id], settings).length) throw new SetupError("missingFields");
  let publicRepo: boolean | undefined;
  if (loc.connectorId === "git-pages") {
    const token = String(settings.token ?? "");
    const t = createRemoteGitTransport(
      settings.provider === "gitlab"
        ? { provider: "gitlab", project: String(settings.project ?? ""), branch: String(settings.branch ?? "main"), token, apiBaseUrl: (settings.apiBaseUrl as string) || undefined }
        : { provider: "github", owner: String(settings.owner ?? ""), repo: String(settings.repo ?? ""), branch: String(settings.branch ?? "main"), token, apiBaseUrl: (settings.apiBaseUrl as string) || undefined },
    );
    try {
      const p = await t.permissions();
      if (!p.canWrite) throw new SetupError("readOnly", p.login);
      publicRepo = p.visibility === "public";
    } catch (err) {
      if (err instanceof SetupError) throw err;
      throw new SetupError("connection", (err as Error).message);
    }
  }
  const res = await testStorageConnection(loc.connectorId, settings, { ignore: ["siteUrl"] });
  if (!res.ok) throw new SetupError(loc.connectorId === "local-folder" ? "folderRequired" : "connection", res.detail);
  const connector = instantiateStorageConnector(loc.connectorId, settings);
  const root = j.root.trim().replace(/^\/+|\/+$/g, "");
  const check = await checkJournalPassphrase(connector, root, j.passphrase || null);
  return { detail: res.detail, existing: { exists: check.exists, encrypted: check.encrypted }, publicRepo };
}

// For an existing encrypted dataset: is the typed passphrase the right one?
export async function checkExistingPassphrase(j: JournalInput): Promise<boolean> {
  const loc = dataLocation(j.locationId);
  const connector = instantiateStorageConnector(loc.connectorId, { ...loc.preset, ...j.settings });
  return (await checkJournalPassphrase(connector, j.root.trim().replace(/^\/+|\/+$/g, ""), j.passphrase || null)).ok;
}

export async function testGitRepo(g: GitInput): Promise<{ login: string; role: StoreIdentity["role"]; publicRepo: boolean; existing: ExistingDataset }> {
  const { openGitJsonTransport, inspectGitJsonFolder, roleFromPermissions } = await import("../../../data/gitJson");
  const runtime = gitRuntime(g);
  if (g.provider !== "local" && (!g.token.trim() || (g.provider === "github" ? !g.owner.trim() || !g.repo.trim() : !g.project.trim()))) {
    throw new SetupError("missingFields");
  }
  const t = await openGitJsonTransport(runtime.git, g.token.trim());
  if (!t) throw new SetupError(g.provider === "local" ? "folderRequired" : "missingFields");
  try {
    const p = await t.permissions();
    const role = g.provider === "local" ? "admin" : roleFromPermissions(p);
    const info = await inspectGitJsonFolder(t, runtime.git.dir);
    return {
      login: p.login,
      role,
      publicRepo: p.visibility === "public",
      existing: { exists: info.exists, name: info.name, documents: info.documents },
    };
  } catch (err) {
    throw new SetupError("connection", (err as Error).message);
  }
}

function firebaseAuthDetail(err: unknown): string {
  const e = err as { code?: string; message?: string };
  return [e.code, e.message].filter(Boolean).join(": ");
}

// Signs the admin in, makes sure the rules recognise them as the
// bootstrap admin (creates their users/{uid} record — the only write),
// and detects an existing workspace.
export async function verifyFirebaseSetup(f: FirebaseInput): Promise<{ identity: StoreIdentity; existing: ExistingDataset }> {
  if (!firebaseFieldsComplete(f)) throw new SetupError("missingFields");
  const { firebaseApiFor, createFirebaseStoreWith } = await import("../../../data/firebase");
  const runtime = firebaseRuntime(f);
  const api = await firebaseApiFor(runtime);
  let user;
  try {
    user = await api.auth.signInWithPassword(f.adminEmail.trim(), f.adminPassword);
  } catch (err) {
    throw new SetupError("firebaseAuth", firebaseAuthDetail(err));
  }
  if ((user.email ?? "").toLowerCase() !== f.adminEmail.trim().toLowerCase()) throw new SetupError("firebaseWrongEmail");
  if (!user.emailVerified) {
    const fresh = await api.auth.reload().catch(() => user);
    if (!fresh?.emailVerified) {
      await api.auth.sendVerificationEmail().catch(() => undefined);
      throw new SetupError("firebaseUnverified", user.email ?? "");
    }
  }
  const store = createFirebaseStoreWith({ api });
  try {
    const identity = await store.identity();
    if (!identity) throw new SetupError("firebaseRules", store.accessError()?.message);
    let objects = 0;
    try {
      objects = (await api.listCollection("objects")).length;
    } catch (err) {
      throw new SetupError("firebaseRules", firebaseAuthDetail(err));
    }
    if (identity.role !== "admin" && objects === 0) throw new SetupError("firebaseNotAdmin", identity.role);
    return { identity, existing: { exists: objects > 0, documents: objects } };
  } finally {
    store.close?.();
  }
}

// ─── Install ─────────────────────────────────────────────────────────────

export interface InstallPlan {
  model: DataModel;
  journal?: JournalInput;
  git?: GitInput;
  firebase?: FirebaseInput;
  hosting: HostingInput;
  workspace: WorkspaceInput;
  // Join the dataset found at the location (no seeding).
  join: boolean;
}

export interface InstallResult {
  runtime: RuntimeConfig;
  adminUrl: string | null;
  zipDownloaded: boolean;
  seeded: boolean;
}

export interface Progress {
  step(id: string, label?: string): void;
  done(id: string): void;
}

export function runtimeOf(plan: InstallPlan): { runtime: RuntimeConfig; secrets: Record<string, unknown> } {
  const name = plan.workspace.name.trim() || undefined;
  switch (plan.model) {
    case "journal":
      return journalRuntime(plan.journal!, name);
    case "git-json":
      return { runtime: gitRuntime(plan.git!, name), secrets: {} };
    case "firebase":
      return { runtime: firebaseRuntime(plan.firebase!, name), secrets: {} };
    default:
      return { runtime: { backend: "local", ...(name ? { name } : {}) }, secrets: {} };
  }
}

// Saves this browser's secrets for the runtime config (never config.js).
export async function saveBrowserSecrets(plan: InstallPlan, runtime: RuntimeConfig, secrets: Record<string, unknown>): Promise<void> {
  if (runtime.backend === "journal") {
    setConnectorSecrets(runtime, Object.keys(secrets).length ? secrets : null);
    setPassphrase(runtime, runtime.journal.encrypted ? plan.journal!.passphrase : null);
  }
  if (runtime.backend === "git-json") {
    if (runtime.git.provider !== "local") setGitToken(runtime.git, plan.git!.token);
    const { setGitUserEmail } = await import("../../../data/gitJson");
    setGitUserEmail(runtime, plan.workspace.adminEmail);
  }
}

export function hostingTarget(h: HostingInput): StorageConfig | null {
  const option = hostingOption(h.optionId);
  if (!option.connectorId) return null;
  return { connectorId: option.connectorId, settings: { ...option.preset, ...h.settings } };
}

export function hostingMissing(h: HostingInput): string[] {
  if (h.optionId === "none" || h.optionId === "zip") return [];
  const option = hostingOption(h.optionId);
  return missingRequired(HOSTING_FIELDS[h.optionId], { ...option.preset, ...h.settings });
}

export async function testHosting(h: HostingInput): Promise<string> {
  const target = hostingTarget(h);
  if (!target || h.optionId === "zip") return "";
  if (hostingMissing(h).length) throw new SetupError("missingFields");
  const res = await testStorageConnection(target.connectorId, target.settings, { ignore: target.connectorId === "local-folder" ? ["siteUrl"] : [] });
  if (!res.ok) throw new SetupError("connection", res.detail);
  return res.detail;
}

// Stores config/hosting (public part) + this browser's hosting secrets.
export async function saveHostingConfig(store: DataStore, runtime: RuntimeConfig, h: HostingInput, user: CrmUser | null = null): Promise<void> {
  const target = hostingTarget(h);
  if (!target || h.optionId === "zip") return;
  const { publicSettings, secrets } = splitSecretSettings(target.settings);
  setHostingSecrets(runtime, Object.keys(secrets).length ? secrets : null);
  await setConfigDoc(createOpsContext(store, user), "hosting", {
    connectorId: target.connectorId,
    optionId: h.optionId,
    settings: publicSettings,
    folder: h.folder.trim().replace(/^\/+|\/+$/g, ""),
  });
}

export function storeOptions(runtime: RuntimeConfig, plan: InstallPlan, secrets: Record<string, unknown>): BackendOptions {
  if (runtime.backend === "journal") return { secrets, passphrase: runtime.journal.encrypted ? plan.journal!.passphrase : null };
  if (runtime.backend === "git-json") return { secrets: { token: plan.git!.token, email: plan.workspace.adminEmail } };
  return {};
}

// Saves this browser's secrets for the plan's runtime config, opens its
// store, checks access and loads it. Used by install and by Settings →
// Data backend → Transfer.
export async function openTargetStore(plan: InstallPlan): Promise<{ runtime: RuntimeConfig; store: DataStore; identity: StoreIdentity }> {
  const { runtime, secrets } = runtimeOf(plan);
  await saveBrowserSecrets(plan, runtime, secrets);
  const store = await createDataStore(runtime, storeOptions(runtime, plan, secrets));
  try {
    const identity = await store.identity();
    if (!identity) throw new SetupError("connection", "no access");
    await store.ready();
    return { runtime, store, identity };
  } catch (err) {
    store.close?.();
    throw err;
  }
}

export async function install(plan: InstallPlan, p: Progress): Promise<InstallResult> {
  p.step("connect");
  const { runtime, store, identity } = await openTargetStore(plan);
  let seeded = false;
  try {
    p.done("connect");

    const empty = store.list("objects").length === 0;
    if (!plan.join || empty) {
      p.step("seed");
      const ws = plan.workspace;
      const adminId = runtime.backend === "firebase" || runtime.backend === "git-json" ? identity.uid : undefined;
      await seedCrm(createOpsContext(store, null), {
        name: ws.name.trim() || undefined,
        currency: ws.currency.trim().toUpperCase() || undefined,
        locale: ws.locale,
        admin: { ...(adminId ? { id: adminId } : {}), name: ws.adminName.trim() || identity.displayName || "Admin", email: ws.adminEmail.trim() || identity.email },
        demo: ws.demo,
      });
      seeded = true;
      p.done("seed");
    }

    let adminUrl: string | null = null;
    let zipDownloaded = false;
    const target = hostingTarget(plan.hosting);
    if (target && plan.hosting.optionId !== "zip") {
      p.step("hostingConfig");
      await saveHostingConfig(store, runtime, plan.hosting);
      p.done("hostingConfig");
      p.step("deploy");
      const res = await deployAdmin(target, plan.hosting.folder || DEFAULT_ADMIN_FOLDER, runtime, (done, total) => p.step("deploy", `${done}/${total}`));
      adminUrl = res.url;
      p.done("deploy");
    } else if (plan.hosting.optionId === "zip") {
      p.step("zip");
      downloadBlob(await buildAdminZip(runtime, (done, total) => p.step("zip", `${done}/${total}`)), "agentcrm-admin.zip");
      zipDownloaded = true;
      p.done("zip");
    }

    p.step("config");
    saveLocalRuntimeConfig(runtime);
    p.done("config");
    return { runtime, adminUrl, zipDownloaded, seeded };
  } finally {
    store.close?.();
  }
}

// Stable key of this browser's secrets for a runtime (Security section).
export function secretsScope(runtime: RuntimeConfig): string {
  return datasetId(runtime);
}
