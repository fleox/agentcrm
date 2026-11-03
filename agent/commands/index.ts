// Command registry — SKELETON (the CLI agent adds every command listed in
// CLAUDE.md: status, credentials, install, site, records, tools, mcp…).
import { printResult } from "../output";
import type { Command, CommandOption } from "./types";

declare const __AGENTCRM_BUNDLED__: boolean | undefined;

export const GLOBAL_OPTIONS: CommandOption[] = [
  { name: "json", type: "boolean", description: "One JSON object on stdout." },
  { name: "help", type: "boolean", description: "Help for the command." },
];

const help: Command = {
  name: "help",
  usage: "help [command]",
  summary: "List commands, or show the help of one.",
  options: [],
  async run({ io, positionals }) {
    const target = positionals[0] ? findCommand(positionals[0]) : undefined;
    if (target) {
      printResult(io, { name: target.name, usage: target.usage, summary: target.summary, options: target.options }, () =>
        [`agentcrm ${target.usage}`, "", target.summary, ...target.options.map((o) => `  --${o.name}  ${o.description}`)].join("\n"),
      );
      return;
    }
    printResult(io, { commands: COMMANDS.map((c) => ({ name: c.name, summary: c.summary })) }, () =>
      ["AgentCRM — the static CRM your AI agent can run.", "", ...COMMANDS.map((c) => `  ${c.name.padEnd(12)} ${c.summary}`)].join("\n"),
    );
  },
};

const version: Command = {
  name: "version",
  usage: "version",
  summary: "Print the AgentCRM version.",
  options: [],
  async run({ io }) {
    const { version } = await import("../../package.json");
    printResult(io, { version, bundled: typeof __AGENTCRM_BUNDLED__ !== "undefined" }, () => version);
  },
};

export const COMMANDS: Command[] = [help, version];

export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name);
}
