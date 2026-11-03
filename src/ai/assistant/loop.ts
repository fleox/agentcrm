// The assistant's tool-use loop:
//   send conversation → stream the assistant turn → if it asks for tools,
//   (ask approval for mutating ones) run them through callTool() with the
//   signed-in user's OpsContext → send tool_results → repeat until the
//   model ends its turn or the iteration cap is hit.
//
// UI-agnostic: progress goes through `onEvent`, approvals through
// `requestApproval`. Never throws for API / tool errors — the outcome is in
// the returned `status` and the conversation stays valid for the next turn
// (every tool_use always gets a tool_result).

import type { OpsContext } from "../../ops/context";
import { listAiTools, callTool as defaultCallTool, findTool, type AiTool } from "../tools";
import { AnthropicError, isAbortError, streamMessage, type FetchLike } from "./anthropic";
import { toApiTools } from "./tools";
import type { ApiMessage, AssistantContentBlock, StopReason, ToolResultBlock, ToolUseBlock, Usage, UserContentBlock } from "./types";
import { isToolUse } from "./types";

export const DEFAULT_MAX_ITERATIONS = 12;
export const MAX_TOOL_RESULT_CHARS = 20_000;

export const REJECTED_MESSAGE = "User rejected this action.";
export const INTERRUPTED_MESSAGE = "Interrupted: the user stopped the assistant before this tool ran.";
export const NOT_RUN_MESSAGE = "Not executed: the response was cut off before the tool call was complete.";
export const MAX_ITERATIONS_MESSAGE = "Not executed: the maximum number of tool iterations for one request was reached.";

export type ApprovalDecision = "approve" | "reject" | "always";

export interface ApprovalRequest {
  id: string;
  toolName: string;
  input: unknown;
}

export type LoopEvent =
  | { type: "request"; iteration: number }
  | { type: "text"; iteration: number; delta: string }
  | { type: "assistant_message"; iteration: number; content: AssistantContentBlock[]; stopReason: StopReason | null; usage: Usage }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "approval_pending"; id: string; name: string; input: unknown }
  | { type: "approval_resolved"; id: string; name: string; decision: ApprovalDecision }
  | { type: "tool_end"; id: string; name: string; isError: boolean; result: string; rejected?: boolean }
  | { type: "max_iterations"; iterations: number }
  | { type: "error"; error: AnthropicError | Error }
  | { type: "done"; status: LoopStatus; stopReason: StopReason | null };

export type LoopStatus = "done" | "aborted" | "error" | "max_iterations";

export interface LoopOptions {
  ctx: OpsContext;
  apiKey: string;
  model: string;
  maxTokens: number;
  system?: string;
  // Conversation so far, ending with the new user turn. Not mutated.
  messages: ApiMessage[];
  fetch?: FetchLike;
  signal?: AbortSignal;
  maxIterations?: number;
  // Tools allowed without asking (session "always allow"); updated in
  // place when the user picks "always".
  autoApproved?: Set<string>;
  requestApproval?: (req: ApprovalRequest) => Promise<ApprovalDecision>;
  onEvent?: (ev: LoopEvent) => void;
  // Defaults to the live AI_TOOLS catalog / callTool from src/ai/tools.ts.
  tools?: readonly AiTool[];
  callTool?: (ctx: OpsContext, name: string, input: unknown) => Promise<unknown>;
}

export interface LoopResult {
  messages: ApiMessage[];
  status: LoopStatus;
  stopReason: StopReason | null;
  iterations: number;
  usage: Usage;
  error?: AnthropicError | Error;
}

// ─── Helpers ────────────────────────────────────────────────────────────

export function stringifyToolResult(value: unknown, max = MAX_TOOL_RESULT_CHARS): string {
  let s: string;
  if (typeof value === "string") s = value;
  else {
    try {
      s = JSON.stringify(value === undefined ? null : value);
    } catch {
      s = String(value);
    }
  }
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… [truncated ${s.length - max} characters; narrow the request (filters, limit, fields) to see more]`;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? `${code}: ${err.message}` : err.message;
  }
  return String(err);
}

function toolResult(id: string, content: string, isError: boolean): ToolResultBlock {
  return { type: "tool_result", tool_use_id: id, content, ...(isError ? { is_error: true } : {}) };
}

// Appends user content, merging into a trailing user turn (keeps strict
// user/assistant alternation even after an interrupted run).
export function appendUserContent(messages: ApiMessage[], content: string | UserContentBlock[]): ApiMessage[] {
  const blocks: UserContentBlock[] = typeof content === "string" ? [{ type: "text", text: content }] : content;
  const last = messages[messages.length - 1];
  if (last && last.role === "user") {
    const prev: UserContentBlock[] = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
    // tool_result blocks must come first in a user turn.
    const merged = [...prev, ...blocks];
    const ordered = [...merged.filter((b) => b.type === "tool_result"), ...merged.filter((b) => b.type !== "tool_result")];
    return [...messages.slice(0, -1), { role: "user", content: ordered }];
  }
  return [...messages, { role: "user", content: typeof content === "string" ? content : blocks }];
}

// Makes a stored conversation valid again (e.g. the page was reloaded in
// the middle of a tool call): every tool_use gets a tool_result.
export function repairConversation(messages: ApiMessage[], reason = INTERRUPTED_MESSAGE): ApiMessage[] {
  const out: ApiMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    out.push(m);
    if (m.role !== "assistant") continue;
    const uses = m.content.filter(isToolUse);
    if (!uses.length) continue;
    const next = messages[i + 1];
    const answered = new Set(next && next.role === "user" && Array.isArray(next.content) ? next.content.filter((b): b is ToolResultBlock => b.type === "tool_result").map((b) => b.tool_use_id) : []);
    const missing = uses.filter((u) => !answered.has(u.id)).map((u) => toolResult(u.id, reason, true));
    if (!missing.length) continue;
    if (next && next.role === "user") {
      const merged = appendUserContent([next], missing)[0]!;
      out.push(merged);
      i++;
    } else out.push({ role: "user", content: missing });
  }
  return out;
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new AnthropicError("aborted", "Stopped by the user."));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AnthropicError("aborted", "Stopped by the user."));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: (a.input_tokens ?? 0) + (b.input_tokens ?? 0),
    output_tokens: (a.output_tokens ?? 0) + (b.output_tokens ?? 0),
  };
}

// ─── Loop ───────────────────────────────────────────────────────────────

export async function runAssistantLoop(opts: LoopOptions): Promise<LoopResult> {
  const emit = (ev: LoopEvent) => {
    try {
      opts.onEvent?.(ev);
    } catch {
      // A UI listener never breaks the loop.
    }
  };
  const maxIterations = Math.max(1, opts.maxIterations ?? DEFAULT_MAX_ITERATIONS);
  const autoApproved = opts.autoApproved ?? new Set<string>();
  const run = opts.callTool ?? defaultCallTool;
  const lookup = (name: string) => (opts.tools ? opts.tools.find((t) => t.name === name) : findTool(name));

  let messages = repairConversation(opts.messages);
  let iterations = 0;
  let usage: Usage = {};
  let stopReason: StopReason | null = null;

  const finish = (status: LoopStatus, error?: AnthropicError | Error): LoopResult => {
    if (error) emit({ type: "error", error });
    emit({ type: "done", status, stopReason });
    return { messages, status, stopReason, iterations, usage, ...(error ? { error } : {}) };
  };

  while (true) {
    if (opts.signal?.aborted) return finish("aborted");
    iterations++;
    const iteration = iterations;
    emit({ type: "request", iteration });
    let content: AssistantContentBlock[];
    try {
      const turn = await streamMessage({
        apiKey: opts.apiKey,
        model: opts.model,
        maxTokens: opts.maxTokens,
        system: opts.system,
        messages,
        tools: toApiTools(opts.tools ?? listAiTools()),
        signal: opts.signal,
        fetch: opts.fetch,
        onText: (delta) => emit({ type: "text", iteration, delta }),
      });
      content = turn.content;
      stopReason = turn.stopReason;
      usage = addUsage(usage, turn.usage);
      emit({ type: "assistant_message", iteration, content, stopReason, usage: turn.usage });
    } catch (err) {
      if (isAbortError(err) || opts.signal?.aborted) return finish("aborted");
      return finish("error", err instanceof Error ? err : new Error(String(err)));
    }

    // An empty assistant turn can't be sent back; skip it.
    if (content.length) messages = [...messages, { role: "assistant", content }];
    const uses = content.filter(isToolUse);
    if (!uses.length) return finish("done");

    if (stopReason !== "tool_use") {
      messages = appendUserContent(messages, uses.map((u) => toolResult(u.id, NOT_RUN_MESSAGE, true)));
      return finish("done");
    }
    if (iterations >= maxIterations) {
      messages = appendUserContent(messages, uses.map((u) => toolResult(u.id, MAX_ITERATIONS_MESSAGE, true)));
      emit({ type: "max_iterations", iterations });
      return finish("max_iterations");
    }

    const results: ToolResultBlock[] = [];
    let aborted = false;
    for (const use of uses) {
      if (aborted || opts.signal?.aborted) {
        aborted = true;
        results.push(toolResult(use.id, INTERRUPTED_MESSAGE, true));
        emit({ type: "tool_end", id: use.id, name: use.name, isError: true, result: INTERRUPTED_MESSAGE });
        continue;
      }
      const outcome = await runOne(use);
      if (outcome === "aborted") {
        aborted = true;
        results.push(toolResult(use.id, INTERRUPTED_MESSAGE, true));
        emit({ type: "tool_end", id: use.id, name: use.name, isError: true, result: INTERRUPTED_MESSAGE });
      } else results.push(outcome);
    }
    messages = appendUserContent(messages, results);
    if (aborted) return finish("aborted");
  }

  async function runOne(use: ToolUseBlock): Promise<ToolResultBlock | "aborted"> {
    const tool = lookup(use.name);
    if (tool?.mutating && !autoApproved.has(use.name)) {
      emit({ type: "approval_pending", id: use.id, name: use.name, input: use.input });
      let decision: ApprovalDecision;
      try {
        decision = opts.requestApproval ? await raceAbort(opts.requestApproval({ id: use.id, toolName: use.name, input: use.input }), opts.signal) : "reject";
      } catch (err) {
        if (isAbortError(err) || opts.signal?.aborted) return "aborted";
        decision = "reject";
      }
      emit({ type: "approval_resolved", id: use.id, name: use.name, decision });
      if (decision === "always") autoApproved.add(use.name);
      if (decision === "reject") {
        emit({ type: "tool_end", id: use.id, name: use.name, isError: true, result: REJECTED_MESSAGE, rejected: true });
        return toolResult(use.id, REJECTED_MESSAGE, true);
      }
    }
    if (opts.signal?.aborted) return "aborted";
    emit({ type: "tool_start", id: use.id, name: use.name, input: use.input });
    try {
      const value = await run(opts.ctx, use.name, use.input);
      const text = stringifyToolResult(value);
      emit({ type: "tool_end", id: use.id, name: use.name, isError: false, result: text });
      return toolResult(use.id, text, false);
    } catch (err) {
      const text = stringifyToolResult(`Error: ${errorMessage(err)}`);
      emit({ type: "tool_end", id: use.id, name: use.name, isError: true, result: text });
      return toolResult(use.id, text, true);
    }
  }
}
