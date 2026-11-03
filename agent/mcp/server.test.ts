import { PassThrough } from "node:stream";
import { AI_TOOLS } from "../../src/ai/tools";
import { setupTestCrm } from "../../src/ops/testing";
import { createMcpServer, serveStdio, type JsonRpcResponse } from "./server";

// MCP over an in-process stdio pair: handshake, tools/list (annotations,
// read-only mode), tools/call (structured result + text, tool errors as
// isError results), resources and prompts.

async function setup(readOnly = false) {
  const crm = await setupTestCrm({ demo: true });
  let writes = 0;
  const server = createMcpServer({
    readOnly,
    tools: AI_TOOLS,
    backend: {
      serverName: "agentcrm",
      version: "0.1.0",
      siteLabel: "test",
      context: async () => crm.admin,
      withWrite: async (fn) => {
        writes++;
        return fn();
      },
    },
  });
  const input = new PassThrough();
  const lines: string[] = [];
  const done = serveStdio(server, input, (l) => void lines.push(l));
  let nextId = 1;
  const pending: Array<() => void> = [];
  const request = async (method: string, params?: unknown): Promise<JsonRpcResponse> => {
    const id = nextId++;
    input.write(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }) + "\n");
    for (let i = 0; i < 200; i++) {
      const hit = lines.map((l) => JSON.parse(l) as JsonRpcResponse).find((r) => r.id === id);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no answer to ${method}`);
  };
  const notify = (method: string) => input.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  void pending;
  return { crm, server, request, notify, lines, close: () => (input.end(), done), writes: () => writes };
}

describe("MCP server", () => {
  it("negotiates the protocol, lists and calls tools", async () => {
    const t = await setup();
    const init = await t.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "agentcrm" }, capabilities: { tools: {}, resources: {}, prompts: {} } });
    t.notify("notifications/initialized");
    const old = await t.request("initialize", { protocolVersion: "2024-11-05" });
    expect((old.result as { protocolVersion: string }).protocolVersion).toBe("2024-11-05");
    const unknown = await t.request("initialize", { protocolVersion: "1999-01-01" });
    expect((unknown.result as { protocolVersion: string }).protocolVersion).toBe("2025-06-18");
    expect((await t.request("ping")).result).toEqual({});

    const list = (await t.request("tools/list")).result as { tools: { name: string; inputSchema: unknown; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }[] };
    expect(list.tools.map((x) => x.name)).toEqual(AI_TOOLS.map((x) => x.name));
    const del = list.tools.find((x) => x.name === "delete_record")!;
    expect(del.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(list.tools.find((x) => x.name === "search_records")!.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });

    const search = (await t.request("tools/call", { name: "search_records", arguments: { query: "Globex" } })).result as { content: { type: string; text: string }[]; structuredContent: unknown; isError: boolean };
    expect(search.isError).toBe(false);
    expect(search.content[0].type).toBe("text");
    expect(JSON.parse(search.content[0].text)).toBeTruthy();
    expect(JSON.stringify(search.structuredContent)).toContain("Globex");

    const created = (await t.request("tools/call", { name: "create_record", arguments: { object: "companies", fields: { name: "MCP Corp" } } })).result as { structuredContent: { label: string } };
    expect(created.structuredContent.label).toBe("MCP Corp");
    expect(t.writes()).toBe(1);

    // Tool failures are results with isError, not protocol errors.
    const bad = (await t.request("tools/call", { name: "get_record", arguments: { id: "nope" } })).result as { isError: boolean; structuredContent: { error: { code: string } } };
    expect(bad).toMatchObject({ isError: true, structuredContent: { error: { code: "notFound" } } });
    expect((await t.request("tools/call", { name: "no_such_tool" })).error?.code).toBe(-32602);
    expect((await t.request("nope/method")).error?.code).toBe(-32601);
    await t.close();
  });

  it("serves resources and prompts", async () => {
    const t = await setup();
    const res = (await t.request("resources/list")).result as { resources: { uri: string }[] };
    expect(res.resources.map((r) => r.uri)).toEqual(["agentcrm://schema", "agentcrm://pipelines"]);
    const schema = (await t.request("resources/read", { uri: "agentcrm://schema" })).result as { contents: { text: string; mimeType: string }[] };
    expect(schema.contents[0].mimeType).toBe("application/json");
    expect(schema.contents[0].text).toContain("companies");
    const pipelines = (await t.request("resources/read", { uri: "agentcrm://pipelines" })).result as { contents: { text: string }[] };
    expect(pipelines.contents[0].text).toContain("forecast");
    expect((await t.request("resources/read", { uri: "agentcrm://nope" })).error?.code).toBe(-32002);

    const prompts = (await t.request("prompts/list")).result as { prompts: { name: string; arguments: unknown[] }[] };
    expect(prompts.prompts.map((p) => p.name)).toEqual(["pipeline_review", "follow_up_email", "lead_qualification"]);
    const p = (await t.request("prompts/get", { name: "follow_up_email", arguments: { recordId: "r1", goal: "book a demo" } })).result as { messages: { role: string; content: { text: string } }[] };
    expect(p.messages[0].role).toBe("user");
    expect(p.messages[0].content.text).toContain("book a demo");
    expect((await t.request("prompts/get", { name: "lead_qualification", arguments: {} })).error?.code).toBe(-32602);
    await t.close();
  });

  it("hides and refuses mutating tools in read-only mode", async () => {
    const t = await setup(true);
    const list = (await t.request("tools/list")).result as { tools: { name: string }[] };
    const names = list.tools.map((x) => x.name);
    expect(names).toContain("search_records");
    expect(names).not.toContain("create_record");
    expect(names.length).toBe(AI_TOOLS.filter((x) => !x.mutating).length);
    expect((await t.request("tools/call", { name: "delete_record", arguments: { id: "x" } })).error?.code).toBe(-32602);
    await t.close();
  });

  it("answers parse errors, invalid requests and batches", async () => {
    const t = await setup();
    const input = new PassThrough();
    const lines: string[] = [];
    const done = serveStdio(t.server, input, (l) => void lines.push(l));
    input.write("{not json\n");
    input.write(JSON.stringify({ id: 9, method: "ping" }) + "\n");
    input.write(JSON.stringify([{ jsonrpc: "2.0", id: 10, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }]) + "\n");
    input.end();
    await done;
    expect(JSON.parse(lines[0]).error.code).toBe(-32700);
    expect(JSON.parse(lines[1]).error.code).toBe(-32600);
    expect(JSON.parse(lines[2])).toEqual([{ jsonrpc: "2.0", id: 10, result: {} }]);
    await t.close();
  });
});
