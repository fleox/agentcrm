// Shell events of the assistant feature (on src/app/shellEvents.ts).
//   "assistant.toggle"           (core) open / close the panel
//   "assistant.ask"              { objectId, recordId, prompt? } open the panel with a record in context
//   "assistant.settingsChanged"  settings saved in Settings → AI assistant
//   "assistant.visibility"       { open } emitted by the panel (top bar button state)
import { emitShellEvent } from "../../app/shellEvents";

export const ASSISTANT_TOGGLE = "assistant.toggle";
export const ASSISTANT_ASK = "assistant.ask";
export const ASSISTANT_SETTINGS_CHANGED = "assistant.settingsChanged";
export const ASSISTANT_VISIBILITY = "assistant.visibility";

export interface AssistantAskDetail {
  objectId: string;
  recordId: string;
  // Optional text pre-filled in the composer.
  prompt?: string;
}

export function askAssistant(detail: AssistantAskDetail): void {
  emitShellEvent(ASSISTANT_ASK, detail);
}

export function parseAskDetail(detail: unknown): AssistantAskDetail | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  if (typeof d.objectId !== "string" || typeof d.recordId !== "string") return null;
  return { objectId: d.objectId, recordId: d.recordId, ...(typeof d.prompt === "string" ? { prompt: d.prompt } : {}) };
}
