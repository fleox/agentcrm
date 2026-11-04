import { randomBytes } from "node:crypto";
import type { CrmUser } from "../../src/core/types";
import type { RuntimeConfig } from "../../src/lib/runtimeConfig";
import type { DataStore } from "../../src/data/types";
import type { OpsContext } from "../../src/ops/context";
import type { PluginRegistry } from "../../src/core/pluginRegistry";
import { installBrowserEnv } from "../browserEnv";
import { requireCredential } from "../credentials";
import { CliError, printResult, type Io } from "../output";
import { lockSite, resolveSite, type SiteRecord } from "../sites";
import type { Target } from "./plan";
import { extensionNotes, loadSessionExtensions, type SessionExtensions } from "./extensions";

// A headless CRM for one registered site (mirror of cms-ia
// agent/ops/session.ts): the site's DataStore opened with the CLI's
// credentials merged in, an OpsContext acting as the site's admin user,
// the automations engine subscribed to the ops' plugin actions (event
// automations fire exactly like in the admin), flushed and closed at the
// end. Writes take the site lock.

export interface CrmSession {
  site: SiteRecord;
  store: DataStore;
  // Acting as the site's CRM user (roles enforced).
  ctx: OpsContext;
  // System context (all permissions) — maintenance only.
  system: OpsContext;
  plugins: PluginRegistry;
  user: CrmUser | null;
  warnings: string[];
  // Enabled external extensions loaded in this process (see ops/extensions.ts).
  extensions: SessionExtensions;
  // The hosting connector target with secrets, or null when not hosted.
  hostingTarget(): Target | null;
  close(): Promise<void>;
}

export interface OpenOptions {
  // Take the site lock for the duration (writes).
  lock?: boolean;
  // Act as this user (email or id) instead of the site's user.
  as?: string;
  // Safe mode: don't load the site's extensions.
  safe?: boolean;
}

// The session's own registry (automations engine) chained to the process
// default registry, where loaded extension modules register their hooks
// (src/extensions/registry.ts): an op's actions reach both.
function chainRegistries(primary: PluginRegistry, secondary: PluginRegistry): PluginRegistry {
  return {
    ...primary,
    async doAction(hook: string, ...args: unknown[]) {
      await (primary.doAction as (h: string, ...a: unknown[]) => Promise<void>)(hook, ...args);
      await (secondary.doAction as (h: string, ...a: unknown[]) => Promise<void>)(hook, ...args);
    },
    async applyFilters<T>(hook: string, value: T, ...args: unknown[]): Promise<T> {
      return secondary.applyFilters(hook, await primary.applyFilters(hook, value, ...args), ...args);
    },
    applyFiltersSync<T>(hook: string, value: T, ...args: unknown[]): T {
      return secondary.applyFiltersSync(hook, primary.applyFiltersSync(hook, value, ...args), ...args);
    },
    hasAction: (hook: string) => primary.hasAction(hook) || secondary.hasAction(hook),
  } as PluginRegistry;
}

export function kdfIterations(): number | undefined {
  const n = Number(process.env.AGENTCRM_KDF_ITERATIONS);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function cliClientId(): string {
  return `cli${randomBytes(4).toString("hex")}`;
}

// The data location of a journal site, with the credential's secrets.
export function dataTargetOf(site: SiteRecord): Target {
  if (site.runtime.backend !== "journal") throw new CliError("unsupported-backend", `${site.alias} is not a journal dataset.`);
  const j = site.runtime.journal;
  const secrets = site.credentials.data ? requireCredential(site.credentials.data).values : {};
  return { connectorId: j.connectorId, settings: { ...j.settings, ...(site.dataPath ? { path: site.dataPath } : {}), ...secrets } };
}

export function hostingTargetOf(site: SiteRecord): Target | null {
  if (!site.hosting) return null;
  const secrets = site.credentials.hosting ? requireCredential(site.credentials.hosting).values : {};
  if (!site.credentials.hosting && site.hosting.connectorId !== "local-folder") {
    throw new CliError("credential-required", `No hosting credential recorded for ${site.alias}.`, `Attach one: \`agentcrm site credentials ${site.alias} --hosting-credential <account>\`.`);
  }
  return { connectorId: site.hosting.connectorId, settings: { ...site.hosting.settings, ...secrets } };
}

// Opens the DataStore of a runtime config with CLI-held secrets. Also
// seeds the in-memory localStorage (browserEnv) the way a browser would
// hold them, for src/ code that reads secrets from there.
export async function openStore(
  runtime: RuntimeConfig,
  opts: { dataTarget?: Target; secrets?: Record<string, unknown>; passphrase?: string | null; account?: string },
): Promise<DataStore> {
  installBrowserEnv();
  const rc = await import("../../src/lib/runtimeConfig");
  rc.setRuntimeConfigOverride(runtime);
  if (opts.passphrase) rc.setPassphrase(runtime, opts.passphrase);
  if (runtime.backend === "local") {
    throw new CliError("unsupported-backend", "This CRM keeps its data in one browser (local mode): the CLI can't reach it.", "Use the admin in that browser, or move the data to a journal / git / Firebase backend (Settings → Data).");
  }
  if (runtime.backend === "journal") {
    if (!opts.dataTarget) throw new CliError("internal", "journal store without a data location");
    const { buildConnector } = await import("./hosting");
    const { createJournalStore } = await import("../../src/data/journal");
    const { publicSettings, secrets } = rc.splitSecretSettings(opts.dataTarget.settings);
    void publicSettings;
    rc.setConnectorSecrets(runtime, secrets);
    return createJournalStore({
      connector: buildConnector(opts.dataTarget),
      root: runtime.journal.root,
      encrypted: runtime.journal.encrypted,
      passphrase: opts.passphrase ?? null,
      clientId: cliClientId(),
      iterations: kdfIterations(),
    });
  }
  if (runtime.backend === "git-json") {
    const token = String(opts.secrets?.token ?? "");
    if (token) rc.setGitToken(runtime.git, token);
  }
  if (runtime.backend === "firebase" && opts.account && typeof opts.secrets?.email === "string") {
    // Session kept between runs; the store signs in with the secrets.
    const { prepareFirebaseSession } = await import("../firebaseSession");
    await prepareFirebaseSession(opts.account, runtime.firebase, opts.secrets.email);
  }
  const { createDataStore } = await import("../../src/data");
  return createDataStore(runtime, { secrets: opts.secrets ?? {}, passphrase: opts.passphrase ?? null, clientId: cliClientId() });
}

function siteSecrets(site: SiteRecord): { dataTarget?: Target; secrets?: Record<string, unknown>; passphrase?: string | null; account?: string } {
  const passphrase = site.credentials.passphrase ? requireCredential(site.credentials.passphrase).values.passphrase : null;
  if (site.runtime.backend === "journal") return { dataTarget: dataTargetOf(site), passphrase };
  if (site.runtime.backend === "git-json" || site.runtime.backend === "firebase") {
    if (!site.credentials.data) {
      throw new CliError(
        "credential-required",
        `No ${site.runtime.backend === "firebase" ? "Firebase login" : "git token"} recorded for ${site.alias}.`,
        `Store it (\`agentcrm credentials set ${site.runtime.backend === "firebase" ? "firebase" : site.runtime.git.provider}:<name>\`), then \`agentcrm site credentials ${site.alias} --data-credential <account>\`.`,
      );
    }
    return { secrets: requireCredential(site.credentials.data).values, passphrase, account: site.credentials.data };
  }
  return { passphrase };
}

// The CRM user the CLI acts as: --as, the site's recorded user, the
// store's identity, else the first admin. null (system) only when the
// dataset has no user at all.
async function actingUser(store: DataStore, site: SiteRecord, as?: string): Promise<{ user: CrmUser | null; warnings: string[] }> {
  const { usersOf } = await import("../../src/ops/store");
  const users = usersOf(store);
  const find = (ref: string) => users.find((u) => u.id === ref || u.email.toLowerCase() === ref.toLowerCase());
  if (as) {
    const u = find(as);
    if (!u) throw new CliError("user-not-found", `No CRM user "${as}".`, "List them with `agentcrm users list`.", 2);
    return { user: u, warnings: [] };
  }
  if (site.user) {
    const u = find(site.user);
    if (u) return { user: u, warnings: u.disabled ? [`The site's CLI user ${u.email} is disabled.`] : [] };
  }
  const identity = await store.identity().catch(() => null);
  const byIdentity = identity ? find(identity.uid) ?? (identity.email ? find(identity.email) : undefined) : undefined;
  if (byIdentity) return { user: byIdentity, warnings: [] };
  const admin = users.find((u) => u.role === "admin" && !u.disabled);
  if (admin) return { user: admin, warnings: site.user ? [`CRM user ${site.user} not found: acting as ${admin.email}.`] : [] };
  return { user: null, warnings: users.length ? [] : ["The dataset has no CRM user yet: acting as the system."] };
}

export async function openSession(alias: string | undefined, opts: OpenOptions = {}): Promise<CrmSession> {
  installBrowserEnv();
  const site = resolveSite(alias);
  const unlock = opts.lock ? lockSite(site.alias) : null;
  let store: DataStore | null = null;
  let uninstall: (() => void) | null = null;
  let extensions: SessionExtensions | null = null;
  try {
    store = await openStore(site.runtime, siteSecrets(site));
    await store.ready();
    const [{ createOpsContext }, { createPluginRegistry, plugins: defaultPlugins }, { installAutomations }] = await Promise.all([
      import("../../src/ops/context"),
      import("../../src/core/pluginRegistry"),
      import("../../src/ops/automations"),
    ]);
    const own = createPluginRegistry((hook, err) => process.stderr.write(`[agentcrm] ${hook} handler failed: ${String((err as Error)?.message ?? err)}\n`));
    uninstall = installAutomations(own);
    const plugins = chainRegistries(own, defaultPlugins);
    const { user, warnings } = await actingUser(store, site, opts.as);
    extensions = await loadSessionExtensions(store, { safe: opts.safe });
    warnings.push(...extensionNotes(extensions.report));
    const log = (msg: string) => process.stderr.write(`${msg}\n`);
    const ctx = createOpsContext(store, user, { plugins, log });
    const system = createOpsContext(store, null, { plugins, log });
    // Writing sessions of an admin bring an older dataset up to the current
    // schema (additive, idempotent — same as the admin on boot).
    if (opts.lock && (!user || user.role === "admin") && store.list("objects").length) {
      const { migrateSchema } = await import("../../src/ops/migrate");
      await migrateSchema(ctx).catch((err: unknown) => warnings.push(`Schema migration skipped: ${(err as Error).message}`));
    }
    // Forms publishing / siteFiles write to the site's hosting.
    if (site.hosting) {
      const target = (() => {
        try {
          return hostingTargetOf(site);
        } catch {
          return null;
        }
      })();
      if (target) {
        const { setStorageConfigSource, registerStorageConnector } = await import("../../src/shared/storage/registry");
        const { buildConnector } = await import("./hosting");
        if (target.connectorId === "local-folder") registerStorageConnector({ id: "local-folder", create: (s: Record<string, unknown>) => buildConnector({ connectorId: "local-folder", settings: s }) });
        setStorageConfigSource(async () => target);
      }
    }
    // Lead form inboxes (S3 kind) are read with the site's credentials:
    // the hosting connector by default, the data location for source "data".
    {
      const forms = await import("../../src/ops/forms");
      const { buildConnector } = await import("./hosting");
      forms.setInboxSourceResolver((_ctx, form) => {
        if (form.inbox.kind !== "s3") return null;
        const settings = (form.inbox.settings ?? {}) as Record<string, string>;
        let target: Target | null = null;
        try {
          target = settings.source === "data" && site.runtime.backend === "journal" ? dataTargetOf(site) : hostingTargetOf(site);
        } catch {
          target = null;
        }
        return target ? forms.connectorInboxSource(buildConnector(target), settings.prefix) : null;
      });
    }
    const opened = store;
    let closed = false;
    return {
      site,
      store: opened,
      ctx,
      system,
      plugins,
      user,
      warnings,
      extensions: extensions!,
      hostingTarget: () => hostingTargetOf(site),
      async close() {
        if (closed) return;
        closed = true;
        try {
          uninstall?.();
          await extensions?.close();
          await (await import("../../src/shared/storage/batch")).flushImplicitBatch();
          opened.close?.();
        } finally {
          unlock?.();
        }
      },
    };
  } catch (err) {
    uninstall?.();
    await extensions?.close().catch(() => undefined);
    store?.close?.();
    unlock?.();
    throw err;
  }
}

// Shared plumbing of the data commands: open a session, run the work,
// print its result (data = the work's return value) and close. Warnings
// go to stderr so `data` stays the plain result.
export async function withSession<T>(
  io: Io,
  options: Record<string, unknown>,
  open: OpenOptions,
  work: (s: CrmSession) => Promise<T> | T,
  human: (r: T) => string = (r) => JSON.stringify(r, null, 2),
): Promise<number> {
  const session = await openSession(typeof options.site === "string" ? options.site : undefined, {
    ...open,
    as: typeof options.as === "string" ? options.as : open.as,
    safe: options.safe === true || open.safe,
  });
  try {
    const result = await work(session);
    for (const w of session.warnings) io.err(`note: ${w}`);
    printResult(io, result, () => human(result));
    return 0;
  } finally {
    await session.close();
  }
}
