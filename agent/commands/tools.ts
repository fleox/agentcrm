import { readVersionInfo } from "../paths";
import { printResult } from "../output";
import { lockSite } from "../sites";
import { openSession, withSession } from "../ops/session";
import type { Command } from "./types";
import { AS_OPTION, boolOpt, jsonObjectOpt, positional, SITE_OPTION, strOpt, table, usage } from "./util";

export const toolsCommand: Command = {
  name: "tools",
  usage: "tools <list|call> [<name>] [--input <json|@file>]",
  summary: "The AI tool catalog (src/ai/tools.ts) — exactly what the MCP server and the in-admin assistant expose: list the tools with their JSON schemas, or call one with a JSON input.",
  subcommands: [
    { name: "list", usage: "tools list", summary: "Tools with description, input schema and whether they write." },
    { name: "call", usage: "tools call <name> --input <json|@file>", summary: "Run one tool as the site's CLI user.", writes: true },
  ],
  options: [SITE_OPTION, AS_OPTION, { name: "input", type: "string", description: "call: the tool input as a JSON object or @file." }],
  async run({ io, options, positionals }) {
    const [action = "list"] = positionals;
    if (action === "list") {
      const { AI_TOOLS } = await import("../../src/ai/tools");
      const tools = AI_TOOLS.map((t) => ({ name: t.name, description: t.description, mutating: t.mutating, inputSchema: t.inputSchema }));
      printResult(io, { tools }, () => table(tools, ["name", "mutating", "description"]));
      return;
    }
    if (action === "call") {
      const name = positional(positionals, 1, "tool name", "tools call <name> --input <json>");
      const { findTool, callTool } = await import("../../src/ai/tools");
      const tool = findTool(name);
      if (!tool) usage(`Unknown tool "${name}".`, "`agentcrm tools list` lists them.");
      const input = jsonObjectOpt(options, "input") ?? {};
      return withSession(io, options, { lock: tool.mutating }, async ({ ctx }) => ({ tool: name, result: await callTool(ctx, name, input) }));
    }
    usage(`Unknown tools action "${action}".`, "Use list or call.");
  },
};

export const mcpCommand: Command = {
  name: "mcp",
  usage: "mcp [--site <alias>] [--read-only] [--as <user>]",
  summary: "Run the MCP server on stdio (JSON-RPC 2.0, protocol 2025-06-18 / 2024-11-05): tools = the AI catalog (read-only mode hides the ones that write), resources = schema + pipelines, prompts = pipeline review, follow-up email, lead qualification. For Claude Desktop / Claude Code / Cursor.",
  options: [SITE_OPTION, AS_OPTION, { name: "read-only", type: "boolean", description: "Expose only the tools that don't write." }],
  async run({ options }) {
    const readOnly = boolOpt(options, "read-only");
    const session = await openSession(strOpt(options, "site"), { as: strOpt(options, "as") });
    const log = (msg: string) => process.stderr.write(`${msg}\n`);
    for (const w of session.warnings) log(`[agentcrm mcp] note: ${w}`);
    const { AI_TOOLS } = await import("../../src/ai/tools");
    const { createMcpServer, serveStdio } = await import("../mcp/server");
    let lastRefresh = Date.now();
    const server = createMcpServer({
      readOnly,
      tools: AI_TOOLS,
      log,
      backend: {
        serverName: "agentcrm",
        version: readVersionInfo().version,
        siteLabel: `site ${session.site.alias}${session.user ? `, acting as ${session.user.email} (${session.user.role})` : ""}`,
        async context() {
          // Pick up changes made elsewhere (browser admin, other agents).
          if (Date.now() - lastRefresh > 5000) {
            lastRefresh = Date.now();
            await session.store.refresh().catch((err) => log(`[agentcrm mcp] refresh failed: ${(err as Error).message}`));
          }
          return session.ctx;
        },
        async withWrite(fn) {
          const unlock = lockSite(session.site.alias);
          try {
            return await fn();
          } finally {
            unlock();
          }
        },
      },
    });
    log(`[agentcrm mcp] serving ${session.site.alias}${readOnly ? " (read-only)" : ""} on stdio — ${server.toolNames().length} tools`);
    try {
      await serveStdio(server, process.stdin, (line) => process.stdout.write(line + "\n"), log);
    } finally {
      await session.close();
    }
    return 0;
  },
};
