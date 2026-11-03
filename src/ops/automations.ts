// Automations engine — STUB (owned by the automations agent).
//
// Contract:
//   - installAutomations(registry?) subscribes to the CRM plugin actions
//     (record.created / record.updated / stage.changed / activity.created)
//     and runs matching enabled automations in-process (event triggers);
//   - runAutomationEvent(ctx, event) runs the automations matching one event;
//   - runScheduled(ctx) evaluates "schedule" and "inactivity" triggers
//     (called by `agentcrm automations run` from a cron / GitHub Action,
//     and periodically by the admin while open);
//   - every run is logged in the `automationRuns` collection.
// Guard against loops with ctx.depth (writes made by an automation carry
// depth + 1; stop past MAX_AUTOMATION_DEPTH).

import type { CrmActionName, CrmActionPayloads, PluginRegistry } from "../core/pluginRegistry";
import type { Automation, AutomationRun } from "../core/types";
import type { OpsContext } from "./context";

export const MAX_AUTOMATION_DEPTH = 3;

export type AutomationEvent = {
  [K in CrmActionName]: { type: K; payload: CrmActionPayloads[K] };
}[CrmActionName];

export interface AutomationRunReport {
  ran: number;
  skipped: number;
  errors: number;
  runs: AutomationRun[];
}

export async function runAutomationEvent(_ctx: OpsContext, _event: AutomationEvent): Promise<AutomationRunReport> {
  return { ran: 0, skipped: 0, errors: 0, runs: [] };
}

export async function runScheduled(_ctx: OpsContext, _opts: { dryRun?: boolean; automationId?: string } = {}): Promise<AutomationRunReport> {
  return { ran: 0, skipped: 0, errors: 0, runs: [] };
}

// Subscribes the engine to a plugin registry. Returns an uninstall function.
export function installAutomations(_registry?: PluginRegistry): () => void {
  return () => undefined;
}

export function listAutomations(ctx: OpsContext): Automation[] {
  return ctx.store.list("automations") as unknown as Automation[];
}
