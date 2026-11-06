import { isAbsolute, resolve } from "node:path";
import { installBrowserEnv } from "../browserEnv";
import { getCredential, parseAccount } from "../credentials";
import { CliError, printResult } from "../output";
import { fetchText, parseConfigJs } from "../remote";
import { getSite, listSites, putSite, removeSite, renameSite, resolveSite, setDefaultSite, validateAlias, type SiteRecord } from "../sites";
import type { Command } from "./types";
import { jsonObjectOpt, strOpt, usage } from "./util";

// What the CLI will need to manage this site and isn't recorded.
export function missingCredentials(site: SiteRecord): string[] {
  const out: string[] = [];
  const c = site.credentials;
  const set = `\`agentcrm site credentials ${site.alias} --<role>-credential <account>\``;
  const rt = site.runtime;
  if (rt.backend === "journal") {
    if (rt.journal.connectorId !== "local-folder" && !c.data) out.push(`No credential can open the data location: add one with ${set} (role data).`);
    if (rt.journal.connectorId === "local-folder" && !site.dataPath) out.push("The data folder of this computer is unknown: re-register with --data-path <folder>.");
    if (rt.journal.encrypted && !c.passphrase) out.push(`The dataset is encrypted and no passphrase credential is recorded: store it (\`agentcrm credentials set passphrase:${site.alias}\`) then ${set} (role passphrase).`);
  }
  if ((rt.backend === "git-json" || rt.backend === "firebase") && !c.data) out.push(`No ${rt.backend === "firebase" ? "Firebase login" : "git token"}: add it with ${set} (role data).`);
  if (site.hosting && site.hosting.connectorId !== "local-folder" && !c.hosting) out.push(`No hosting credential: deploy-admin and forms publish will fail until one is added with ${set} (role hosting).`);
  return out;
}

function checkAccount(v: string): string {
  parseAccount(v);
  if (!getCredential(v)) throw new CliError("credential-missing", `${v} is not stored on this computer.`, `Store it first: \`agentcrm credentials set ${v}\` (in the user's own terminal).`, 2);
  return v;
}

export const siteCommand: Command = {
  name: "site",
  usage: "site <list|show|add|use|rename|forget|credentials|runtime> [args] [--admin-url <url>] [--data-credential <acct>] [--hosting-credential <acct>] [--passphrase-credential <acct>] [--user <email>]",
  summary: "The registry of CRMs this computer drives (~/.agentcrm/sites.json, no secrets): list, show, add an existing CRM, choose the default, rename, forget (local only — nothing is deleted online), attach credentials.",
  subcommands: [
    { name: "list", usage: "site list", summary: "Registered CRMs (* = default)." },
    { name: "show", usage: "site show [<alias>]", summary: "One site's record (backend, location, hosting, credential accounts, CLI user)." },
    { name: "add", usage: "site add <alias> (--admin-url <url> | --runtime <json|@file>) [--data-credential …] [--hosting-credential …] [--passphrase-credential …] [--data-path <folder>] [--user <email>]", summary: "Register a CRM installed elsewhere: reads its config.js, opens the data to prove the credentials, reads its hosting.", writes: true },
    { name: "use", usage: "site use <alias>", summary: "Default site for commands without --site.", writes: true },
    { name: "rename", usage: "site rename <from> <to>", summary: "Rename an alias.", writes: true },
    { name: "forget", usage: "site forget <alias>", summary: "Remove from this computer's registry (nothing is deleted online).", writes: true },
    { name: "credentials", usage: "site credentials <alias> [--data-credential <acct>] [--hosting-credential <acct>] [--passphrase-credential <acct>] [--user <email>]", summary: "Attach / change the accounts a site uses (\"\" removes one).", writes: true },
    { name: "runtime", usage: "site runtime <alias> --runtime <json|@file>", summary: "Replace the runtime config this computer uses for a site (same backend and project only; e.g. add a files endpoint).", writes: true },
  ],
  options: [
    { name: "site", type: "string", description: "Site alias (show / credentials)." },
    { name: "admin-url", type: "string", description: "add: URL of the hosted admin, e.g. https://crm.acme.com/admin/." },
    { name: "runtime", type: "string", description: "add / runtime: the runtime config (config.js object) as JSON or @file, when the admin isn't hosted." },
    { name: "data-credential", type: "string", description: "Account of the data location / git token / Firebase login." },
    { name: "hosting-credential", type: "string", description: "Account used to write to the admin hosting." },
    { name: "passphrase-credential", type: "string", description: "Passphrase account of an encrypted dataset." },
    { name: "data-path", type: "string", description: "add: folder of this computer holding a local-folder dataset." },
    { name: "user", type: "string", description: "Email of the CRM user the CLI acts as (default: the store identity / first admin)." },
  ],
  async run({ io, options, positionals }) {
    const [action = "list", a, b] = positionals;
    switch (action) {
      case "list": {
        const { default: def, sites } = listSites();
        const rows = sites.map((s) => ({
          alias: s.alias,
          name: s.name ?? s.alias,
          default: s.alias === def,
          backend: s.runtime.backend,
          location: s.runtime.backend === "journal" ? s.runtime.journal.connectorId : null,
          hosting: s.hosting?.type ?? null,
          adminUrl: s.adminUrl,
          adminVersion: s.adminVersion ?? null,
        }));
        printResult(io, { default: def, sites: rows }, () =>
          rows.length ? rows.map((r) => `${r.default ? "*" : " "} ${r.alias.padEnd(20)} ${r.backend}${r.location ? `/${r.location}` : ""} → ${r.hosting ?? "not hosted"}  ${r.adminUrl ?? ""}`).join("\n") : "No CRM registered. Install one with `agentcrm install --plan …` or register one with `agentcrm site add`.",
        );
        return;
      }
      case "show": {
        const site = resolveSite(a ?? strOpt(options, "site"));
        printResult(io, { ...site, warnings: missingCredentials(site) }, () => JSON.stringify(site, null, 2));
        return;
      }
      case "use": {
        if (!a) usage("site use needs an alias.");
        setDefaultSite(a);
        printResult(io, { default: a }, () => `Default site: ${a}`);
        return;
      }
      case "rename": {
        if (!a || !b) usage("site rename needs <from> <to>.");
        renameSite(a, b);
        printResult(io, { from: a, to: b }, () => `Renamed ${a} → ${b}`);
        return;
      }
      case "forget": {
        if (!a) usage("site forget needs an alias.");
        const removed = removeSite(a);
        printResult(io, { alias: a, removed }, () => (removed ? `Forgot ${a} (nothing was deleted online).` : `${a} was not registered.`));
        return;
      }
      case "credentials": {
        const site = resolveSite(a ?? strOpt(options, "site"));
        const roles = { data: "data-credential", hosting: "hosting-credential", passphrase: "passphrase-credential" } as const;
        const next = { ...site.credentials };
        let changed = false;
        for (const [role, flag] of Object.entries(roles) as Array<[keyof typeof roles, string]>) {
          const v = options[flag];
          if (typeof v !== "string") continue;
          if (v === "") delete next[role];
          else next[role] = checkAccount(v);
          changed = true;
        }
        const user = strOpt(options, "user");
        if (user !== undefined) changed = true;
        if (!changed) usage('site credentials needs --data-credential, --hosting-credential, --passphrase-credential and/or --user ("" removes one).');
        const updated: SiteRecord = { ...site, credentials: next, ...(user !== undefined ? { user: user || undefined } : {}) };
        putSite(updated);
        const warnings = missingCredentials(updated);
        printResult(io, { alias: site.alias, credentials: next, user: updated.user ?? null, warnings }, () => [`${site.alias}: ${JSON.stringify(next)}`, ...warnings.map((w) => `  warning: ${w}`)].join("\n"));
        return;
      }
      case "runtime": {
        const site = resolveSite(a ?? strOpt(options, "site"));
        const raw = jsonObjectOpt(options, "runtime");
        if (!raw) usage("site runtime needs --runtime <json|@file>.");
        installBrowserEnv();
        const { parseRuntimeConfig, datasetId } = await import("../../src/lib/runtimeConfig");
        const runtime = parseRuntimeConfig(raw);
        if (!runtime) throw new CliError("config-invalid", "The runtime config is not a valid AgentCRM config.", "It is the object config.js assigns to window.__AGENTCRM_CONFIG__.");
        // Same dataset only: pointing an alias at other data is `site forget` + `site add`.
        if (datasetId(runtime) !== datasetId(site.runtime)) {
          throw new CliError("config-mismatch", `This runtime config points at other data (${datasetId(runtime)}, not ${datasetId(site.runtime)}).`, "Register it under another alias with `site add`.");
        }
        const updated: SiteRecord = { ...site, name: runtime.name ?? site.name, runtime, updatedAt: new Date().toISOString() };
        putSite(updated);
        printResult(io, { alias: site.alias, runtime }, () => `${site.alias}: runtime config updated.`);
        return;
      }
      case "add": {
        if (!a) usage("site add needs an alias.");
        validateAlias(a);
        if (getSite(a)) throw new CliError("site-exists", `A site named "${a}" already exists.`, "Pick another alias or `site forget` it first.");
        const adminUrlRaw = strOpt(options, "admin-url");
        let runtimeRaw: unknown = jsonObjectOpt(options, "runtime");
        let adminUrl: string | null = null;
        if (adminUrlRaw) {
          adminUrl = adminUrlRaw.replace(/(index\.html)?$/, "").replace(/\/?$/, "/");
          const res = await fetchText(`${adminUrl}config.js`);
          if (!res.ok) throw new CliError("admin-unreachable", `Could not read ${adminUrl}config.js (${res.error ?? `HTTP ${res.status}`}).`, "Check the admin URL (it ends with the admin folder, e.g. …/admin/).");
          try {
            runtimeRaw = parseConfigJs(res.text);
          } catch (err) {
            throw new CliError("config-invalid", `${adminUrl}config.js: ${(err as Error).message}.`);
          }
        }
        if (!runtimeRaw) usage("site add needs --admin-url <url> or --runtime <json|@file>.");
        installBrowserEnv();
        const { parseRuntimeConfig } = await import("../../src/lib/runtimeConfig");
        const runtime = parseRuntimeConfig(runtimeRaw);
        if (!runtime) throw new CliError("config-invalid", "The runtime config is not a valid AgentCRM config.", "It is the object config.js assigns to window.__AGENTCRM_CONFIG__.");
        const dataPath = strOpt(options, "data-path");
        if (dataPath && !isAbsolute(dataPath)) usage("--data-path must be an absolute folder.");
        const credentials: SiteRecord["credentials"] = {};
        for (const [role, flag] of [["data", "data-credential"], ["hosting", "hosting-credential"], ["passphrase", "passphrase-credential"]] as const) {
          const v = strOpt(options, flag);
          if (v) credentials[role] = checkAccount(v);
        }
        const now = new Date().toISOString();
        const site: SiteRecord = {
          alias: a,
          name: runtime.name,
          runtime,
          ...(dataPath ? { dataPath: resolve(dataPath) } : {}),
          hosting: null,
          adminUrl,
          credentials,
          ...(strOpt(options, "user") ? { user: strOpt(options, "user") } : {}),
          installedAt: now,
          updatedAt: now,
        };
        // Open the data: proves the credentials and reads the hosting.
        const warnings: string[] = [];
        const { openStore } = await import("../ops/session");
        const { dataTargetOf } = await import("../ops/session");
        try {
          const passphrase = credentials.passphrase ? (await import("../credentials")).requireCredential(credentials.passphrase).values.passphrase : null;
          const secrets = credentials.data && runtime.backend !== "journal" ? (await import("../credentials")).requireCredential(credentials.data).values : undefined;
          const store = await openStore(runtime, { dataTarget: runtime.backend === "journal" ? dataTargetOf(site) : undefined, secrets, passphrase });
          try {
            await store.ready();
            const hosting = store.get("config", "hosting") as { connectorId?: string; settings?: Record<string, unknown>; folder?: string; type?: string } | undefined;
            if (hosting?.connectorId) {
              site.hosting = { type: hosting.type ?? hosting.connectorId, connectorId: hosting.connectorId, settings: hosting.settings ?? {}, folder: hosting.folder ?? "admin" };
            }
          } finally {
            store.close?.();
          }
        } catch (err) {
          const e = err as Error;
          if (e.name === "PassphraseError") throw err;
          warnings.push(`Could not open the data yet: ${e.message}`);
        }
        putSite(site);
        warnings.push(...missingCredentials(site));
        printResult(io, { ...site, warnings }, () => [`Registered ${a}: ${runtime.backend} → ${site.hosting?.type ?? "hosting unknown"}`, ...warnings.map((w) => `  warning: ${w}`)].join("\n"));
        return;
      }
      default:
        usage(`Unknown action "${action}".`, "Use list, show, add, use, rename, forget or credentials.");
    }
  },
};
