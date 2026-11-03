import type { AiTool } from "../../src/ai/tools";
import type { OpsContext } from "../../src/ops/context";
import { toCliError } from "../output";

// MCP server over stdio, implemented by hand (no SDK): JSON-RPC 2.0, one
// message per line. Tools = listAiTools() (the shared AI catalog, the same
// list the in-admin assistant uses, plus the tools of the site's loaded
// extension modules); resources = schema, pipelines, modules, appearance;
// prompts = sales workflows that drive those tools.

export const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const LATEST_PROTOCOL = SUPPORTED_PROTOCOLS[0];

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const RPC = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;

// Tools that destroy or overwrite data (MCP destructiveHint).
const DESTRUCTIVE = new Set(["delete_record", "merge_records", "import_csv", "update_record"]);
const IDEMPOTENT = new Set(["update_record", "move_deal_stage", "complete_task"]);

export interface McpBackend {
  // A fresh context for each call (the backend refreshes remote changes).
  context(): Promise<OpsContext>;
  // Runs a mutating call under the site lock.
  withWrite<T>(fn: () => Promise<T>): Promise<T>;
  serverName: string;
  version: string;
  siteLabel: string;
}

export interface McpServerOptions {
  readOnly?: boolean;
  // The catalog, or a function returning it (extension tools come and go).
  tools: AiTool[] | (() => AiTool[]);
  backend: McpBackend;
  log?: (msg: string) => void;
}

interface PromptDef {
  name: string;
  title: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
  render(args: Record<string, string>): string;
}

const PROMPTS: PromptDef[] = [
  {
    name: "pipeline_review",
    title: "Pipeline review",
    description: "Review the sales pipeline: totals by stage, forecast, stale deals and the next best action per deal.",
    arguments: [
      { name: "pipelineId", description: "Pipeline id (default: the main one).", required: false },
      { name: "ownerId", description: "Only this owner's deals.", required: false },
    ],
    render: (a) =>
      [
        "Review my sales pipeline in the CRM.",
        `1. Call pipeline_summary${a.pipelineId || a.ownerId ? ` with ${JSON.stringify({ ...(a.pipelineId ? { pipelineId: a.pipelineId } : {}), ...(a.ownerId ? { ownerId: a.ownerId } : {}) })}` : ""} for totals per stage and the weighted forecast.`,
        '2. Call run_report with { "name": "staleDeals" } to find open deals without recent activity.',
        "3. For the 5 largest open deals, call get_record (and list_activities) to read their latest activity and open tasks.",
        "4. Answer with: a short summary (open amount, weighted amount, what changed), a table of deals at risk (stale, close date passed, no next step), and ONE concrete next best action per deal (call, email, meeting, update the close date…).",
        "Do not change anything in the CRM unless I confirm; offer to create the follow-up tasks with create_task.",
      ].join("\n"),
  },
  {
    name: "follow_up_email",
    title: "Follow-up email draft",
    description: "Draft a follow-up email for a person, company or deal from its CRM timeline.",
    arguments: [
      { name: "recordId", description: "Record id (person, company or deal).", required: true },
      { name: "goal", description: "What the email should achieve (e.g. book a demo, send the proposal).", required: false },
      { name: "tone", description: "Tone (default: friendly and concise).", required: false },
    ],
    render: (a) =>
      [
        `Draft a follow-up email for CRM record ${a.recordId}.`,
        `1. Call get_record with { "id": "${a.recordId}" } and list_activities with { "recordId": "${a.recordId}", "includeRelated": true } to learn who they are, what was discussed and what is pending.`,
        `2. Write the email${a.goal ? ` with this goal: ${a.goal}` : " that moves the relationship to its next step"}, tone: ${a.tone || "friendly, concise, specific"}. Reference concrete facts from the timeline; never invent facts, prices or commitments.`,
        "3. Show me the subject and body. Only after I approve, offer to log it with log_activity (type email) and to create a follow-up task with create_task.",
      ].join("\n"),
  },
  {
    name: "lead_qualification",
    title: "Lead qualification",
    description: "Qualify a lead (BANT-style) from the CRM data and suggest the lifecycle stage and next step.",
    arguments: [{ name: "recordId", description: "Person or company record id.", required: true }],
    render: (a) =>
      [
        `Qualify the lead ${a.recordId}.`,
        `1. Call describe_schema (object "people") to learn the lifecycle stages, then get_record with { "id": "${a.recordId}" } and list_activities for its history.`,
        "2. Assess Budget, Authority, Need and Timing from what the CRM knows; list what is unknown and the questions to ask.",
        "3. Recommend a lifecycleStage (subscriber, lead, mql, sql, opportunity…) with a one-line justification, a fit score from 1 to 5 and the next best action.",
        "4. Only after I confirm: update_record with the new lifecycleStage and add_note with the qualification summary.",
      ].join("\n"),
  },
];

const RESOURCES = [
  { uri: "agentcrm://schema", name: "schema", title: "CRM data model", description: "Objects, fields (ids, types, select options, relations) and pipelines.", mimeType: "application/json" },
  { uri: "agentcrm://pipelines", name: "pipelines", title: "Pipelines", description: "Pipelines with stages, probabilities and the current forecast.", mimeType: "application/json" },
  { uri: "agentcrm://modules", name: "modules", title: "Modules", description: "Workspace modules (built-in and extensions) with enabled / required state and dependencies, plus the installed extensions.", mimeType: "application/json" },
  { uri: "agentcrm://appearance", name: "appearance", title: "Appearance", description: "The effective workspace appearance (accent, neutral, radius, density, font, sidebar, mode, theme) and the available presets / themes.", mimeType: "application/json" },
];

function toolAnnotations(tool: AiTool) {
  return {
    title: tool.name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
    readOnlyHint: !tool.mutating,
    destructiveHint: tool.mutating && DESTRUCTIVE.has(tool.name),
    idempotentHint: !tool.mutating || IDEMPOTENT.has(tool.name),
    openWorldHint: false,
  };
}

export function createMcpServer(opts: McpServerOptions) {
  const all = (): AiTool[] => (typeof opts.tools === "function" ? opts.tools() : opts.tools);
  const visible = (): AiTool[] => all().filter((t) => !(opts.readOnly && t.mutating));
  let initialized = false;
  let protocol: string = LATEST_PROTOCOL;

  const ok = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
  const fail = (id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } });

  async function callTool(id: JsonRpcId, params: Record<string, unknown>): Promise<JsonRpcResponse> {
    const name = typeof params.name === "string" ? params.name : "";
    const tool = all().find((t) => t.name === name);
    if (!tool) return fail(id, RPC.invalidParams, `Unknown tool: ${name}`);
    if (opts.readOnly && tool.mutating) return fail(id, RPC.invalidParams, `Tool ${name} changes data and this server is read-only.`);
    const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
    try {
      const run = async () => {
        const ctx = await opts.backend.context();
        const { callTool: call } = await import("../../src/ai/tools");
        return call(ctx, name, args);
      };
      const result = tool.mutating ? await opts.backend.withWrite(run) : await run();
      const structured = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : { result: result ?? null };
      return ok(id, { content: [{ type: "text", text: JSON.stringify(result ?? null, null, 2) }], structuredContent: structured, isError: false });
    } catch (err) {
      // Tool failures are results (the model reads them), not protocol errors.
      const e = toCliError(err);
      const error = { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) };
      return ok(id, { content: [{ type: "text", text: JSON.stringify({ error }) }], structuredContent: { error }, isError: true });
    }
  }

  async function readResource(id: JsonRpcId, uri: string): Promise<JsonRpcResponse> {
    const ctx = await opts.backend.context();
    let value: unknown;
    if (uri === "agentcrm://schema") value = (await import("../../src/ops/schema")).describeSchema(ctx);
    else if (uri === "agentcrm://pipelines") {
      const { listPipelines, forecast } = await import("../../src/ops/pipelines");
      value = listPipelines(ctx).map((p) => ({ ...p, forecast: forecast(ctx, { pipelineId: p.id }) }));
    } else if (uri === "agentcrm://modules") {
      const [{ listModules }, { listExtensions }] = await Promise.all([import("../../src/ops/modules"), import("../../src/ops/extensions")]);
      value = { modules: listModules(ctx), extensions: listExtensions(ctx) };
    } else if (uri === "agentcrm://appearance") {
      const { getAppearance, listPresets } = await import("../../src/ops/appearance");
      const { logo, favicon, customCss, ...rest } = getAppearance(ctx);
      value = { appearance: { ...rest, hasLogo: !!logo, hasFavicon: !!favicon, customCss: customCss ?? null }, presets: listPresets(ctx).map((p) => ({ id: p.id, name: p.name, source: p.source, description: p.description, ...(p.enabled !== undefined ? { enabled: p.enabled } : {}) })) };
    } else return fail(id, -32002, `Resource not found: ${uri}`, { uri });
    return ok(id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value, null, 2) }] });
  }

  async function handle(msg: unknown): Promise<JsonRpcResponse | null> {
    if (!msg || typeof msg !== "object" || (msg as JsonRpcRequest).jsonrpc !== "2.0" || typeof (msg as JsonRpcRequest).method !== "string") {
      const id = msg && typeof msg === "object" && "id" in msg ? ((msg as { id: JsonRpcId }).id ?? null) : null;
      return fail(id, RPC.invalidRequest, "Invalid JSON-RPC 2.0 request.");
    }
    const req = msg as JsonRpcRequest;
    const isNotification = !("id" in req) || req.id === undefined;
    const id = req.id ?? null;
    const params = req.params ?? {};
    if (isNotification) {
      if (req.method === "notifications/initialized") initialized = true;
      return null;
    }
    try {
      switch (req.method) {
        case "initialize": {
          const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : LATEST_PROTOCOL;
          protocol = (SUPPORTED_PROTOCOLS as readonly string[]).includes(requested) ? requested : LATEST_PROTOCOL;
          return ok(id, {
            protocolVersion: protocol,
            capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false }, prompts: { listChanged: false }, logging: {} },
            serverInfo: { name: opts.backend.serverName, title: "AgentCRM", version: opts.backend.version },
            instructions: `AgentCRM (${opts.backend.siteLabel})${opts.readOnly ? " — READ-ONLY" : ""}. Call describe_schema first to learn object and field ids. Search before creating to avoid duplicates. Mutating tools change the user's CRM: confirm destructive actions (delete, merge, import with confirm: true) with the user first.`,
          });
        }
        case "ping":
          return ok(id, {});
        case "tools/list":
          return ok(id, {
            tools: visible().map((t) => ({ name: t.name, title: toolAnnotations(t).title, description: t.description, inputSchema: t.inputSchema, annotations: toolAnnotations(t) })),
          });
        case "tools/call":
          return callTool(id, params);
        case "resources/list":
          return ok(id, { resources: RESOURCES });
        case "resources/templates/list":
          return ok(id, { resourceTemplates: [] });
        case "resources/read":
          return readResource(id, typeof params.uri === "string" ? params.uri : "");
        case "prompts/list":
          return ok(id, { prompts: PROMPTS.map(({ render: _render, ...p }) => p) });
        case "prompts/get": {
          const prompt = PROMPTS.find((p) => p.name === params.name);
          if (!prompt) return fail(id, RPC.invalidParams, `Unknown prompt: ${String(params.name)}`);
          const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, string>;
          const missing = prompt.arguments.filter((a) => a.required && !args[a.name]);
          if (missing.length) return fail(id, RPC.invalidParams, `Missing argument(s): ${missing.map((a) => a.name).join(", ")}`);
          return ok(id, { description: prompt.description, messages: [{ role: "user", content: { type: "text", text: prompt.render(args) } }] });
        }
        case "logging/setLevel":
          return ok(id, {});
        default:
          return fail(id, RPC.methodNotFound, `Method not found: ${req.method}`);
      }
    } catch (err) {
      return fail(id, RPC.internal, (err as Error).message);
    }
  }

  return {
    handle,
    get initialized() {
      return initialized;
    },
    get protocol() {
      return protocol;
    },
    toolNames: () => visible().map((t) => t.name),
  };
}

export type McpServer = ReturnType<typeof createMcpServer>;

// Line-delimited JSON-RPC over a pair of streams (stdin / stdout). Batches
// (arrays) are answered with an array. Resolves when the input ends.
export function serveStdio(server: McpServer, input: NodeJS.ReadableStream, write: (line: string) => void, log: (msg: string) => void = () => undefined): Promise<void> {
  return new Promise((resolve) => {
    let buffer = "";
    let chain = Promise.resolve();
    const processLine = async (line: string) => {
      if (!line.trim()) return;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: RPC.parse, message: "Parse error" } }));
        return;
      }
      if (Array.isArray(msg)) {
        const out = (await Promise.all(msg.map((m) => server.handle(m)))).filter((r): r is JsonRpcResponse => r !== null);
        if (out.length) write(JSON.stringify(out));
        return;
      }
      const res = await server.handle(msg);
      if (res) write(JSON.stringify(res));
    };
    input.setEncoding?.("utf8");
    input.on("data", (chunk: string | Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        // Requests are handled in order (writes never interleave).
        chain = chain.then(() => processLine(line)).catch((err) => log(`[mcp] ${(err as Error).message}`));
      }
    });
    input.on("end", () => {
      const rest = buffer;
      buffer = "";
      chain = chain.then(() => processLine(rest)).finally(() => resolve());
    });
  });
}
