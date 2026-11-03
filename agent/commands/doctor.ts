import { getCredential } from "../credentials";
import { installBrowserEnv } from "../browserEnv";
import { toCliError, printResult } from "../output";
import { readVersionInfo } from "../paths";
import { fetchHostedAdmin, fetchText, findSecretKeys, parseConfigJs } from "../remote";
import { compareVersions } from "../semver";
import { resolveSite, type SiteRecord } from "../sites";
import type { Command } from "./types";
import { SITE_OPTION, strOpt } from "./util";

// Health check of one CRM: credentials on this computer, data access and
// dataset health (with the admin's own code), the hosted admin as a
// browser gets it, and the bucket CORS rules the browser admin needs.
// Every problem carries a `fix` the agent can propose.

export interface Check {
  id: string;
  status: "ok" | "warn" | "fail" | "skip";
  message: string;
  fix?: string;
}

export function corsRule(origin: string) {
  return [
    {
      AllowedOrigins: [origin],
      AllowedMethods: ["GET", "PUT", "DELETE", "HEAD"],
      AllowedHeaders: ["authorization", "content-type", "cache-control", "x-amz-*"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3600,
    },
  ];
}

function s3BucketUrl(settings: Record<string, unknown>): string | null {
  const bucket = typeof settings.bucket === "string" ? settings.bucket : "";
  if (!bucket) return null;
  const region = typeof settings.region === "string" && settings.region ? settings.region : "us-east-1";
  const endpoint = (typeof settings.endpoint === "string" && settings.endpoint ? settings.endpoint : `https://s3.${region}.amazonaws.com`).replace(/\/+$/, "");
  const pathStyle = settings.forcePathStyle ?? !new URL(endpoint).hostname.endsWith("amazonaws.com");
  return pathStyle ? `${endpoint}/${bucket}/` : endpoint.replace("://", `://${bucket}.`) + "/";
}

async function corsCheck(id: string, what: string, settings: Record<string, unknown>, origin: string | null): Promise<Check> {
  const url = s3BucketUrl(settings);
  if (!url || !origin) return { id, status: "skip", message: `${what}: no admin origin to check CORS for (admin not hosted).` };
  const res = await fetchText(url, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "authorization,content-type" } });
  const allowed = res.headers?.get("access-control-allow-origin");
  if (allowed === "*" || allowed === origin) return { id, status: "ok", message: `${what}: CORS allows ${origin}.` };
  return {
    id,
    status: "warn",
    message: `${what}: the bucket did not confirm a CORS rule for ${origin}${res.status ? ` (preflight HTTP ${res.status})` : res.error ? ` (${res.error})` : ""} — the browser admin can't reach it without one.`,
    fix: `Add this CORS rule to bucket "${String(settings.bucket)}" (AWS console → Permissions → CORS, or \`aws s3api put-bucket-cors\`; R2 / OVH / Scaleway have the same JSON): ${JSON.stringify(corsRule(origin))}`,
  };
}

export async function runDoctor(site: SiteRecord, opts: { repair?: boolean } = {}): Promise<{ checks: Check[]; repaired: unknown }> {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const info = readVersionInfo();
  let repaired: unknown = null;

  // ── Credentials on this computer ──────────────────────────────────────
  for (const role of ["data", "hosting", "passphrase"] as const) {
    const account = site.credentials[role];
    if (!account) continue;
    add(
      getCredential(account)
        ? { id: `credential-${role}`, status: "ok", message: `${role} credential ${account} stored.` }
        : { id: `credential-${role}`, status: "fail", message: `${role} credential ${account} is not stored on this computer.`, fix: `The user runs \`agentcrm credentials set ${account}\` in their own terminal (hidden input) or with --from-env.` },
    );
  }
  if (site.runtime.backend === "journal" && site.runtime.journal.encrypted && !site.credentials.passphrase) {
    add({ id: "credential-passphrase", status: "fail", message: "The dataset is encrypted and no passphrase account is attached.", fix: `\`agentcrm credentials set passphrase:${site.alias}\`, then \`agentcrm site credentials ${site.alias} --passphrase-credential passphrase:${site.alias}\`.` });
  }
  if (site.runtime.backend === "journal" && !site.runtime.journal.encrypted) {
    add({ id: "encryption", status: "warn", message: "The dataset is stored UNENCRYPTED: anyone who can read the storage reads every contact.", fix: "Keep the location strictly private; encryption can be enabled by exporting (`export json`) and re-importing into a new encrypted install." });
  }

  // ── Data access + dataset health ──────────────────────────────────────
  installBrowserEnv();
  try {
    if (site.runtime.backend === "journal" && site.runtime.journal.connectorId === "git-pages") {
      const { probeTarget } = await import("../ops/install");
      const { dataTargetOf } = await import("../ops/session");
      const probe = await probeTarget(dataTargetOf(site), { requireSiteUrl: false, requirePrivate: true });
      add(probe.ok ? { id: "data-repo", status: "ok", message: probe.detail } : { id: "data-repo", status: "fail", message: probe.detail, fix: "Make the data repository private and check the token's Contents permission." });
    }
    const { openSession } = await import("../ops/session");
    const session = await openSession(site.alias);
    try {
      const store = session.store;
      add({ id: "data-access", status: "ok", message: `Dataset opened (${store.kind}${session.user ? `, acting as ${session.user.email} (${session.user.role})` : ""}).` });
      const { usersOf, objectsOf, pipelinesOf, settingsDoc, recordsOf } = await import("../../src/ops/store");
      const missing: string[] = [];
      for (const id of ["companies", "people", "deals"]) if (!objectsOf(store).some((o) => o.id === id)) missing.push(`object ${id}`);
      if (!pipelinesOf(store).length) missing.push("a pipeline");
      if (!settingsDoc(store)) missing.push("settings");
      if (!usersOf(store).some((u) => u.role === "admin" && !u.disabled)) missing.push("an active admin user");
      if (missing.length && opts.repair) {
        const { seedCrm } = await import("../../src/ops/seed");
        repaired = await seedCrm(session.system, { admin: site.user ? { name: site.user.split("@")[0], email: site.user } : undefined });
        add({ id: "dataset", status: "ok", message: `Repaired: seeded ${missing.join(", ")}.` });
      } else {
        add(
          missing.length
            ? { id: "dataset", status: "fail", message: `The dataset lacks ${missing.join(", ")}.`, fix: `\`agentcrm doctor --site ${site.alias} --repair\` seeds what's missing (idempotent, keeps existing data).` }
            : { id: "dataset", status: "ok", message: `${objectsOf(store).length} objects, ${recordsOf(store).length} records, ${usersOf(store).length} users.` },
        );
      }
      if (session.user && session.user.role !== "admin") {
        add({ id: "cli-user", status: "warn", message: `The CLI acts as ${session.user.email}, a ${session.user.role}: schema, settings and compaction will be refused.`, fix: `\`agentcrm site credentials ${site.alias} --user <admin email>\`.` });
      }
      const deleted = recordsOf(store, undefined, { includeDeleted: true }).filter((r) => r.deletedAt).length;
      if (deleted) add({ id: "purge", status: "warn", message: `${deleted} deleted record(s) are still stored (restorable) until compaction.`, fix: `When the user wants them erased for good (GDPR): \`agentcrm compact --site ${site.alias}\` (plan), then with --yes.` });
      const stats = (store as { stats?: () => Promise<{ pendingSegments: number; segments: number }> }).stats;
      if (stats) {
        const s = await stats.call(store);
        add(
          s.pendingSegments > 300
            ? { id: "journal", status: "warn", message: `${s.pendingSegments} journal segments since the last snapshot: loading gets slower.`, fix: `\`agentcrm compact --site ${site.alias} --yes\` (run it from one place).` }
            : { id: "journal", status: "ok", message: `Journal: ${s.segments} segment(s), ${s.pendingSegments} since the last snapshot.` },
        );
      }
    } finally {
      await session.close();
    }
  } catch (err) {
    const e = toCliError(err);
    add({ id: "data-access", status: "fail", message: e.message, fix: e.hint });
  }

  // ── Hosted admin ──────────────────────────────────────────────────────
  const adminUrl = site.adminUrl;
  let origin: string | null = null;
  if (!adminUrl) {
    add({ id: "admin", status: "skip", message: "Admin not hosted (use `agentcrm serve`)." });
  } else {
    origin = new URL(adminUrl).origin;
    add(
      adminUrl.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1)/.test(adminUrl)
        ? { id: "https", status: "ok", message: "Admin served over HTTPS (or localhost)." }
        : { id: "https", status: "fail", message: `${adminUrl} is plain HTTP: browsers refuse WebCrypto (signing, encryption) there.`, fix: "Serve the admin over HTTPS (CDN / custom domain with TLS, the bucket's https endpoint, GitHub Pages)." },
    );
    const index = await fetchText(`${adminUrl}index.html`);
    if (!index.ok) {
      add({ id: "admin", status: "fail", message: `Admin page not served (${index.error ?? `HTTP ${index.status}`}).`, fix: `\`agentcrm deploy-admin --site ${site.alias} --yes\` (Pages hosts take a minute after a commit).` });
    } else {
      add({ id: "admin", status: "ok", message: `Admin served at ${adminUrl}.` });
      const hosted = await fetchHostedAdmin(adminUrl);
      add(
        !hosted.version
          ? { id: "admin-version", status: "warn", message: "version.json missing next to the admin.", fix: `\`agentcrm deploy-admin --site ${site.alias} --yes\`.` }
          : compareVersions(hosted.version, info.version) >= 0
            ? { id: "admin-version", status: "ok", message: `Admin ${hosted.version} is up to date.` }
            : { id: "admin-version", status: "warn", message: `Admin ${hosted.version} is older than ${info.version}.`, fix: `Offer \`agentcrm deploy-admin --site ${site.alias}\`.` },
      );
      const cfg = await fetchText(`${adminUrl}config.js`);
      try {
        if (!cfg.ok) throw new Error(cfg.error ?? `HTTP ${cfg.status}`);
        const runtime = parseConfigJs(cfg.text);
        const secrets = findSecretKeys(runtime);
        if (secrets.length) add({ id: "config-js", status: "fail", message: `config.js publishes secrets: ${secrets.join(", ")}.`, fix: "Revoke those keys NOW, then redeploy the admin (config.js is regenerated without secrets)." });
        else if (!runtime || runtime.backend !== site.runtime.backend) add({ id: "config-js", status: "fail", message: `config.js backend is ${String(runtime?.backend ?? "empty")}, expected ${site.runtime.backend}.`, fix: `\`agentcrm deploy-admin --site ${site.alias} --yes\`.` });
        else add({ id: "config-js", status: "ok", message: `config.js: ${site.runtime.backend}, no secrets.` });
      } catch (err) {
        add({ id: "config-js", status: "fail", message: `config.js unreadable: ${(err as Error).message}.`, fix: `\`agentcrm deploy-admin --site ${site.alias} --yes\`.` });
      }
    }
  }

  // ── CORS + public exposure of the data ─────────────────────────────────
  if (site.runtime.backend === "journal" && site.runtime.journal.connectorId === "s3") {
    const loc = site.runtime.journal.settings;
    add(await corsCheck("cors-data", "Data bucket", loc, origin));
    const hs = site.hosting?.connectorId === "s3" ? site.hosting.settings : null;
    if (hs && hs.bucket === loc.bucket && (hs.endpoint ?? "") === (loc.endpoint ?? "") && typeof hs.siteUrl === "string") {
      const rel = [String(loc.prefix ?? ""), site.runtime.journal.root].map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/");
      const stripped = String(hs.prefix ?? "").replace(/^\/+|\/+$/g, "");
      const path = stripped && rel.startsWith(`${stripped}/`) ? rel.slice(stripped.length + 1) : rel;
      const probe = await fetchText(`${hs.siteUrl.replace(/\/+$/, "")}/${path ? `${path}/` : ""}keyinfo.json`);
      if (probe.ok && /agentcrm-journal/.test(probe.text)) {
        add(
          site.runtime.journal.encrypted
            ? { id: "data-exposure", status: "warn", message: "The encrypted data files are downloadable from the public site.", fix: "Move the dataset to a separate private bucket (export json → new install → import)." }
            : { id: "data-exposure", status: "fail", message: "The UNENCRYPTED dataset is downloadable from the public site: every contact is exposed.", fix: "Make the files private now (bucket policy), then move the data to a private bucket with encryption." },
        );
      } else add({ id: "data-exposure", status: "ok", message: "The dataset is not served by the public site." });
    }
  }
  if (site.hosting?.connectorId === "s3" && !(site.runtime.backend === "journal" && site.runtime.journal.connectorId === "s3" && site.runtime.journal.settings.bucket === site.hosting.settings.bucket)) {
    add({ id: "cors-hosting", status: "skip", message: "Hosting bucket: only read by browsers (no CORS needed unless forms post to it)." });
  }
  return { checks, repaired };
}

export const doctorCommand: Command = {
  name: "doctor",
  usage: "doctor [--site <alias>] [--repair]",
  summary: "Health check of a CRM: credentials, data access (passphrase), dataset health, journal size, pending purge, hosted admin (HTTPS, version, config.js without secrets), bucket CORS rules, public exposure of the data. Every problem has a `fix`. Exit 1 when a check fails.",
  options: [SITE_OPTION, { name: "repair", type: "boolean", description: "Seed what the dataset lacks (standard objects, pipeline, settings, admin) — idempotent." }],
  async run({ io, options }) {
    const site = resolveSite(strOpt(options, "site"));
    const { checks, repaired } = await runDoctor(site, { repair: options.repair === true });
    const failed = checks.filter((c) => c.status === "fail").length;
    const warned = checks.filter((c) => c.status === "warn").length;
    printResult(io, { site: site.alias, ok: failed === 0, failed, warnings: warned, checks, ...(repaired ? { repaired } : {}) }, () =>
      [
        `${site.alias}: ${failed ? `${failed} problem(s)` : "healthy"}${warned ? `, ${warned} warning(s)` : ""}`,
        ...checks.map((c) => `  [${c.status}] ${c.id}: ${c.message}${c.fix ? `\n         fix: ${c.fix}` : ""}`),
      ].join("\n"),
    );
    return failed ? 1 : 0;
  },
};
