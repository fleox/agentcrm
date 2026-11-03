import { describe, expect, it } from "vitest";
import { createSseParser, createTurnAssembler, type SseFrame } from "./sse";
import { AnthropicError, buildRequestBody, streamMessage, testApiKey } from "./anthropic";
import { mockFetch, sseResponse, sseText, textTurn, toolTurn } from "./testUtils";

function parseAll(text: string, sizes: number[]): SseFrame[] {
  const p = createSseParser();
  const out: SseFrame[] = [];
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const size = sizes[k++ % sizes.length]!;
    out.push(...p.push(text.slice(i, i + size)));
    i += size;
  }
  out.push(...p.end());
  return out;
}

describe("SSE parser", () => {
  const text = sseText(toolTurn([{ id: "tu_1", name: "search_records", input: { query: "Acme \"Corp\"", limit: 5 } }], "Let me look."));

  it("yields the same frames whatever the chunk boundaries", () => {
    const whole = parseAll(text, [text.length]);
    expect(whole.length).toBeGreaterThan(5);
    for (const sizes of [[1], [2, 7], [3, 1, 13], [64]]) expect(parseAll(text, sizes)).toEqual(whole);
    expect(whole[0]!.event).toBe("message_start");
  });

  it("handles CRLF, comments, multi-line data and a trailing frame without blank line", () => {
    const frames = parseAll(": keepalive\r\nevent: a\r\ndata: one\r\ndata: two\r\n\r\nevent: b\ndata: x", [1]);
    expect(frames).toEqual([
      { event: "a", data: "one\ntwo" },
      { event: "b", data: "x" },
    ]);
  });
});

describe("turn assembler", () => {
  it("assembles text deltas and input_json_delta into blocks", () => {
    const texts: string[] = [];
    const tools: string[] = [];
    const a = createTurnAssembler({ onText: (d) => texts.push(d), onToolUse: (b) => tools.push(b.name) });
    for (const f of parseAll(sseText(toolTurn([{ id: "tu_1", name: "create_record", input: { object: "companies", fields: { name: "Ünïcode ✓" } } }], "Sure.")), [5])) a.handle(JSON.parse(f.data));
    const turn = a.turn();
    expect(a.done).toBe(true);
    expect(turn.stopReason).toBe("tool_use");
    expect(turn.content).toEqual([
      { type: "text", text: "Sure." },
      { type: "tool_use", id: "tu_1", name: "create_record", input: { object: "companies", fields: { name: "Ünïcode ✓" } } },
    ]);
    expect(texts.join("")).toBe("Sure.");
    expect(tools).toEqual(["create_record"]);
    expect(turn.usage.output_tokens).toBe(20);
  });

  it("records stream error events", () => {
    const a = createTurnAssembler();
    a.handle({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
    expect(a.error).toEqual({ type: "overloaded_error", message: "Overloaded" });
  });
});

describe("streamMessage", () => {
  it("sends the documented headers and body, streams text split mid-UTF-8", async () => {
    const m = mockFetch([() => sseResponse(textTurn("Héllo wörld ✓"), 3)]);
    const deltas: string[] = [];
    const turn = await streamMessage({ apiKey: "sk-test", model: "claude-sonnet-5-5", maxTokens: 100, system: "sys", messages: [{ role: "user", content: "hi" }], tools: [{ name: "t", description: "d", input_schema: { type: "object" } }], fetch: m.fetch, onText: (d) => deltas.push(d) });
    expect(turn.content).toEqual([{ type: "text", text: "Héllo wörld ✓" }]);
    expect(deltas.join("")).toBe("Héllo wörld ✓");
    const req = m.requests[0]!;
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.init.headers).toMatchObject({ "x-api-key": "sk-test", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true", "content-type": "application/json" });
    expect(req.body).toEqual({ model: "claude-sonnet-5-5", max_tokens: 100, system: "sys", messages: [{ role: "user", content: "hi" }], tools: [{ name: "t", description: "d", input_schema: { type: "object" } }], stream: true });
  });

  it("omits empty system and tools", () => {
    expect(buildRequestBody({ model: "m", maxTokens: 1, messages: [] })).toEqual({ model: "m", max_tokens: 1, messages: [], stream: true });
  });

  it.each([
    [401, "authentication_error", "invalid x-api-key", "auth"],
    [403, "permission_error", "no access", "permission"],
    [429, "rate_limit_error", "slow down", "rate_limit"],
    [529, "overloaded_error", "Overloaded", "overloaded"],
    [400, "invalid_request_error", "bad model", "invalid_request"],
  ])("maps HTTP %s to a clear error with the API message", async (status, type, message, kind) => {
    const m = mockFetch([() => new Response(JSON.stringify({ type: "error", error: { type, message } }), { status })]);
    const err = await streamMessage({ apiKey: "k", model: "m", maxTokens: 1, messages: [], fetch: m.fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnthropicError);
    expect((err as AnthropicError).kind).toBe(kind);
    expect((err as AnthropicError).status).toBe(status);
    expect((err as AnthropicError).message).toContain(message);
  });

  it("reports network failures and stream error events", async () => {
    const net = await streamMessage({ apiKey: "k", model: "m", maxTokens: 1, messages: [], fetch: () => Promise.reject(new TypeError("Failed to fetch")) }).catch((e: unknown) => e);
    expect((net as AnthropicError).kind).toBe("network");
    expect((net as AnthropicError).message).toContain("Failed to fetch");

    const events = [...textTurn("partial").slice(0, 3), { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }];
    const m = mockFetch([() => sseResponse(events)]);
    const err = await streamMessage({ apiKey: "k", model: "m", maxTokens: 1, messages: [], fetch: m.fetch }).catch((e: unknown) => e);
    expect((err as AnthropicError).kind).toBe("overloaded");
    expect((err as AnthropicError).message).toContain("Overloaded");
  });

  it("fails on a truncated stream", async () => {
    const m = mockFetch([() => sseResponse(textTurn("abc").slice(0, 4))]);
    const err = await streamMessage({ apiKey: "k", model: "m", maxTokens: 1, messages: [], fetch: m.fetch }).catch((e: unknown) => e);
    expect((err as AnthropicError).kind).toBe("network");
  });

  it("aborts", async () => {
    const c = new AbortController();
    c.abort();
    const err = await streamMessage({ apiKey: "k", model: "m", maxTokens: 1, messages: [], signal: c.signal, fetch: mockFetch([]).fetch }).catch((e: unknown) => e);
    expect((err as AnthropicError).kind).toBe("aborted");
  });

  it("testApiKey sends a 1-token request", async () => {
    const m = mockFetch([() => sseResponse(textTurn("p", "max_tokens"))]);
    await expect(testApiKey({ apiKey: "k", model: "claude-haiku-5-5", fetch: m.fetch })).resolves.toEqual({ model: "claude-test" });
    expect(m.requests[0]!.body.max_tokens).toBe(1);
  });
});
