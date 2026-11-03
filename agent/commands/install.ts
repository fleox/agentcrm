import { readFileSync } from "node:fs";
import { installBrowserEnv } from "../browserEnv";
import { CliError, printResult } from "../output";
import { getSite, lockSite, putSite } from "../sites";
import type { Command } from "./types";
import { strOpt, usage } from "./util";

function readPlan(source: string): unknown {
  let text: string;
  try {
    text = source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8");
  } catch (err) {
    throw new CliError("invalid-plan", `Could not read the plan: ${(err as Error).message}`, undefined, 2);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new CliError("invalid-plan", `The plan is not valid JSON: ${(err as Error).message}`, undefined, 2);
  }
}

export const installCommand: Command = {
  name: "install",
  usage: "install --plan <file|-> [--dry-run]",
  summary:
    "Install a CRM from a JSON plan (see `options`): checks access, creates the (encrypted) dataset on the chosen location, seeds the standard objects, pipeline, views and first admin (+ optional demo data), uploads the admin + config.js to the hosting, registers the site. --dry-run only checks.",
  options: [
    { name: "plan", type: "string", description: "Plan file path, or - for stdin." },
    { name: "dry-run", type: "boolean", description: "Validate the plan and test every access without writing anything." },
  ],
  async run({ io, options }) {
    const planPath = strOpt(options, "plan");
    if (!planPath) usage("install needs --plan <file|->.", "Run `agentcrm options` for the format.");
    installBrowserEnv();
    const { resolvePlan } = await import("../ops/plan");
    const plan = resolvePlan(readPlan(planPath) as Parameters<typeof resolvePlan>[0]);
    if (getSite(plan.alias)) throw new CliError("site-exists", `A site named "${plan.alias}" is already registered.`, "Use another alias, or `agentcrm site forget` it first.");
    const { checkPlan, runInstall } = await import("../ops/install");
    io.err("Checking access…");
    const checks = await checkPlan(plan);
    const summary = {
      alias: plan.alias,
      name: plan.name,
      backend: plan.backend,
      location: plan.dataType ?? null,
      hosting: plan.hosting?.type ?? null,
      adminUrl: plan.adminUrl,
      owner: plan.owner,
      credentials: plan.credentials,
      encrypted: plan.runtime.backend === "journal" ? plan.runtime.journal.encrypted : null,
      checks,
      warnings: plan.warnings,
    };
    if (!checks.data.ok || (checks.hosting && !checks.hosting.ok)) {
      throw new CliError(
        "check-failed",
        [!checks.data.ok && `Data: ${checks.data.detail}`, checks.hosting && !checks.hosting.ok && `Hosting: ${checks.hosting.detail}`].filter(Boolean).join(" — "),
        "Fix the access (key / token permissions, bucket / repo names, URL, CORS) and retry the dry run.",
      );
    }
    if (options["dry-run"] === true) {
      printResult(io, { ...summary, dryRun: true, existingData: checks.data.existing }, () => `Plan OK for ${plan.alias}: ${plan.backend}${plan.dataType ? ` on ${plan.dataType}` : ""} → ${plan.hosting?.type ?? "not hosted"}. Nothing was written.`);
      return;
    }
    const unlock = lockSite(plan.alias);
    try {
      const outcome = await runInstall(plan, (label) => io.err(`• ${label}`));
      const now = new Date().toISOString();
      putSite({
        alias: plan.alias,
        name: plan.name,
        runtime: plan.runtime,
        ...(plan.dataPath ? { dataPath: plan.dataPath } : {}),
        hosting: plan.hosting,
        adminUrl: plan.adminUrl,
        credentials: plan.credentials,
        user: plan.owner.email,
        ...(outcome.adminVersion ? { adminVersion: outcome.adminVersion } : {}),
        installedAt: now,
        updatedAt: now,
      });
      const nextSteps: string[] = [];
      if (plan.adminUrl) nextSteps.push(`Open the admin: ${plan.adminUrl}`);
      else nextSteps.push("The admin was not uploaded: run `agentcrm serve` to use it on this computer.");
      if (plan.backend === "journal") {
        nextSteps.push(`Each new browser asks once for the data location keys${plan.passphraseAccount ? " and the passphrase" : ""} (they stay in that browser).`);
      } else if (plan.backend === "git-json") {
        nextSteps.push("Each user signs in to the admin with their own git token (Contents read/write on the data repository).");
      } else {
        nextSteps.push("Users sign in with their Firebase accounts; add them with `agentcrm users add` and create their logins in the Firebase console.");
      }
      for (const w of plan.warnings) nextSteps.push(`Warning: ${w}`);
      nextSteps.push(`Check everything with \`agentcrm doctor --site ${plan.alias}\`.`);
      const savePassphrase = plan.passphraseAccount
        ? {
            account: plan.passphraseAccount,
            generated: outcome.generatedPassphrase,
            why: "The CRM data is encrypted with this passphrase. It is stored only on this computer: without it no browser or computer can open the data, and nobody can recover it.",
            steps: [
              `\`agentcrm credentials copy ${plan.passphraseAccount}\` puts it on the clipboard (never print it).`,
              "The user pastes it into their password manager NOW (entry: the CRM admin URL) and confirms.",
              `The user runs \`agentcrm credentials verify ${plan.passphraseAccount}\` in their own terminal and pastes it FROM the password manager: it must say "verified".`,
            ],
          }
        : null;
      printResult(io, { ...summary, installed: true, seed: outcome.seed, files: outcome.files, adminVersion: outcome.adminVersion, notices: outcome.notices, savePassphrase, nextSteps }, () =>
        [
          `Installed ${plan.alias}.`,
          ...(savePassphrase ? ["", "!!! ACTION REQUIRED — SAVE THE PASSPHRASE NOW !!!", savePassphrase.why, ...savePassphrase.steps.map((s, i) => `  ${i + 1}. ${s}`), ""] : []),
          ...nextSteps.map((s) => `- ${s}`),
        ].join("\n"),
      );
    } finally {
      unlock();
    }
  },
};
