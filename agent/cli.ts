import { parseArgs } from "node:util";
import { COMMANDS, findCommand, GLOBAL_OPTIONS } from "./commands";
import { CliError, createIo, printError, type Io } from "./output";

// Entry point of `agentcrm` (bundled to dist/agent/agentcrm.mjs). Mirror
// of cms-ia agent/cli.ts.

export async function main(argv: string[], io?: Io): Promise<number> {
  const json = argv.includes("--json");
  const out = io ?? createIo(json);
  try {
    const [name = "help", ...rest] = argv.filter((a) => a !== "--json");
    if (name === "--help" || name === "-h") return (await run("help", rest, out)) ?? 0;
    if (name === "--version" || name === "-v") return (await run("version", rest, out)) ?? 0;
    return (await run(name, rest, out)) ?? 0;
  } catch (error) {
    return printError(out, error);
  }
}

async function run(name: string, args: string[], io: Io): Promise<number | void> {
  const command = findCommand(name);
  if (!command) {
    throw new CliError("unknown-command", `Unknown command "${name}".`, `Available: ${COMMANDS.map((c) => c.name).join(", ")}. Run \`agentcrm help\`.`, 2);
  }
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: Object.fromEntries([...command.options, ...GLOBAL_OPTIONS].map((o) => [o.name, { type: o.type, ...(o.multiple ? { multiple: true } : {}) }])),
    });
  } catch (e) {
    throw new CliError("usage", (e as Error).message, `Usage: agentcrm ${command.usage}`, 2);
  }
  if (parsed.values.help && command.name !== "help") return run("help", [command.name], io);
  return command.run({
    io,
    options: Object.fromEntries(Object.entries(parsed.values).map(([k, v]) => [k, Array.isArray(v) ? v.join(" ") : v])) as Record<string, string | boolean | undefined>,
    positionals: parsed.positionals,
  });
}
