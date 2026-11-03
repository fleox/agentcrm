import { installBrowserEnv } from "../browserEnv";
import { CliError, printResult } from "../output";
import { readVersionInfo } from "../paths";
import { changesBetween, fetchHostedAdmin, readChangelog } from "../remote";
import { compareVersions } from "../semver";
import { listSites, lockSite, putSite, resolveSite, type SiteRecord } from "../sites";
import type { Command } from "./types";
import { strOpt } from "./util";

// Updates hosted admins to this release. Without --yes it only prints the
// plan (for the agent to confirm with the user); with --yes it uploads
// the build + version.json + a fresh config.js (one commit on git hosts).

interface DeployPlan {
  alias: string;
  adminUrl: string | null;
  hosting: string;
  from: string | null;
  to: string;
  files: number;
  changes: ReturnType<typeof changesBetween> | null;
  refused?: string;
}

export const deployAdminCommand: Command = {
  name: "deploy-admin",
  usage: "deploy-admin [--site <alias> | --all] [--yes] [--allow-downgrade]",
  summary: "Upload this release's admin (+ version.json + config.js, never secrets) to a CRM's hosting. Prints the plan unless --yes; refuses downgrades and admins that store a newer data format.",
  options: [
    { name: "site", type: "string", description: "Site alias." },
    { name: "all", type: "boolean", description: "Every registered site with a hosting." },
    { name: "yes", type: "boolean", description: "Apply — only after the user confirmed the plan." },
    { name: "allow-downgrade", type: "boolean", description: "Allow installing an older admin than the hosted one." },
  ],
  async run({ io, options }) {
    const info = readVersionInfo();
    const sites: SiteRecord[] = options.all === true ? listSites().sites.filter((s) => s.hosting) : [resolveSite(strOpt(options, "site"))];
    if (!sites.length) throw new CliError("no-sites", "No registered CRM has a hosting.");
    installBrowserEnv();
    const { adminOps, applyOps, buildConnector } = await import("../ops/hosting");
    const { hostingTargetOf } = await import("../ops/session");
    const plans: DeployPlan[] = [];
    for (const site of sites) {
      if (!site.hosting) throw new CliError("not-hosted", `${site.alias} has no hosting recorded.`, "Register it with `site add --admin-url …` from a CRM whose admin is hosted, or reinstall with a hosting.");
      const hosted = site.adminUrl ? await fetchHostedAdmin(site.adminUrl) : { version: null, dataSchema: null };
      const plan: DeployPlan = {
        alias: site.alias,
        adminUrl: site.adminUrl,
        hosting: site.hosting.type,
        from: hosted.version,
        to: info.version,
        files: adminOps(site.hosting.folder, site.runtime).ops.length,
        changes: hosted.version ? changesBetween(readChangelog(), hosted.version, info.version) : null,
      };
      if (hosted.dataSchema !== null && hosted.dataSchema > info.dataSchema) plan.refused = `the hosted admin stores data format ${hosted.dataSchema}, this release only knows ${info.dataSchema} — update agentcrm instead`;
      else if (hosted.version && compareVersions(hosted.version, info.version) > 0 && options["allow-downgrade"] !== true) plan.refused = `the hosted admin (${hosted.version}) is newer than this release — update agentcrm, or pass --allow-downgrade`;
      plans.push(plan);
    }
    if (options.yes !== true) {
      printResult(io, { needsConfirmation: true, plans }, () =>
        [...plans.map((p) => (p.refused ? `${p.alias}: refused — ${p.refused}` : `${p.alias}: admin ${p.from ?? "(none)"} → ${p.to} on ${p.hosting}, ${p.files} files`)), "Nothing was changed. Re-run with --yes once the user agrees."].join("\n"),
      );
      return;
    }
    const results: Array<{ alias: string; deployed: boolean; from?: string | null; to?: string; files?: number; reason?: string }> = [];
    for (const [i, site] of sites.entries()) {
      const plan = plans[i];
      if (plan.refused) {
        results.push({ alias: site.alias, deployed: false, reason: plan.refused });
        continue;
      }
      const unlock = lockSite(site.alias);
      try {
        const { ops } = adminOps(site.hosting!.folder, site.runtime);
        io.err(`• ${site.alias}: uploading ${ops.length} files…`);
        await applyOps(buildConnector(hostingTargetOf(site)!), ops);
        putSite({ ...site, adminVersion: info.version });
        results.push({ alias: site.alias, deployed: true, from: plan.from, to: info.version, files: ops.length });
      } catch (err) {
        results.push({ alias: site.alias, deployed: false, reason: (err as Error).message });
      } finally {
        unlock();
      }
    }
    printResult(io, { results }, () => results.map((r) => (r.deployed ? `${r.alias}: admin ${r.from ?? "(none)"} → ${r.to}` : `${r.alias}: not deployed — ${r.reason}`)).join("\n"));
    if (results.some((r) => !r.deployed)) return 1;
  },
};
