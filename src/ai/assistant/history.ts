// Conversation persistence for the assistant panel: the API messages (what
// is sent back to the model) + the display items (what the panel shows),
// kept in sessionStorage (this tab only, cleared when it closes).

import { repairConversation } from "./loop";
import type { ApiMessage } from "./types";

export const ASSISTANT_HISTORY_KEY = "agentcrm.assistant.conversation";
const VERSION = 1;
// Keep the stored conversation bounded (sessionStorage is ~5 MB).
const MAX_STORED_CHARS = 1_500_000;

export type ToolItemStatus = "pending" | "running" | "done" | "error" | "rejected";

export type DisplayItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; streaming?: boolean }
  | { kind: "tool"; id: string; name: string; input: unknown; status: ToolItemStatus; result?: string; mutating?: boolean }
  | { kind: "error"; id: string; message: string }
  | { kind: "notice"; id: string; text: string };

export interface StoredConversation {
  messages: ApiMessage[];
  items: DisplayItem[];
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

export function emptyConversation(): StoredConversation {
  return { messages: [], items: [] };
}

// Settles transient UI states (a reload interrupts streaming / approvals).
export function settleItems(items: DisplayItem[]): DisplayItem[] {
  return items.map((it) => {
    if (it.kind === "assistant" && it.streaming) return { ...it, streaming: false };
    if (it.kind === "tool" && (it.status === "pending" || it.status === "running")) return { ...it, status: "error", result: it.result ?? "Interrupted." };
    return it;
  });
}

export function loadConversation(storage: KeyValueStorage | null = defaultStorage()): StoredConversation {
  try {
    const raw = storage?.getItem(ASSISTANT_HISTORY_KEY);
    if (!raw) return emptyConversation();
    const parsed = JSON.parse(raw) as { v?: number; messages?: unknown; items?: unknown };
    if (parsed.v !== VERSION || !Array.isArray(parsed.messages) || !Array.isArray(parsed.items)) return emptyConversation();
    return { messages: repairConversation(parsed.messages as ApiMessage[]), items: settleItems(parsed.items as DisplayItem[]) };
  } catch {
    return emptyConversation();
  }
}

export function saveConversation(conv: StoredConversation, storage: KeyValueStorage | null = defaultStorage()): void {
  try {
    let messages = conv.messages;
    let items = conv.items;
    let raw = JSON.stringify({ v: VERSION, messages, items });
    // Drop the oldest exchanges until it fits (keep alternation: cut at a
    // plain-text user turn).
    while (raw.length > MAX_STORED_CHARS && messages.length > 2) {
      const cut = messages.findIndex((m, i) => i > 0 && m.role === "user" && typeof m.content === "string");
      if (cut <= 0) break;
      messages = messages.slice(cut);
      const itemCut = items.findIndex((it, i) => i > 0 && it.kind === "user");
      if (itemCut > 0) items = items.slice(itemCut);
      raw = JSON.stringify({ v: VERSION, messages, items });
    }
    storage?.setItem(ASSISTANT_HISTORY_KEY, raw);
  } catch {
    // Quota / blocked storage: the conversation lives in memory only.
  }
}

export function clearConversation(storage: KeyValueStorage | null = defaultStorage()): void {
  try {
    storage?.removeItem(ASSISTANT_HISTORY_KEY);
  } catch {
    // Ignore.
  }
}
