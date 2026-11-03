import { generatePassphrase } from "../../src/shared/crypto";
import { createRemoteGitTransport } from "../../src/shared/git";
import { testStorageConnection } from "../../src/shared/storage/testConnection";
import { subscribeToToasts } from "../../src/shared/lib/toast";
import type { SeedReport } from "../../src/ops/seed";
import { setCredential } from "../credentials";
import { adminOps, applyOps, buildConnector } from "./hosting";
import type { ResolvedPlan, Target } from "./plan";
import { openStore } from "./session";

// Same steps as the setup wizard, driven from Node: check access → open
// (create) the dataset on the chosen location → seed the standard schema,
// the first admin and optional demo data → upload the admin (+ config.js)
// to the hosting.

export interface CheckResult {
  ok: boolean;
  detail: string;
}

export interface CheckReport {
  data: CheckResult & { existing: boolean };
  hosting: CheckResult | null;
}

// Toasts raised by src/ code (connector errors…) become notices.
export function collectToasts(): { notices: { level: string; message: string }[]; stop: () => void } {
  const notices: { level: string; message: string }[] = [];
  const stop = subscribeToToasts((t) => notices.push({ level: t.level, message: t.message }));
  return { notices, stop };
}

function gitTransport(settings: Record<string, unknown>) {
  const s = settings as { provider?: string; owner?: string; repo?: string; project?: string; branch?: string; token?: string; apiBaseUrl?: string };
  return createRemoteGitTransport(
    s.provider === "gitlab"
      ? { provider: "gitlab", project: s.project ?? "", branch: s.branch ?? "main", token: s.token ?? "", apiBaseUrl: s.apiBaseUrl }
      : { provider: "github", owner: s.owner ?? "", repo: s.repo ?? "", branch: s.branch ?? "main", token: s.token ?? "", apiBaseUrl: s.apiBaseUrl },
  );
}

// Write + read + list + delete a probe file (git: permissions only, no commit).
export async function probeTarget(target: Target, opts: { requireSiteUrl: boolean; requirePrivate?: boolean }): Promise<CheckResult> {
  try {
    if (target.connectorId === "git-pages") {
      const transport = gitTransport(target.settings);
      const perms = await transport.permissions();
      if (!perms.canWrite) return { ok: false, detail: `${perms.login}: read-only access to ${transport.label}` };
      if (opts.requirePrivate && perms.visibility === "public") {
        return { ok: false, detail: `${transport.label} is PUBLIC: CRM data (personal data) must live in a private repository. Make it private (Settings → General → Danger Zone) and retry.` };
      }
      return { ok: true, detail: `${perms.login} → ${transport.label}${perms.visibility ? ` (${perms.visibility})` : ""}` };
    }
    if (target.connectorId === "s3") {
      return await testStorageConnection("s3", target.settings, { ignore: opts.requireSiteUrl ? [] : ["siteUrl"] });
    }
    const connector = buildConnector(target);
    const probe = ".agentcrm-probe.txt";
    await connector.put({ path: probe, content: `AgentCRM connection test ${new Date().toISOString()}\n` });
    const back = await connector.getBytes?.(probe);
    const listed = await connector.listPrefix?.(".agentcrm-");
    await connector.delete(probe);
    if (!back || !listed?.includes(probe)) return { ok: false, detail: "write succeeded but read-back / listing failed" };
    return { ok: true, detail: await connector.publicUrl("") };
  } catch (err) {
    const status = (err as { status?: number }).status;
    return { ok: false, detail: `${(err as Error).message}${status ? ` (${status})` : ""}` };
  }
}

// Side-effect free (except the probe file of file storages).
export async function checkPlan(plan: ResolvedPlan): Promise<CheckReport> {
  let data: CheckReport["data"];
  if (plan.runtime.backend === "journal" && plan.dataTarget) {
    const access = await probeTarget(plan.dataTarget, { requireSiteUrl: false, requirePrivate: true });
    if (!access.ok) data = { ...access, existing: false };
    else {
      try {
        const connector = buildConnector(plan.dataTarget);
        const root = plan.runtime.journal.root;
        const keyinfo = await connector.getBytes!(`${root ? `${root}/` : ""}keyinfo.json`);
        if (!keyinfo) {
          data = { ok: true, detail: `${access.detail} — new ${plan.runtime.journal.encrypted ? "encrypted " : ""}dataset in "${root || "/"}"`, existing: false };
        } else {
          const info = JSON.parse(new TextDecoder().decode(keyinfo)) as { encrypted?: boolean };
          if (info.encrypted && !plan.passphrase) {
            data = { ok: false, detail: `an encrypted dataset already exists in "${root}": store its passphrase as ${plan.passphraseAccount ?? "passphrase:<alias>"} and set data.encryption.credential`, existing: true };
          } else {
            // Proves the passphrase (keyinfo check value) before anything is written.
            const store = await openStore(plan.runtime, { dataTarget: plan.dataTarget, passphrase: plan.passphrase });
            try {
              await store.ready();
              const count = store.list("records").length;
              data = { ok: true, detail: `${access.detail} — existing ${info.encrypted ? "encrypted " : ""}dataset (${count} records): it is kept, only what's missing is seeded`, existing: true };
            } finally {
              store.close?.();
            }
          }
        }
      } catch (err) {
        const e = err as Error;
        data = { ok: false, detail: e.name === "PassphraseError" ? `wrong passphrase in ${plan.passphraseAccount}` : e.message, existing: false };
      }
    }
  } else if (plan.runtime.backend === "git-json") {
    const access = await probeTarget({ connectorId: "git-pages", settings: { ...plan.runtime.git, ...(plan.backendSecrets ?? {}) } }, { requireSiteUrl: false, requirePrivate: true });
    data = { ...access, existing: false };
  } else {
    data = { ok: true, detail: `Firebase project ${(plan.runtime as { firebase: { projectId?: string } }).firebase.projectId} (checked at install: sign-in + rules)`, existing: false };
  }
  const hosting = plan.hostingTarget ? await probeTarget(plan.hostingTarget, { requireSiteUrl: plan.hostingTarget.connectorId !== "local-folder" }) : null;
  return { data, hosting };
}

export interface InstallOutcome {
  seed: SeedReport;
  adminVersion: string | null;
  files: number;
  generatedPassphrase: boolean;
  notices: { level: string; message: string }[];
}

export async function runInstall(plan: ResolvedPlan, onStep: (label: string) => void): Promise<InstallOutcome> {
  const toasts = collectToasts();
  try {
    let generatedPassphrase = false;
    if (plan.passphraseAccount && !plan.passphrase) {
      // Stored BEFORE the first encrypted write, so it can't be lost.
      plan.passphrase = generatePassphrase();
      setCredential(plan.passphraseAccount, { passphrase: plan.passphrase });
      generatedPassphrase = true;
      onStep(`Generated the dataset passphrase (stored as ${plan.passphraseAccount})`);
    }
    onStep("Opening the dataset");
    const store = await openStore(plan.runtime, { dataTarget: plan.dataTarget, secrets: plan.backendSecrets, passphrase: plan.passphrase });
    let seed: SeedReport;
    try {
      await store.ready();
      const { createOpsContext } = await import("../../src/ops/context");
      const { createPluginRegistry } = await import("../../src/core/pluginRegistry");
      const { seedCrm } = await import("../../src/ops/seed");
      const { setConfigDoc } = await import("../../src/ops/settings");
      const system = createOpsContext(store, null, { plugins: createPluginRegistry() });
      onStep(`Seeding the CRM${plan.demo ? " (with demo data)" : ""}`);
      // Account backends: the first admin's user doc is keyed by their uid.
      const identity = plan.backend === "journal" ? null : await store.identity().catch(() => null);
      const admin = identity?.uid ? { ...plan.owner, id: identity.uid } : plan.owner;
      seed = await seedCrm(system, { name: plan.name, admin, demo: plan.demo, currency: plan.currency, locale: plan.locale });
      if (plan.hosting) {
        await setConfigDoc(system, "hosting", { connectorId: plan.hosting.connectorId, settings: plan.hosting.settings, folder: plan.hosting.folder, type: plan.hosting.type });
      }
    } finally {
      store.close?.();
    }
    let adminVersion: string | null = null;
    let files = 0;
    if (plan.hostingTarget && plan.hosting) {
      const { ops, version } = adminOps(plan.hosting.folder, plan.runtime);
      onStep(`Uploading the admin (${ops.length} files) to ${plan.hosting.type}`);
      await applyOps(buildConnector(plan.hostingTarget), ops);
      adminVersion = version;
      files = ops.length;
    }
    return { seed, adminVersion, files, generatedPassphrase, notices: toasts.notices };
  } finally {
    toasts.stop();
  }
}
