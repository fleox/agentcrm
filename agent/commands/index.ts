// Every command the CLI exposes. `help --json` lists them (with their
// subcommands and options), and scripts/check-skills.mjs fails the build
// when a skill mentions a command or subcommand that is not here — keep
// skills and commands in sync.
import { printResult } from "../output";
import { readVersionInfo } from "../paths";
import { activitiesCommand, notesCommand, tasksCommand } from "./activities";
import { pipelinesCommand, settingsCommand, usersCommand, viewsCommand } from "./admin";
import { credentialsCommand } from "./credentials";
import { appearanceCommand, modulesCommand } from "./customize";
import { extCommand } from "./ext";
import { automationsCommand, compactCommand, exportCommand, formsCommand, importCommand, reportCommand, statsCommand } from "./data";
import { deployAdminCommand } from "./deployAdmin";
import { doctorCommand } from "./doctor";
import { filesCommand } from "./files";
import { installCommand } from "./install";
import { optionsCommand, statusCommand, versionCommand } from "./meta";
import { recordsCommand } from "./records";
import { fieldsCommand, objectsCommand, schemaCommand } from "./schema";
import { serveCommand } from "./serve";
import { siteCommand } from "./site";
import { mcpCommand, toolsCommand } from "./tools";
import type { Command, CommandOption } from "./types";

export const GLOBAL_OPTIONS: CommandOption[] = [
  { name: "json", type: "boolean", description: "Print one JSON object on stdout: { ok, data } or { ok: false, error: { code, message, hint } }." },
  { name: "help", type: "boolean", description: "Show the command's usage and options instead of running it." },
  { name: "safe", type: "boolean", description: "Safe mode: don't load the site's extensions (modules / themes) in this run (also AGENTCRM_SAFE=1)." },
];

const helpCommand: Command = {
  name: "help",
  usage: "help [<command>]",
  summary: "List commands with their subcommands and options (--json gives a machine-readable list).",
  options: [],
  async run({ io, positionals }) {
    const wanted = positionals[0];
    const list = wanted ? COMMANDS.filter((c) => c.name === wanted) : COMMANDS;
    if (wanted && !list.length) {
      const { CliError } = await import("../output");
      throw new CliError("unknown-command", `Unknown command "${wanted}".`, `Available: ${COMMANDS.map((c) => c.name).join(", ")}.`, 2);
    }
    const { version } = readVersionInfo();
    const data = {
      name: "agentcrm",
      version,
      globalOptions: GLOBAL_OPTIONS,
      commands: list.map(({ name, summary, usage, options, subcommands }) => ({ name, summary, usage, options, ...(subcommands ? { subcommands } : {}) })),
    };
    printResult(io, data, () =>
      [
        `agentcrm ${version} — the static CRM your AI agent can run.`,
        "",
        "Usage: agentcrm <command> [options] [--json]",
        "",
        ...list.flatMap((c) => [
          `  ${c.usage}`,
          `      ${c.summary}`,
          ...(wanted ? (c.subcommands ?? []).map((s) => `      · ${s.usage}\n          ${s.summary}`) : []),
          ...(wanted ? c.options.map((o) => `      --${o.name}${o.type === "string" ? " <value>" : ""}  ${o.description}`) : []),
        ]),
        "",
        "Global options:",
        ...GLOBAL_OPTIONS.map((o) => `  --${o.name}  ${o.description}`),
        ...(wanted ? [] : ["", "`agentcrm help <command>` shows a command's actions and options."]),
      ].join("\n"),
    );
  },
};

export const COMMANDS: Command[] = [
  helpCommand,
  versionCommand,
  statusCommand,
  optionsCommand,
  credentialsCommand,
  installCommand,
  siteCommand,
  doctorCommand,
  serveCommand,
  deployAdminCommand,
  recordsCommand,
  objectsCommand,
  schemaCommand,
  fieldsCommand,
  activitiesCommand,
  notesCommand,
  tasksCommand,
  filesCommand,
  pipelinesCommand,
  viewsCommand,
  usersCommand,
  settingsCommand,
  importCommand,
  exportCommand,
  reportCommand,
  automationsCommand,
  formsCommand,
  compactCommand,
  statsCommand,
  modulesCommand,
  appearanceCommand,
  extCommand,
  toolsCommand,
  mcpCommand,
];

export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name);
}
