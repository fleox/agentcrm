import { DATA_BACKENDS, HOSTINGS, LOCATIONS } from "../catalog";
import { CREDENTIAL_TYPES } from "../credentials";
import { printResult } from "../output";
import { isBundled, PACKAGE_NAME, readVersionInfo } from "../paths";
import { changesBetween, fetchLatestVersion, localAdminFolder, readChangelog, siteAdminVersion } from "../remote";
import { compareVersions } from "../semver";
import { listSites, putSite, resolveSite, type SiteRecord } from "../sites";
import type { Command } from "./types";
import { strOpt } from "./util";

export const versionCommand: Command = {
  name: "version",
  usage: "version",
  summary: "Print the AgentCRM version (CLI, minimum skills version, data schema).",
  options: [],
  async run({ io }) {
    const info = readVersionInfo();
    printResult(io, { ...info, bundled: isBundled(), node: process.versions.node }, () => info.version);
  },
};

export interface SiteStatus {
  alias: string;
  adminUrl: string | null;
  // local-folder hosting without a public URL: where the admin is.
  adminFolder?: string;
  adminVersion: string | null;
  // current | update (deploy-admin proposed) | newer (update the tool first) | not-hosted | unreachable
  state: "current" | "update" | "newer" | "not-hosted" | "unreachable";
  error?: string;
  update?: ReturnType<typeof changesBetween>;
  blockedByDataSchema?: boolean;
}

export async function siteStatus(site: SiteRecord, version: string, dataSchema: number): Promise<SiteStatus> {
  const folder = site.adminUrl ? null : localAdminFolder(site.hosting);
  const base = { alias: site.alias, adminUrl: site.adminUrl, ...(folder ? { adminFolder: folder } : {}) };
  // An admin in a local folder (no public URL) is checked on disk.
  const hosted = await siteAdminVersion(site);
  if (hosted.source === "none") return { ...base, adminVersion: null, state: "not-hosted" };
  if (!hosted.version) return { ...base, adminVersion: null, state: "unreachable", error: hosted.error };
  if (hosted.version !== site.adminVersion) putSite({ ...site, adminVersion: hosted.version });
  const cmp = compareVersions(hosted.version, version);
  if (cmp === 0) return { ...base, adminVersion: hosted.version, state: "current" };
  if (cmp > 0) return { ...base, adminVersion: hosted.version, state: "newer" };
  return {
    ...base,
    adminVersion: hosted.version,
    state: "update",
    update: changesBetween(readChangelog(), hosted.version, version),
    blockedByDataSchema: hosted.dataSchema !== null && hosted.dataSchema > dataSchema,
  };
}

export const statusCommand: Command = {
  name: "status",
  usage: "status [--site <alias>]",
  summary: "Versions overview — run it first: this tool (= the skills) vs the latest npm release, and every registered CRM's hosted admin vs this release.",
  options: [{ name: "site", type: "string", description: "Only this site (default: every registered site)." }],
  async run({ io, options }) {
    const info = readVersionInfo();
    const alias = strOpt(options, "site");
    const sites = alias ? [resolveSite(alias)] : listSites().sites;
    const [latest, statuses] = await Promise.all([fetchLatestVersion(PACKAGE_NAME), Promise.all(sites.map((s) => siteStatus(s, info.version, info.dataSchema)))]);
    const updateAvailable = latest ? compareVersions(latest, info.version) > 0 : null;
    const data = {
      tool: { version: info.version, latest, updateAvailable, minSkillsVersion: info.minSkillsVersion, dataSchema: info.dataSchema },
      sites: statuses,
      advice: [
        ...(updateAvailable ? [`agentcrm ${latest} is available (this is ${info.version}): offer to update the skills first (Claude Code: /plugin marketplace update agentcrm, then /reload-plugins).`] : []),
        ...statuses.filter((s) => s.state === "update").map((s) =>
          s.blockedByDataSchema
            ? `${s.alias}: the hosted admin stores data in a newer format than this tool — update the tool, never downgrade.`
            : `${s.alias}: admin ${s.adminVersion} → ${info.version} available${s.update?.breaking ? " (BREAKING — read the changes)" : ""}: offer \`agentcrm deploy-admin --site ${s.alias}\`.`,
        ),
        ...statuses.filter((s) => s.state === "newer").map((s) => `${s.alias}: hosted admin ${s.adminVersion} is newer than this tool — update the tool before deploying.`),
        ...statuses.filter((s) => s.state === "unreachable").map((s) => `${s.alias}: admin not reachable (${s.error}) — run \`agentcrm doctor --site ${s.alias}\`.`),
      ],
    };
    printResult(io, data, () =>
      [
        `agentcrm ${info.version}${updateAvailable ? ` — ${latest} available` : latest ? " (latest)" : ""}`,
        ...statuses.map((s) => `  ${s.alias.padEnd(20)} admin ${s.adminVersion ?? "-"}  ${s.state}${s.error ? ` (${s.error})` : ""}`),
        ...(data.advice.length ? ["", ...data.advice.map((a) => `- ${a}`)] : []),
      ].join("\n"),
    );
  },
};

export const optionsCommand: Command = {
  name: "options",
  usage: "options",
  summary: "Data backends, data locations, admin hostings, credential types and the install plan format — ask the user about the data first, then the hosting. --firebase-rules <admin email> prints the Firestore security rules to publish.",
  options: [{ name: "firebase-rules", type: "string", description: "Print the Firestore rules for a Firebase CRM with this email as bootstrap admin." }],
  async run({ io, options }) {
    const rulesEmail = strOpt(options, "firebase-rules");
    if (rulesEmail) {
      const { buildFirestoreRules } = await import("../../src/ops/firebaseRules");
      const rules = buildFirestoreRules({ adminEmail: rulesEmail });
      printResult(io, { email: rulesEmail, rules, where: "Firebase console → Firestore Database → Rules → paste → Publish (or `firebase deploy --only firestore:rules`)." }, () => rules);
      return;
    }
    const { PLAN_EXAMPLE } = await import("../ops/plan");
    const data = {
      order: ["data backend", "data location", "admin hosting"],
      backends: DATA_BACKENDS,
      locations: LOCATIONS,
      hostings: HOSTINGS,
      credentialTypes: CREDENTIAL_TYPES,
      planFormat: {
        alias: "lower-case-alias (required)",
        name: "Display name of the CRM",
        owner: "{ name, email } — the first admin; the CLI acts as this user",
        data: '{ backend: "journal", location: { type, settings, credential }, root?, encryption? } | { backend: "git-json", git: {…}, credential } | { backend: "firebase", firebase: {…}, credential }',
        hosting: "{ type, settings, credential?, folder? } | false",
        demo: "true seeds ~30 companies, 80 people, 40 deals and their activities",
        currency: "ISO code, default EUR / USD from settings",
        locale: "BCP-47, e.g. en-US / fr-FR",
      },
      planExample: PLAN_EXAMPLE,
      planNotes: [
        "Secrets never go in the plan: store them first with `agentcrm credentials set <type>:<name>` (the user types them, or --from-env) and reference the account id.",
        "Journal data is encrypted by default: a passphrase is generated at install and stored as passphrase:<alias> on this computer — the user must save it in a password manager.",
        "hosting.credential may be omitted for git hostings on the same provider as the data credential.",
        "hosting: false skips uploading the admin (run `agentcrm serve` to use it locally).",
        "Run `agentcrm install --plan plan.json --dry-run` first: it checks every access without writing.",
      ],
    };
    printResult(io, data, () =>
      [
        "1. Data backend:",
        ...DATA_BACKENDS.map((d) => `   ${d.id.padEnd(10)} ${d.summary}${d.cli ? "" : "  (browser only)"}`),
        "",
        "2. Data location (journal):",
        ...LOCATIONS.map((l) => `   ${l.id.padEnd(13)} ${l.summary}`),
        "",
        "3. Admin hosting:",
        ...HOSTINGS.map((h) => `   ${h.id.padEnd(17)} ${h.summary}${h.cli ? "" : "  (wizard only)"}`),
        "",
        "Plan example (agentcrm install --plan plan.json):",
        JSON.stringify(PLAN_EXAMPLE, null, 2),
      ].join("\n"),
    );
  },
};
