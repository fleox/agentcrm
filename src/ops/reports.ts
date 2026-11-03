// Reports. Pure reads over the in-memory dataset, JSON-able results (the
// dashboard charts them, the CLI prints them, the AI tools return them).

import { dateValueToMs } from "../core/fields";
import { LIFECYCLE_OPTIONS } from "../core/schema/standardObjects";
import { ACTIVITY_TYPES, type ActivityType, type CrmRecord } from "../core/types";
import { lastActivityAt } from "./activities";
import { assertCan, OpsError, type OpsContext } from "./context";
import { forecast, pipelineOfRecord } from "./pipelines";
import { getSettings } from "./settings";
import { activitiesOf, objectOf, pipelinesOf, recordsOf, requirePipeline, usersOf } from "./store";
import { recordLabel } from "../core/fields";

const DAY = 86_400_000;

function defaultPipelineId(ctx: OpsContext, pipelineId?: string): string {
  if (pipelineId) return requirePipeline(ctx.store, pipelineId).id;
  const p = pipelinesOf(ctx.store, "deals")[0] ?? pipelinesOf(ctx.store)[0];
  if (!p) throw new OpsError("notFound", "No pipeline.");
  return p.id;
}

export interface PipelineByStageRow {
  stageId: string;
  label: string;
  color: string;
  kind: string;
  count: number;
  amount: number;
  weighted: number;
}

export function pipelineByStage(ctx: OpsContext, opts: { pipelineId?: string; ownerId?: string } = {}): { pipelineId: string; stages: PipelineByStageRow[] } {
  assertCan(ctx, "reports.read");
  const pipelineId = defaultPipelineId(ctx, opts.pipelineId);
  const pipeline = requirePipeline(ctx.store, pipelineId);
  const f = forecast(ctx, { pipelineId, ownerId: opts.ownerId });
  return {
    pipelineId,
    stages: f.byStage.map((s) => ({ stageId: s.stageId, label: s.label, color: pipeline.stages.find((x) => x.id === s.stageId)?.color ?? "gray", kind: s.kind, count: s.count, amount: s.amount, weighted: s.weighted })),
  };
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function lastMonths(now: number, months: number): string[] {
  const d = new Date(now);
  const out: string[] = [];
  for (let i = months - 1; i >= 0; i--) out.push(monthKey(new Date(d.getFullYear(), d.getMonth() - i, 1).getTime()));
  return out;
}

// Closing time of a won / lost deal: its close date, else last update.
function closedAt(r: CrmRecord): number {
  return dateValueToMs(r.fields.closeDate) ?? r.updatedAt;
}

export interface WonLostRow {
  month: string;
  wonCount: number;
  wonAmount: number;
  lostCount: number;
  lostAmount: number;
  winRate: number | null;
}

export function wonLost(ctx: OpsContext, opts: { months?: number; pipelineId?: string; ownerId?: string } = {}): { pipelineId: string; months: WonLostRow[]; totals: Omit<WonLostRow, "month"> } {
  assertCan(ctx, "reports.read");
  const pipelineId = defaultPipelineId(ctx, opts.pipelineId);
  const pipeline = requirePipeline(ctx.store, pipelineId);
  const months = lastMonths(ctx.now(), Math.max(1, Math.min(36, opts.months ?? 6)));
  const rows = new Map(months.map((m) => [m, { month: m, wonCount: 0, wonAmount: 0, lostCount: 0, lostAmount: 0, winRate: null as number | null }]));
  for (const r of recordsOf(ctx.store, pipeline.object)) {
    if (opts.ownerId && r.ownerId !== opts.ownerId) continue;
    if (pipelineOfRecord(ctx, r)?.id !== pipelineId) continue;
    const stage = pipeline.stages.find((s) => s.id === r.fields[pipeline.stageField]);
    if (!stage || stage.kind === "open") continue;
    const row = rows.get(monthKey(closedAt(r)));
    if (!row) continue;
    const amount = typeof r.fields.amount === "number" ? r.fields.amount : 0;
    if (stage.kind === "won") {
      row.wonCount++;
      row.wonAmount += amount;
    } else {
      row.lostCount++;
      row.lostAmount += amount;
    }
  }
  const list = [...rows.values()].map((r) => ({ ...r, winRate: r.wonCount + r.lostCount ? Math.round((r.wonCount / (r.wonCount + r.lostCount)) * 1000) / 10 : null }));
  const t = list.reduce((a, r) => ({ wonCount: a.wonCount + r.wonCount, wonAmount: a.wonAmount + r.wonAmount, lostCount: a.lostCount + r.lostCount, lostAmount: a.lostAmount + r.lostAmount }), { wonCount: 0, wonAmount: 0, lostCount: 0, lostAmount: 0 });
  return { pipelineId, months: list, totals: { ...t, winRate: t.wonCount + t.lostCount ? Math.round((t.wonCount / (t.wonCount + t.lostCount)) * 1000) / 10 : null } };
}

export interface ActivityByUserRow {
  userId: string | null;
  name: string;
  total: number;
  byType: Record<ActivityType, number>;
  tasksDone: number;
  tasksOpen: number;
}

export function activityByUser(ctx: OpsContext, opts: { days?: number } = {}): { days: number; users: ActivityByUserRow[] } {
  assertCan(ctx, "reports.read");
  const days = opts.days ?? 30;
  const since = ctx.now() - days * DAY;
  const users = new Map(usersOf(ctx.store).map((u) => [u.id, u.name]));
  const rows = new Map<string | null, ActivityByUserRow>();
  const row = (id: string | null) => {
    let r = rows.get(id);
    if (!r) {
      r = { userId: id, name: id ? users.get(id) ?? id : "Unassigned", total: 0, byType: Object.fromEntries(ACTIVITY_TYPES.map((t) => [t, 0])) as Record<ActivityType, number>, tasksDone: 0, tasksOpen: 0 };
      rows.set(id, r);
    }
    return r;
  };
  for (const a of activitiesOf(ctx.store)) {
    const who = (a.type === "task" ? a.assigneeId ?? a.createdBy : a.createdBy) ?? null;
    if (a.type === "task" && !a.doneAt) row(who).tasksOpen++;
    if (a.createdAt < since && !(a.doneAt && a.doneAt >= since)) continue;
    const r = row(who);
    r.total++;
    r.byType[a.type]++;
    if (a.type === "task" && a.doneAt && a.doneAt >= since) r.tasksDone++;
  }
  return { days, users: [...rows.values()].sort((a, b) => b.total - a.total) };
}

export function leadSources(ctx: OpsContext, opts: { object?: string; since?: number } = {}): { field: string; sources: { id: string | null; label: string; count: number; customers: number }[] } {
  assertCan(ctx, "reports.read");
  const objectId = opts.object ?? "people";
  const object = objectOf(ctx.store, objectId);
  const field = object?.fields.find((f) => f.id === "leadSource");
  if (!object || !field) return { field: "leadSource", sources: [] };
  const counts = new Map<string | null, { id: string | null; label: string; count: number; customers: number }>();
  for (const r of recordsOf(ctx.store, objectId)) {
    if (opts.since && r.createdAt < opts.since) continue;
    const id = typeof r.fields.leadSource === "string" ? r.fields.leadSource : null;
    const entry = counts.get(id) ?? { id, label: id ? field.options?.find((o) => o.id === id)?.label ?? id : "Unknown", count: 0, customers: 0 };
    entry.count++;
    if (r.fields.lifecycleStage === "customer" || r.fields.lifecycleStage === "evangelist") entry.customers++;
    counts.set(id, entry);
  }
  return { field: "leadSource", sources: [...counts.values()].sort((a, b) => b.count - a.count) };
}

export interface StaleDeal {
  id: string;
  label: string;
  stage: string;
  amount: number;
  ownerId?: string;
  lastActivityAt: number | null;
  idleDays: number;
}

export function staleDeals(ctx: OpsContext, opts: { days?: number; pipelineId?: string; limit?: number } = {}): { days: number; deals: StaleDeal[] } {
  assertCan(ctx, "reports.read");
  const days = opts.days ?? getSettings(ctx).staleDealDays;
  const now = ctx.now();
  const out: StaleDeal[] = [];
  for (const pipeline of pipelinesOf(ctx.store)) {
    if (opts.pipelineId && pipeline.id !== opts.pipelineId) continue;
    const object = objectOf(ctx.store, pipeline.object);
    for (const r of recordsOf(ctx.store, pipeline.object)) {
      if (pipelineOfRecord(ctx, r)?.id !== pipeline.id) continue;
      const stage = pipeline.stages.find((s) => s.id === r.fields[pipeline.stageField]);
      if (!stage || stage.kind !== "open") continue;
      const last = Math.max(lastActivityAt(ctx, r.id) ?? 0, r.updatedAt);
      const idle = Math.floor((now - last) / DAY);
      if (idle < days) continue;
      out.push({ id: r.id, label: recordLabel(object, r), stage: stage.label, amount: typeof r.fields.amount === "number" ? r.fields.amount : 0, ownerId: r.ownerId, lastActivityAt: lastActivityAt(ctx, r.id) ?? null, idleDays: idle });
    }
  }
  out.sort((a, b) => b.idleDays - a.idleDays || b.amount - a.amount);
  return { days, deals: opts.limit ? out.slice(0, opts.limit) : out };
}

// Lifecycle funnel: how many people reached each stage (a customer also
// counts as having been a lead, mql…) and the step conversion rates.
export function conversion(ctx: OpsContext, opts: { since?: number } = {}): { stages: { id: string; label: string; count: number; reached: number; conversionFromPrevious: number | null }[] } {
  assertCan(ctx, "reports.read");
  const object = objectOf(ctx.store, "people");
  const field = object?.fields.find((f) => f.id === "lifecycleStage");
  const options = field?.options ?? LIFECYCLE_OPTIONS;
  const counts = new Map(options.map((o) => [o.id, 0]));
  for (const r of recordsOf(ctx.store, "people")) {
    if (opts.since && r.createdAt < opts.since) continue;
    const v = r.fields.lifecycleStage;
    if (typeof v === "string" && counts.has(v)) counts.set(v, counts.get(v)! + 1);
  }
  const stages = options.map((o, i) => ({ id: o.id, label: o.label, count: counts.get(o.id) ?? 0, reached: options.slice(i).reduce((a, x) => a + (counts.get(x.id) ?? 0), 0), conversionFromPrevious: null as number | null }));
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1].reached;
    stages[i].conversionFromPrevious = prev ? Math.round((stages[i].reached / prev) * 1000) / 10 : null;
  }
  return { stages };
}

// Registry used by the CLI (`agentcrm report <name>`) and the AI tools.
export const REPORTS = {
  pipelineByStage: { description: "Open pipeline by stage: count, amount, weighted amount.", run: pipelineByStage },
  forecast: { description: "Weighted forecast (amount × probability) by stage and close month.", run: forecast },
  wonLost: { description: "Won vs lost deals per month with win rate (params: months).", run: wonLost },
  activityByUser: { description: "Activities logged per user over the last N days (params: days).", run: activityByUser },
  leadSources: { description: "People per lead source, with how many became customers.", run: leadSources },
  staleDeals: { description: "Open deals without activity for N days (params: days).", run: staleDeals },
  conversion: { description: "Lifecycle stage funnel with step conversion rates.", run: conversion },
} as const;

export type ReportName = keyof typeof REPORTS;

export function runReport(ctx: OpsContext, name: string, params: Record<string, unknown> = {}): unknown {
  const report = REPORTS[name as ReportName];
  if (!report) throw new OpsError("notFound", `Unknown report "${name}". Reports: ${Object.keys(REPORTS).join(", ")}.`);
  return (report.run as (ctx: OpsContext, p: Record<string, unknown>) => unknown)(ctx, params);
}
