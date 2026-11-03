import { readVersionInfo } from "../paths";
import { printResult } from "../output";
import { lockSite, resolveSite } from "../sites";
import { openSession, withSession } from "../ops/session";
import type { Command } from "./types";
import { AS_OPTION, boolOpt, jsonObjectOpt, positional, SITE_OPTION, strOpt, table, usage } from "./util";

export const toolsCommand: Command = {
  name: "tools",
  usage: "tools <list|call> [<name>] [--input <json|@file>]",
  summary: "The AI tool catalog (src/ai/tools.ts + the tools of the site's enabled extension modules) — exactly what the MCP server and the in-admin assistant expose: list the tools with their JSON schemas, or call one with a JSON input.",
  subcommands: [
    { name: "list", usage: "tools list [--site <alias>]", summary: "Tools with description, input schema, whether they write and their source (builtin / extension)." },
    { name: "call", usage: "tools call <name> --input <json|@file>", summary: "Run one tool as the site's CLI user.", writes: true },
  ],
  options: [SITE_OPTION, AS_OPTION, { name: "input", type: "string", description: "call: the tool input as a JSON object or @file." }],
  async run({ io, options, positionals }) {
    const [action = "list"] = positionals;
    if (action === "list") {
      const { listAiTools, AI_TOOLS } = await import("../../src/ai/tools");
      const builtin = new Set(AI_TOOLS.map((t) => t.name));
      const shape = () => listAiTools().map((t) => ({ name: t.name, description: t.description, mutating: t.mutating, source: builtin.has(t.name) ? "builtin" : "extension", inputSchema: t.inputSchema }));
      const human = (r: { tools: ReturnType<typeof shape> }) => table(r.tools, ["name", "mutating", "source", "description"]);
      // With a site: its enabled extensions are loaded, their tools listed.
      let site: string | undefined = strOpt(options, "site");
      if (!site) {
        try {
          site = resolveSite().alias;
        } catch {
          site = undefined;
        }
      }
      if (!site) {
        printResult(io, { tools: shape(), site: null }, () => human({ tools: shape() }));
        return;
      }
      return withSession(io, { ...options, site }, {}, async (s) => ({ tools: shape(), site: s.site.alias }), human);
    }
    if (action === "call") {
      const name = positional(positionals, 1, "tool name", "tools call <name> --input <json>");
      const { findTool, callTool, listAiTools } = await import("../../src/ai/tools");
      const input = jsonObjectOpt(options, "input") ?? {};
      // Extension tools exist once the session loaded the site's extensions;
      // unknown names take the write lock (extension tools write by default).
      const builtin = findTool(name);
      return withSession(io, options, { lock: builtin ? builtin.mutating : true }, async ({ ctx }) => {
        if (!findTool(name)) usage(`Unknown tool "${name}".`, `\`agentcrm tools list\` lists them (${listAiTools().length} available).`);
        return { tool: name, result: await callTool(ctx, name, input) };
      });
    }
    usage(`Unknown tools action "${action}".`, "Use list or call.");
  },
};

export const mcpCommand: Command = {
  name: "mcp",
  usage: "mcp [--site <alias>] [--read-only] [--as <user>]",
  summary: "Run the MCP server on stdio (JSON-RPC 2.0, protocol 2025-06-18 / 2024-11-05): tools = the AI catalog incl. the site's extension tools (read-only mode hides the ones that write; --safe skips extensions), resources = schema, pipelines, modules, appearance, prompts = pipeline review, follow-up email, lead qualification. For Claude Desktop / Claude Code / Cursor.",
  options: [SITE_OPTION, AS_OPTION, { name: "read-only", type: "boolean", description: "Expose only the tools that don't write." }],
  async run({ options }) {
    const readOnly = boolOpt(options, "read-only");
    const session = await openSession(strOpt(options, "site"), { as: strOpt(options, "as"), safe: options.safe === true });
    const log = (msg: string) => process.stderr.write(`${msg}\n`);
    for (const w of session.warnings) log(`[agentcrm mcp] note: ${w}`);
    const { listAiTools } = await import("../../src/ai/tools");
    const { createMcpServer, serveStdio } = await import("../mcp/server");
    let lastRefresh = Date.now();
    const server = createMcpServer({
      readOnly,
      // Built-ins + the tools of the site's loaded extensions, live.
      tools: () => listAiTools(),
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
            // Extensions installed / enabled / upgraded elsewhere.
            const report = await session.extensions.sync();
            for (const f of report?.failed ?? []) log(`[agentcrm mcp] extension ${f.id} failed to load: ${f.error}`);
          }
          return session.ctx;
        },
        async withWrite(fn) {
          const unlock = lockSite(session.site.alias);
          try {
            const result = await fn();
            // A write may have enabled / disabled a module or extension
            // (set_module_enabled, set_extension_enabled): reload the
            // extensions so the next tools/list matches.
            const report = await session.extensions.sync();
            for (const f of report?.failed ?? []) log(`[agentcrm mcp] extension ${f.id} failed to load: ${f.error}`);
            return result;
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
