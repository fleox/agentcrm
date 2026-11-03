// Assistant settings, per browser (localStorage). The API key is a secret
// of this browser only: never written to the data store, config.js or git
// (CLAUDE.md rule 4). Requests go directly from the browser to Anthropic.

export const ASSISTANT_STORAGE_KEYS = {
  apiKey: "agentcrm.assistant.apiKey",
  model: "agentcrm.assistant.model",
  maxTokens: "agentcrm.assistant.maxTokens",
} as const;

export const ASSISTANT_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"] as const;
export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_MAX_TOKENS = 4096;
export const MIN_MAX_TOKENS = 256;
export const MAX_MAX_TOKENS = 64_000;

export interface AssistantSettings {
  apiKey: string;
  model: string;
  maxTokens: number;
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function read(storage: KeyValueStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function clampMaxTokens(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_MAX_TOKENS;
  return Math.min(MAX_MAX_TOKENS, Math.max(MIN_MAX_TOKENS, Math.round(v)));
}

export function loadAssistantSettings(storage: KeyValueStorage | null = defaultStorage()): AssistantSettings {
  const tokens = read(storage, ASSISTANT_STORAGE_KEYS.maxTokens);
  return {
    apiKey: read(storage, ASSISTANT_STORAGE_KEYS.apiKey) ?? "",
    model: read(storage, ASSISTANT_STORAGE_KEYS.model) || DEFAULT_MODEL,
    maxTokens: tokens ? clampMaxTokens(tokens) : DEFAULT_MAX_TOKENS,
  };
}

export function saveAssistantSettings(patch: Partial<AssistantSettings>, storage: KeyValueStorage | null = defaultStorage()): AssistantSettings {
  try {
    if (patch.apiKey !== undefined) {
      const key = patch.apiKey.trim();
      if (key) storage?.setItem(ASSISTANT_STORAGE_KEYS.apiKey, key);
      else storage?.removeItem(ASSISTANT_STORAGE_KEYS.apiKey);
    }
    if (patch.model !== undefined) storage?.setItem(ASSISTANT_STORAGE_KEYS.model, patch.model.trim() || DEFAULT_MODEL);
    if (patch.maxTokens !== undefined) storage?.setItem(ASSISTANT_STORAGE_KEYS.maxTokens, String(clampMaxTokens(patch.maxTokens)));
  } catch {
    // Storage blocked: settings live for this page only.
  }
  return loadAssistantSettings(storage);
}

export function clearAssistantApiKey(storage: KeyValueStorage | null = defaultStorage()): void {
  try {
    storage?.removeItem(ASSISTANT_STORAGE_KEYS.apiKey);
  } catch {
    // Ignore.
  }
}

export function hasApiKey(storage: KeyValueStorage | null = defaultStorage()): boolean {
  return !!loadAssistantSettings(storage).apiKey;
}
