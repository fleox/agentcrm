// Server-sent events parsing + assembly of a streamed Messages API turn.
//
//   createSseParser()   bytes/text chunks (split anywhere) → { event, data } frames
//   createTurnAssembler() Messages stream events → content blocks, stop reason, usage
//
// Both are incremental and pure so they can be unit-tested with chunks
// split at arbitrary boundaries.

import type { AssistantContentBlock, AssistantTurn, StopReason, ToolUseBlock, Usage } from "./types";

export interface SseFrame {
  event: string;
  data: string;
}

export interface SseParser {
  // Feed decoded text; returns the frames completed by this chunk.
  push(text: string): SseFrame[];
  // End of stream: flush a trailing frame without blank line.
  end(): SseFrame[];
}

export function createSseParser(): SseParser {
  let buffer = "";
  let event = "";
  let data: string[] = [];

  const dispatch = (out: SseFrame[]) => {
    if (data.length > 0 || event) out.push({ event: event || "message", data: data.join("\n") });
    event = "";
    data = [];
  };

  const line = (raw: string, out: SseFrame[]) => {
    if (raw === "") return dispatch(out);
    if (raw.startsWith(":")) return; // comment
    const i = raw.indexOf(":");
    const field = i === -1 ? raw : raw.slice(0, i);
    let value = i === -1 ? "" : raw.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  };

  const drain = (final: boolean): SseFrame[] => {
    const out: SseFrame[] = [];
    for (;;) {
      const m = /\r\n|\r|\n/.exec(buffer);
      if (!m) break;
      // A lone "\r" at the very end may be the first half of "\r\n".
      if (m[0] === "\r" && m.index === buffer.length - 1 && !final) break;
      line(buffer.slice(0, m.index), out);
      buffer = buffer.slice(m.index + m[0].length);
    }
    if (final) {
      if (buffer) line(buffer, out);
      buffer = "";
      dispatch(out);
    }
    return out;
  };

  return {
    push(text) {
      buffer += text;
      return drain(false);
    },
    end() {
      return drain(true);
    },
  };
}

// ─── Turn assembly ──────────────────────────────────────────────────────

export interface StreamApiError {
  type: string;
  message: string;
}

export interface AssemblerCallbacks {
  onText?(delta: string, index: number): void;
  // A tool_use block is complete (input JSON parsed).
  onToolUse?(block: ToolUseBlock): void;
}

export interface TurnAssembler {
  // Handle one parsed stream event (the `data` JSON of a frame).
  handle(event: Record<string, unknown>): void;
  // An `error` event was received (the stream must be aborted).
  readonly error: StreamApiError | null;
  readonly done: boolean;
  turn(): AssistantTurn;
}

interface Building {
  block: AssistantContentBlock;
  json?: string; // tool_use input being accumulated
}

export function createTurnAssembler(cb: AssemblerCallbacks = {}): TurnAssembler {
  const blocks: Building[] = [];
  let id: string | undefined;
  let model: string | undefined;
  let stopReason: StopReason | null = null;
  let usage: Usage = {};
  let error: StreamApiError | null = null;
  let done = false;

  const finishToolUse = (b: Building) => {
    if (b.block.type !== "tool_use" || b.json === undefined) return;
    const raw = b.json.trim();
    let input: unknown = {};
    if (raw) {
      try {
        input = JSON.parse(raw);
      } catch {
        input = { __invalidJson: raw };
      }
    } else if ((b.block as ToolUseBlock).input && typeof (b.block as ToolUseBlock).input === "object") {
      input = (b.block as ToolUseBlock).input;
    }
    (b.block as ToolUseBlock).input = input;
    b.json = undefined;
    cb.onToolUse?.(b.block as ToolUseBlock);
  };

  return {
    get error() {
      return error;
    },
    get done() {
      return done;
    },
    handle(ev) {
      switch (ev.type) {
        case "message_start": {
          const msg = (ev.message ?? {}) as { id?: string; model?: string; usage?: Usage };
          id = msg.id;
          model = msg.model;
          usage = { ...usage, ...(msg.usage ?? {}) };
          break;
        }
        case "content_block_start": {
          const index = Number(ev.index ?? blocks.length);
          const start = { ...((ev.content_block ?? {}) as AssistantContentBlock) };
          if (start.type === "text") blocks[index] = { block: { type: "text", text: String((start as { text?: string }).text ?? "") } };
          else if (start.type === "tool_use") blocks[index] = { block: { type: "tool_use", id: String(start.id), name: String(start.name), input: start.input ?? {} }, json: "" };
          else blocks[index] = { block: start };
          const initial = start.type === "text" ? String((start as { text?: string }).text ?? "") : "";
          if (initial) cb.onText?.(initial, index);
          break;
        }
        case "content_block_delta": {
          const index = Number(ev.index);
          const b = blocks[index];
          const delta = (ev.delta ?? {}) as { type?: string; text?: string; partial_json?: string; thinking?: string; signature?: string };
          if (!b) break;
          if (delta.type === "text_delta" && b.block.type === "text") {
            (b.block as { text: string }).text += delta.text ?? "";
            if (delta.text) cb.onText?.(delta.text, index);
          } else if (delta.type === "input_json_delta" && b.json !== undefined) {
            b.json += delta.partial_json ?? "";
          } else if (delta.type === "thinking_delta") {
            (b.block as Record<string, unknown>).thinking = String((b.block as Record<string, unknown>).thinking ?? "") + (delta.thinking ?? "");
          } else if (delta.type === "signature_delta") {
            (b.block as Record<string, unknown>).signature = delta.signature;
          }
          break;
        }
        case "content_block_stop": {
          const b = blocks[Number(ev.index)];
          if (b) finishToolUse(b);
          break;
        }
        case "message_delta": {
          const delta = (ev.delta ?? {}) as { stop_reason?: StopReason | null };
          if (delta.stop_reason !== undefined) stopReason = delta.stop_reason;
          usage = { ...usage, ...((ev.usage ?? {}) as Usage) };
          break;
        }
        case "message_stop":
          done = true;
          break;
        case "error": {
          const e = (ev.error ?? {}) as { type?: string; message?: string };
          error = { type: e.type ?? "api_error", message: e.message ?? "Unknown streaming error." };
          break;
        }
        default:
          // ping and unknown future events: ignore.
          break;
      }
    },
    turn() {
      // Close any tool_use left open (truncated stream).
      for (const b of blocks) if (b) finishToolUse(b);
      return { id, model, content: blocks.filter(Boolean).map((b) => b.block), stopReason, usage };
    },
  };
}
