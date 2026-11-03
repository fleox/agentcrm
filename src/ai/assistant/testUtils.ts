// Test helpers: build Messages API SSE streams / responses. Not imported
// by production code.

import type { FetchLike } from "./anthropic";

export type StreamEvent = Record<string, unknown> & { type: string };

export function sseText(events: StreamEvent[]): string {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

// A streaming Response whose body is `text` split into chunks of `chunk` bytes.
export function sseResponse(events: StreamEvent[] | string, chunk = 17): Response {
  const bytes = new TextEncoder().encode(typeof events === "string" ? events : sseText(events));
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(i, i + chunk));
      i += chunk;
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

export function textTurn(text: string, stop = "end_turn"): StreamEvent[] {
  const half = Math.ceil(text.length / 2);
  return [
    { type: "message_start", message: { id: "msg_1", model: "claude-test", role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "ping" },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(0, half) } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(half) } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ];
}

export function toolTurn(calls: { id: string; name: string; input: unknown }[], preface = ""): StreamEvent[] {
  const events: StreamEvent[] = [{ type: "message_start", message: { id: "msg_t", model: "claude-test", role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 1 } } }];
  let index = 0;
  if (preface) {
    events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
    events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: preface } });
    events.push({ type: "content_block_stop", index });
    index++;
  }
  for (const c of calls) {
    const json = JSON.stringify(c.input);
    events.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: c.id, name: c.name, input: {} } });
    const third = Math.ceil(json.length / 3);
    for (let p = 0; p < json.length; p += third) events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json.slice(p, p + third) } });
    events.push({ type: "content_block_stop", index });
    index++;
  }
  events.push({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } });
  events.push({ type: "message_stop" });
  return events;
}

export interface MockFetch {
  fetch: FetchLike;
  requests: { url: string; init: RequestInit; body: Record<string, unknown> }[];
}

// Each call returns the next response (factory → fresh body per call).
export function mockFetch(responses: (() => Response | Promise<Response>)[]): MockFetch {
  const requests: MockFetch["requests"] = [];
  let n = 0;
  const fetch: FetchLike = async (url, init) => {
    // Snapshot the body: the loop reuses message arrays.
    requests.push({ url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const make = responses[n++];
    if (!make) throw new Error(`unexpected request #${n}`);
    return make();
  };
  return { fetch, requests };
}
