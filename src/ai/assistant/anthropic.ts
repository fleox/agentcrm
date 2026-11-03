// Direct browser → Anthropic Messages API client (streaming). No server
// of ours: the request goes from the user's browser to api.anthropic.com
// with the user's own key (kept in this browser's localStorage).

import { createSseParser, createTurnAssembler, type AssemblerCallbacks } from "./sse";
import type { ApiMessage, ApiTool, AssistantTurn } from "./types";

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type AnthropicErrorKind =
  | "auth" // 401
  | "permission" // 403
  | "rate_limit" // 429
  | "overloaded" // 529 / overloaded_error
  | "invalid_request" // 400 / 404 / 413
  | "server" // 5xx
  | "network" // fetch failed (offline, CORS, DNS)
  | "aborted" // AbortSignal
  | "api"; // anything else (stream error event…)

export class AnthropicError extends Error {
  constructor(
    readonly kind: AnthropicErrorKind,
    message: string,
    readonly status?: number,
    readonly apiType?: string,
  ) {
    super(message);
    this.name = "AnthropicError";
  }
}

export function isAbortError(err: unknown): boolean {
  return (err instanceof AnthropicError && err.kind === "aborted") || (err instanceof Error && err.name === "AbortError");
}

export interface StreamRequest extends AssemblerCallbacks {
  apiKey: string;
  model: string;
  maxTokens: number;
  system?: string;
  messages: ApiMessage[];
  tools?: ApiTool[];
  signal?: AbortSignal;
  fetch?: FetchLike;
  url?: string;
}

const KIND_BY_STATUS: Record<number, AnthropicErrorKind> = {
  400: "invalid_request",
  401: "auth",
  403: "permission",
  404: "invalid_request",
  413: "invalid_request",
  429: "rate_limit",
  529: "overloaded",
};

const KIND_BY_TYPE: Record<string, AnthropicErrorKind> = {
  authentication_error: "auth",
  permission_error: "permission",
  rate_limit_error: "rate_limit",
  overloaded_error: "overloaded",
  invalid_request_error: "invalid_request",
  not_found_error: "invalid_request",
  request_too_large: "invalid_request",
  api_error: "server",
};

const PREFIX: Record<AnthropicErrorKind, string> = {
  auth: "Invalid API key",
  permission: "This API key is not allowed to use this model or feature",
  rate_limit: "Rate limited by Anthropic, retry in a moment",
  overloaded: "Anthropic's API is overloaded, retry in a moment",
  invalid_request: "Invalid request",
  server: "Anthropic API error",
  network: "Network error",
  aborted: "Stopped",
  api: "Anthropic API error",
};

export function errorFromApi(status: number | undefined, apiType: string | undefined, apiMessage: string | undefined): AnthropicError {
  const kind = (apiType && KIND_BY_TYPE[apiType]) || (status !== undefined ? KIND_BY_STATUS[status] ?? (status >= 500 ? "server" : "api") : "api");
  const detail = apiMessage?.trim();
  const msg = `${PREFIX[kind]}${status ? ` (${status})` : ""}${detail ? `: ${detail}` : "."}`;
  return new AnthropicError(kind, msg, status, apiType);
}

async function errorFromResponse(res: Response): Promise<AnthropicError> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    // Body unreadable.
  }
  let type: string | undefined;
  let message: string | undefined = text.slice(0, 500) || res.statusText;
  try {
    const body = JSON.parse(text) as { error?: { type?: string; message?: string } };
    if (body.error) {
      type = body.error.type;
      message = body.error.message;
    }
  } catch {
    // Not JSON.
  }
  return errorFromApi(res.status, type, message);
}

function abortError(): AnthropicError {
  return new AnthropicError("aborted", "Stopped by the user.");
}

export function buildRequestBody(req: Pick<StreamRequest, "model" | "maxTokens" | "system" | "messages" | "tools">): Record<string, unknown> {
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    ...(req.system ? { system: req.system } : {}),
    messages: req.messages,
    ...(req.tools && req.tools.length ? { tools: req.tools } : {}),
    stream: true,
  };
}

// Sends one Messages API request and streams the assistant turn.
export async function streamMessage(req: StreamRequest): Promise<AssistantTurn> {
  const doFetch: FetchLike = req.fetch ?? ((input, init) => fetch(input, init));
  if (req.signal?.aborted) throw abortError();
  let res: Response;
  try {
    res = await doFetch(req.url ?? ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": req.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
      body: JSON.stringify(buildRequestBody(req)),
      signal: req.signal,
    });
  } catch (err) {
    if (req.signal?.aborted || isAbortError(err)) throw abortError();
    throw new AnthropicError("network", `Network error: could not reach the Anthropic API (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (!res.ok) throw await errorFromResponse(res);
  if (!res.body) throw new AnthropicError("api", "Anthropic API error: empty response body.");

  const parser = createSseParser();
  const assembler = createTurnAssembler({ onText: req.onText, onToolUse: req.onToolUse });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  req.signal?.addEventListener("abort", onAbort);

  const handleFrames = (frames: { event: string; data: string }[]) => {
    for (const f of frames) {
      if (!f.data) continue;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(f.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!ev.type && f.event) ev.type = f.event;
      assembler.handle(ev);
      if (assembler.error) return;
    }
  };

  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (req.signal?.aborted) throw abortError();
        throw new AnthropicError("network", `Network error: the stream was interrupted (${err instanceof Error ? err.message : String(err)}).`);
      }
      if (req.signal?.aborted) throw abortError();
      if (chunk.done) {
        handleFrames(parser.push(decoder.decode()));
        handleFrames(parser.end());
        break;
      }
      handleFrames(parser.push(decoder.decode(chunk.value, { stream: true })));
      if (assembler.error || assembler.done) break;
    }
  } finally {
    req.signal?.removeEventListener("abort", onAbort);
    if (assembler.error || assembler.done) void reader.cancel().catch(() => undefined);
  }

  if (assembler.error) throw errorFromApi(undefined, assembler.error.type, assembler.error.message);
  if (req.signal?.aborted) throw abortError();
  const turn = assembler.turn();
  if (!assembler.done && turn.stopReason === null) throw new AnthropicError("network", "Network error: the stream ended before the answer was complete.");
  return turn;
}

// Minimal request to check a key (and that the model exists).
export async function testApiKey(opts: { apiKey: string; model: string; fetch?: FetchLike; signal?: AbortSignal }): Promise<{ model?: string }> {
  const turn = await streamMessage({ ...opts, maxTokens: 1, messages: [{ role: "user", content: "ping" }] });
  return { model: turn.model };
}
