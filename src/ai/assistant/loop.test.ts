import { beforeEach, describe, expect, it } from "vitest";
import { setupTestCrm, type TestCrm } from "../../ops/testing";
import { recordsOf } from "../../ops/store";
import { AI_TOOLS } from "../tools";
import { appendUserContent, MAX_ITERATIONS_MESSAGE, REJECTED_MESSAGE, repairConversation, runAssistantLoop, stringifyToolResult, type ApprovalRequest, type LoopEvent } from "./loop";
import { mockFetch, sseResponse, textTurn, toolTurn } from "./testUtils";
import type { ApiMessage, ToolResultBlock } from "./types";

let crm: TestCrm;
beforeEach(async () => {
  crm = await setupTestCrm({ demo: true });
});

const base = { apiKey: "sk-test", model: "claude-sonnet-5-5", maxTokens: 512, system: "sys" };
const userTurn = (text: string): ApiMessage[] => [{ role: "user", content: text }];

function toolResults(m: ApiMessage | undefined): ToolResultBlock[] {
  if (!m || m.role !== "user" || typeof m.content === "string") return [];
  return m.content.filter((b): b is ToolResultBlock => b.type === "tool_result");
}

describe("runAssistantLoop", () => {
  it("text-only answer", async () => {
    const m = mockFetch([() => sseResponse(textTurn("Hello there"))]);
    const events: LoopEvent[] = [];
    const r = await runAssistantLoop({ ...base, ctx: crm.admin, messages: userTurn("hi"), fetch: m.fetch, onEvent: (e) => events.push(e) });
    expect(r.status).toBe("done");
    expect(r.stopReason).toBe("end_turn");
    expect(r.iterations).toBe(1);
    expect(r.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "Hello there" }] },
    ]);
    expect(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toBe("Hello there");
    expect(events.at(-1)).toMatchObject({ type: "done", status: "done" });
    // Live tool catalog is sent.
    expect((m.requests[0]!.body.tools as { name: string }[]).map((t) => t.name)).toEqual(AI_TOOLS.map((t) => t.name));
    expect(m.requests[0]!.body.system).toBe("sys");
  });

  it("tool_use → tool_result → final answer (read-only tool, no approval)", async () => {
    const m = mockFetch([() => sseResponse(toolTurn([{ id: "tu_1", name: "describe_schema", input: { object: "companies" } }], "Checking.")), () => sseResponse(textTurn("Companies have a name."))]);
    let asked = 0;
    const events: LoopEvent[] = [];
    const r = await runAssistantLoop({ ...base, ctx: crm.admin, messages: userTurn("fields?"), fetch: m.fetch, requestApproval: async () => (asked++, "approve"), onEvent: (e) => events.push(e) });
    expect(r.status).toBe("done");
    expect(asked).toBe(0);
    expect(r.messages).toHaveLength(4);
    const results = toolResults(r.messages[2]);
    expect(results).toHaveLength(1);
    expect(results[0]!.tool_use_id).toBe("tu_1");
    expect(results[0]!.is_error).toBeUndefined();
    expect(JSON.parse(results[0]!.content)[0].id).toBe("companies");
    // Second request carries the tool result.
    const sent = m.requests[1]!.body.messages as ApiMessage[];
    expect(sent).toHaveLength(3);
    expect(toolResults(sent[2])[0]!.tool_use_id).toBe("tu_1");
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["tool_start", "tool_end"]));
  });

  it("mutating tool: approve runs it", async () => {
    const before = recordsOf(crm.store, "companies").length;
    const m = mockFetch([() => sseResponse(toolTurn([{ id: "tu_c", name: "create_record", input: { object: "companies", fields: { name: "Zeta Corp" } } }])), () => sseResponse(textTurn("Created."))]);
    const asked: ApprovalRequest[] = [];
    const r = await runAssistantLoop({ ...base, ctx: crm.admin, messages: userTurn("create Zeta"), fetch: m.fetch, requestApproval: async (req) => (asked.push(req), "approve") });
    expect(r.status).toBe("done");
    expect(asked).toEqual([{ id: "tu_c", toolName: "create_record", input: { object: "companies", fields: { name: "Zeta Corp" } } }]);
    expect(recordsOf(crm.store, "companies").length).toBe(before + 1);
    expect(toolResults(r.messages[2])[0]!.is_error).toBeUndefined();
  });

  it("mutating tool: reject → is_error tool_result, nothing written", async () => {
    const before = recordsOf(crm.store, "companies").length;
    const m = mockFetch([() => sseResponse(toolTurn([{ id: "tu_c", name: "create_record", input: { object: "companies", fields: { name: "Nope" } } }])), () => sseResponse(textTurn("OK, not created."))]);
    const r = await runAssistantLoop({ ...base, ctx: crm.admin, messages: userTurn("create"), fetch: m.fetch, requestApproval: async () => "reject" });
    expect(recordsOf(crm.store, "companies").length).toBe(before);
    expect(toolResults(r.messages[2])[0]).toEqual({ type: "tool_result", tool_use_id: "tu_c", content: REJECTED_MESSAGE, is_error: true });
  });

  it("mutating tool: always → not asked again for that tool", async () => {
    const m = mockFetch([
      () => sseResponse(toolTurn([{ id: "a1", name: "create_record", input: { object: "companies", fields: { name: "One" } } }])),
      () => sseResponse(toolTurn([{ id: "a2", name: "create_record", input: { object: "companies", fields: { name: "Two" } } }])),
      () => sseResponse(textTurn("Done.")),
    ]);
    const session = new Set<string>();
    let asked = 0;
    const r = await runAssistantLoop({ ...base, ctx: crm.admin, messages: userTurn("create two"), fetch: m.fetch, autoApproved: session, requestApproval: async () => (asked++, "always") });
    expect(r.status).toBe("done");
    expect(asked).toBe(1);
    expect(session.has("create_record")).toBe(true);
    const names = recordsOf(crm.store, "companies").map((c) => c.fields.name);
    expect(names).toEqual(expect.arrayContaining(["One", "Two"]));
  });

  it("no approval callback → mutating tools are rejected", async () => {
    const m = mockFetch([() => sseResponse(toolTurn([{ id: "d1", name: "delete_record", input: { id: "x" } }])), () => sseResponse(textTurn("ok"))]);
    const r = await runAssistantLoop({ ...base, ctx: crm.admin, messages: userTurn("delete"), fetch: m.fetch });
    expect(toolResults(r.messages[2])[0]!.content).toBe(REJECTED_MESSAGE);
  });

  it("tool errors become is_error tool_results; roles are enforced", async () => {
    const m = mockFetch([
      () => sseResponse(toolTurn([
        { id: "e1", name: "get_record", input: { id: "does-not-exist" } },
        { id: "e2", name: "no_such_tool", input: {} },
        { id: "e3", name: "create_record", input: { object: "companies", fields: { name: "Viewer" } } },
      ])),
      () => sseResponse(textTurn("Sorry.")),
    ]);
    const r = await runAssistantLoop({ ...base, ctx: crm.as("viewer"), messages: userTurn("x"), fetch: m.fetch, requestApproval: async () => "approve" });
    expect(r.status).toBe("done");
    const results = toolResults(r.messages[2]);
    expect(results.map((x) => x.is_error)).toEqual([true, true, true]);
    expect(results[0]!.content).toMatch(/notFound/);
    expect(results[1]!.content).toMatch(/Unknown tool/);
    expect(results[2]!.content).toMatch(/forbidden/);
  });

  it("stops at the iteration cap with a valid conversation", async () => {
    const turn = () => sseResponse(toolTurn([{ id: `l${Math.random()}`, name: "describe_schema", input: {} }]));
    const m = mockFetch([turn, turn, turn]);
    const events: LoopEvent[] = [];
    const r = await runAssistantLoop({ ...base, ctx: crm.admin, messages: userTurn("loop"), fetch: m.fetch, maxIterations: 3, onEvent: (e) => events.push(e) });
    expect(r.status).toBe("max_iterations");
    expect(r.iterations).toBe(3);
    expect(m.requests).toHaveLength(3);
    expect(toolResults(r.messages.at(-1))[0]!.content).toBe(MAX_ITERATIONS_MESSAGE);
    expect(events.some((e) => e.type === "max_iterations")).toBe(true);
  });

  it("abort while waiting for approval → interrupted results, status aborted", async () => {
    const m = mockFetch([() => sseResponse(toolTurn([{ id: "s1", name: "create_record", input: { object: "companies", fields: { name: "Stop" } } }]))]);
    const c = new AbortController();
    const r = await runAssistantLoop({
      ...base,
      ctx: crm.admin,
      messages: userTurn("x"),
      fetch: m.fetch,
      signal: c.signal,
      requestApproval: () => {
        setTimeout(() => c.abort(), 5);
        return new Promise(() => undefined);
      },
    });
    expect(r.status).toBe("aborted");
    expect(m.requests).toHaveLength(1);
    expect(toolResults(r.messages.at(-1))[0]!.is_error).toBe(true);
    expect(recordsOf(crm.store, "companies").some((x) => x.fields.name === "Stop")).toBe(false);
  });

  it("abort mid-stream drops the partial turn", async () => {
    const c = new AbortController();
    const fetch = async (_url: string, init: RequestInit) => {
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m", usage: {} } })}\n\n`));
          init.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body);
    };
    setTimeout(() => c.abort(), 10);
    const r = await runAssistantLoop({ ...base, ctx: crm.admin, messages: userTurn("x"), fetch, signal: c.signal });
    expect(r.status).toBe("aborted");
    expect(r.messages).toEqual(userTurn("x"));
  });

  it("API errors end the loop with status error", async () => {
    const m = mockFetch([() => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401 })]);
    const events: LoopEvent[] = [];
    const r = await runAssistantLoop({ ...base, ctx: crm.admin, messages: userTurn("x"), fetch: m.fetch, onEvent: (e) => events.push(e) });
    expect(r.status).toBe("error");
    expect(r.error?.message).toMatch(/Invalid API key.*invalid x-api-key/);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });
});

describe("conversation helpers", () => {
  it("truncates huge tool results", () => {
    const s = stringifyToolResult({ big: "x".repeat(30_000) });
    expect(s.length).toBeLessThan(20_200);
    expect(s).toContain("[truncated");
    expect(stringifyToolResult(undefined)).toBe("null");
  });

  it("merges consecutive user turns with tool_results first", () => {
    const msgs = appendUserContent([{ role: "user", content: [{ type: "text", text: "a" }] }], [{ type: "tool_result", tool_use_id: "t", content: "r" }]);
    expect(msgs).toEqual([{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "r" }, { type: "text", text: "a" }] }]);
  });

  it("repairs dangling tool_use blocks", () => {
    const msgs: ApiMessage[] = [
      { role: "user", content: "x" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "describe_schema", input: {} }] },
    ];
    const fixed = repairConversation(msgs);
    expect(fixed).toHaveLength(3);
    expect(toolResults(fixed[2])[0]).toMatchObject({ tool_use_id: "t1", is_error: true });
    expect(repairConversation(fixed)).toEqual(fixed);
  });
});
