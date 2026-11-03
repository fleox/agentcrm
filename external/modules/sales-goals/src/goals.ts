// Pure goal maths over the CRM data (shared by the widget, the AI tool and
// the automation action). Config lives in the module configuration
// (ops.getModuleConfig / setModuleConfig, doc config/modules):
//   { targets: { [userId]: number }, notified?: { ["userId:YYYY-MM"]: number } }

import { ops, type CrmRecord, type OpsContext, type Pipeline } from "@agent-crm/runtime";

export const MODULE_ID = "sales-goals";

export interface GoalsConfig {
  targets: Record<string, number>;
  notified?: Record<string, number>;
}

export interface GoalProgress {
  userId: string;
  name: string;
  target: number;
  won: number;
  dealsWon: number;
  // 0–∞ (1 = goal reached); null without a target.
  ratio: number | null;
}

export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function readConfig(raw: unknown): GoalsConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<GoalsConfig>;
  const targets: Record<string, number> = {};
  for (const [k, v] of Object.entries(c.targets ?? {})) if (typeof v === "number" && v > 0) targets[k] = v;
  return { targets, notified: { ...(c.notified ?? {}) } };
}

function wonStageIds(pipelines: Pipeline[]): Set<string> {
  return new Set(pipelines.flatMap((p) => p.stages.filter((s) => s.kind === "won").map((s) => s.id)));
}

// When a won deal counts: its close date, else its last update.
function wonAt(deal: CrmRecord): number {
  const close = deal.fields.closeDate;
  if (typeof close === "string" && /^\d{4}-\d{2}-\d{2}/.test(close)) return new Date(`${close.slice(0, 10)}T12:00:00`).getTime();
  return deal.updatedAt;
}

export function computeProgress(input: { deals: CrmRecord[]; pipelines: Pipeline[]; users: { id: string; name: string; disabled?: boolean; role: string }[]; config: GoalsConfig; month: string }): GoalProgress[] {
  const won = wonStageIds(input.pipelines);
  const byUser = new Map<string, { amount: number; count: number }>();
  for (const d of input.deals) {
    if (d.deletedAt || !d.ownerId || !won.has(String(d.fields.stage ?? ""))) continue;
    if (monthKey(wonAt(d)) !== input.month) continue;
    const cur = byUser.get(d.ownerId) ?? { amount: 0, count: 0 };
    cur.amount += typeof d.fields.amount === "number" ? d.fields.amount : 0;
    cur.count += 1;
    byUser.set(d.ownerId, cur);
  }
  return input.users
    .filter((u) => !u.disabled && u.role !== "viewer" && (input.config.targets[u.id] || byUser.has(u.id)))
    .map((u) => {
      const target = input.config.targets[u.id] ?? 0;
      const w = byUser.get(u.id) ?? { amount: 0, count: 0 };
      return { userId: u.id, name: u.name, target, won: w.amount, dealsWon: w.count, ratio: target ? w.amount / target : null };
    })
    .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.won - a.won);
}

// Progress from an OpsContext (AI tool, automation action).
export function progressFromOps(ctx: OpsContext, month = monthKey(ctx.now())): GoalProgress[] {
  const deals = ops.listRecords(ctx, "deals").items;
  return computeProgress({ deals, pipelines: ops.listPipelines(ctx, "deals"), users: ops.listUsers(ctx), config: readConfig(ops.getModuleConfig(ctx, MODULE_ID)), month });
}
