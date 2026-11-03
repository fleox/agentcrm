// Extension point of the automations engine: actions contributed by
// extension modules (`registerAutomationAction` in the runtime API, or
// `automationActions` of a ModuleDefinition). An automation references
// one as `{ type: "extension", action: "<id>", params }`.
//
// The registry is process-wide (like the AI tool catalog); the loader
// unregisters a module's actions when it is disabled / uninstalled.
// Pure TS: usable from the CLI when it loads extensions.

import type { Automation, CrmRecord, ObjectDef } from "../../core/types";
import type { OpsContext } from "../context";

// A parameter the automation editor renders for the action.
export interface AutomationActionParam {
  id: string;
  label: string; // plain text or i18n key
  type: "text" | "longText" | "number" | "boolean" | "select";
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  // Supports {{field}} placeholders (rendered by the engine before run).
  template?: boolean;
}

export interface AutomationActionRunInput {
  params: Record<string, unknown>;
  record: CrmRecord;
  object: ObjectDef;
  automation: Automation;
  trigger: string;
}

export interface AutomationActionDef {
  // Namespaced id: "<moduleId>.<action>".
  id: string;
  label: string; // plain text or i18n key
  description?: string;
  params?: AutomationActionParam[];
  // Restrict to some objects (default: all).
  objects?: string[];
  // Dry-run description ("Notify when …").
  describe?(input: Pick<AutomationActionRunInput, "params" | "record" | "object">): string;
  // Extra validation; return error messages.
  validate?(params: Record<string, unknown>, object: ObjectDef): string[];
  // Runs with the automation's context (writes through src/ops/). Returns
  // a short result message for the run log.
  run(ctx: OpsContext, input: AutomationActionRunInput): Promise<string | void> | string | void;
}

const ACTION_ID_RE = /^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9_-]*$/;
const actions = new Map<string, AutomationActionDef>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of [...listeners]) l();
}

export function registerAutomationAction(def: AutomationActionDef): () => void {
  if (!def || typeof def.id !== "string" || !ACTION_ID_RE.test(def.id)) {
    throw new Error(`Invalid automation action id "${String(def?.id)}": use "<moduleId>.<action>".`);
  }
  if (typeof def.run !== "function") throw new Error(`Automation action "${def.id}" needs a run() function.`);
  if (actions.has(def.id)) throw new Error(`Automation action "${def.id}" is already registered.`);
  actions.set(def.id, def);
  notify();
  return () => {
    if (actions.get(def.id) === def) {
      actions.delete(def.id);
      notify();
    }
  };
}

export function getAutomationAction(id: string): AutomationActionDef | undefined {
  return actions.get(id);
}

export function listAutomationActions(): AutomationActionDef[] {
  return [...actions.values()];
}

export function subscribeAutomationActions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Tests only.
export function resetAutomationActions(): void {
  actions.clear();
  notify();
}
