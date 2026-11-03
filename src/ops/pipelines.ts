// Pipelines: stage definitions of a pipeline object (deals), moving a
// record between stages, and the weighted forecast. The stage select field
// and the "pipeline" select field of the object mirror the pipelines (kept
// in sync here — never edit those options directly).

import { colorAt, dateValueToMs } from "../core/fields";
import { slugId } from "../core/ids";
import { pipelineOptions, stageOptions } from "../core/schema/standardObjects";
import type { CrmRecord, ObjectDef, Pipeline, PipelineStage, StageKind } from "../core/types";
import type { DocMutation } from "../data/types";
import { assertCan, OpsError, type OpsContext } from "./context";
import { updateRecord } from "./records";
import { asDoc, pipelinesOf, recordsOf, requireObject, requirePipeline, requireRecord, thaw } from "./store";

export function listPipelines(ctx: OpsContext, object?: string): Pipeline[] {
  assertCan(ctx, "records.read");
  return pipelinesOf(ctx.store, object);
}

export function getPipeline(ctx: OpsContext, id: string): Pipeline {
  assertCan(ctx, "records.read");
  return requirePipeline(ctx.store, id);
}

// Pipeline of a record: its "pipeline" field, else the one containing its stage.
export function pipelineOfRecord(ctx: OpsContext, record: CrmRecord): Pipeline | undefined {
  const all = pipelinesOf(ctx.store, record.object);
  const byField = all.find((p) => p.id === record.fields.pipeline);
  if (byField) return byField;
  return all.find((p) => p.stages.some((s) => s.id === record.fields[p.stageField])) ?? all[0];
}

// Object mutation re-syncing the stage / pipeline select options.
export function syncPipelineOptions(ctx: OpsContext, objectId: string, pipelines: Pipeline[]): DocMutation | null {
  const object = requireObject(ctx.store, objectId);
  const stageFields = new Set(pipelines.map((p) => p.stageField));
  let touched = false;
  const fields = object.fields.map((f) => {
    if (stageFields.has(f.id)) {
      touched = true;
      return { ...thaw(f), options: stageOptions(pipelines.filter((p) => p.stageField === f.id)) };
    }
    if (f.id === "pipeline" && f.type === "select") {
      touched = true;
      return { ...thaw(f), options: pipelineOptions(pipelines) };
    }
    return f;
  });
  if (!touched) return null;
  const next: ObjectDef = { ...object, fields, updatedAt: ctx.now() };
  return { op: "set", collection: "objects", doc: asDoc(next) };
}

export interface StageInput {
  id?: string;
  label: string;
  color?: string;
  probability?: number;
  kind?: StageKind;
}

function normalizeStages(ctx: OpsContext, stages: StageInput[], selfId: string | null): PipelineStage[] {
  if (!stages.length) throw new OpsError("validation", "A pipeline needs at least one stage.");
  // Stage ids are unique across every pipeline (one shared select field).
  const taken = new Set(pipelinesOf(ctx.store).filter((p) => p.id !== selfId).flatMap((p) => p.stages.map((s) => s.id)));
  const out: PipelineStage[] = [];
  stages.forEach((s, i) => {
    const label = s.label?.trim();
    if (!label) throw new OpsError("validation", `Stage ${i + 1} needs a label.`);
    const id = s.id && !taken.has(s.id) && !out.some((x) => x.id === s.id) ? s.id : slugId(label, [...taken, ...out.map((x) => x.id)]);
    const kind: StageKind = s.kind ?? (/^(won|gagn)/i.test(label) ? "won" : /^(lost|perdu)/i.test(label) ? "lost" : "open");
    const probability = Math.max(0, Math.min(100, Math.round(s.probability ?? (kind === "won" ? 100 : kind === "lost" ? 0 : Math.round(((i + 1) / stages.length) * 80)))));
    out.push({ id, label, color: s.color ?? colorAt(i), probability, kind });
  });
  return out;
}

export async function createPipeline(ctx: OpsContext, input: { name: string; object?: string; stageField?: string; stages: StageInput[]; id?: string }): Promise<Pipeline> {
  assertCan(ctx, "pipelines.write");
  const object = requireObject(ctx.store, input.object ?? "deals");
  const stageField = input.stageField ?? "stage";
  const field = object.fields.find((f) => f.id === stageField);
  if (!field || field.type !== "select") throw new OpsError("validation", `${object.labelPlural} has no select field "${stageField}" to hold stages.`);
  const name = input.name?.trim();
  if (!name) throw new OpsError("validation", "A pipeline needs a name.");
  const id = input.id ?? slugId(name, pipelinesOf(ctx.store).map((p) => p.id));
  const pipeline: Pipeline = { id, object: object.id, name, stageField, stages: normalizeStages(ctx, input.stages, null) };
  const all = [...pipelinesOf(ctx.store, object.id), pipeline];
  const sync = syncPipelineOptions(ctx, object.id, all);
  await ctx.store.write([{ op: "set", collection: "pipelines", doc: asDoc(pipeline) }, ...(sync ? [sync] : [])], { message: `Create pipeline ${name}` });
  return requirePipeline(ctx.store, id);
}

// Updates name and / or stages. Records on a removed stage move to
// `moveRemovedTo` (default: the first remaining open stage).
export async function updatePipeline(
  ctx: OpsContext,
  id: string,
  patch: { name?: string; stages?: StageInput[]; moveRemovedTo?: string },
): Promise<Pipeline> {
  assertCan(ctx, "pipelines.write");
  const before = requirePipeline(ctx.store, id);
  const next: Pipeline = thaw(before);
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new OpsError("validation", "A pipeline needs a name.");
    next.name = patch.name.trim();
  }
  const mutations: DocMutation[] = [];
  if (patch.stages) {
    next.stages = normalizeStages(ctx, patch.stages, id);
    const kept = new Set(next.stages.map((s) => s.id));
    const removed = before.stages.filter((s) => !kept.has(s.id)).map((s) => s.id);
    if (removed.length) {
      const fallback = patch.moveRemovedTo ?? next.stages.find((s) => s.kind === "open")?.id ?? next.stages[0].id;
      if (!kept.has(fallback)) throw new OpsError("validation", `Unknown stage "${fallback}".`);
      const target = next.stages.find((s) => s.id === fallback)!;
      for (const r of recordsOf(ctx.store, before.object, { includeDeleted: true })) {
        if (removed.includes(r.fields[before.stageField] as string)) {
          mutations.push({ op: "patch", collection: "records", id: r.id, fields: { [`fields.${before.stageField}`]: fallback, "fields.probability": target.probability, updatedAt: ctx.now() } });
        }
      }
    }
  }
  mutations.unshift({ op: "set", collection: "pipelines", doc: asDoc(next) });
  const sync = syncPipelineOptions(ctx, before.object, pipelinesOf(ctx.store, before.object).map((p) => (p.id === id ? next : p)));
  if (sync) mutations.push(sync);
  await ctx.store.write(mutations, { message: `Update pipeline ${next.name}` });
  return requirePipeline(ctx.store, id);
}

export async function deletePipeline(ctx: OpsContext, id: string, opts: { moveTo?: string } = {}): Promise<{ id: string; moved: number }> {
  assertCan(ctx, "pipelines.write");
  const pipeline = requirePipeline(ctx.store, id);
  const others = pipelinesOf(ctx.store, pipeline.object).filter((p) => p.id !== id);
  if (!others.length) throw new OpsError("invalid", "The last pipeline of an object can't be deleted.");
  const target = others.find((p) => p.id === opts.moveTo) ?? others[0];
  const stageIds = new Set(pipeline.stages.map((s) => s.id));
  const mutations: DocMutation[] = [{ op: "delete", collection: "pipelines", id }];
  let moved = 0;
  for (const r of recordsOf(ctx.store, pipeline.object, { includeDeleted: true })) {
    if (r.fields.pipeline === id || stageIds.has(r.fields[pipeline.stageField] as string)) {
      moved++;
      mutations.push({
        op: "patch",
        collection: "records",
        id: r.id,
        fields: { "fields.pipeline": target.id, [`fields.${target.stageField}`]: target.stages[0].id, "fields.probability": target.stages[0].probability, updatedAt: ctx.now() },
      });
    }
  }
  const sync = syncPipelineOptions(ctx, pipeline.object, others);
  if (sync) mutations.push(sync);
  for (const v of ctx.store.list("views")) {
    if (v.pipelineId === id) mutations.push({ op: "patch", collection: "views", id: v.id, fields: { pipelineId: target.id } });
  }
  await ctx.store.write(mutations, { message: `Delete pipeline ${pipeline.name}` });
  return { id, moved };
}

// Moves a record to a stage (by id or label). Sets the probability of the
// stage and, for lost stages, an optional lost reason.
export async function moveStage(ctx: OpsContext, recordId: string, stage: string, opts: { lostReason?: string } = {}): Promise<CrmRecord> {
  assertCan(ctx, "records.write");
  const record = requireRecord(ctx.store, recordId);
  const pipelines = pipelinesOf(ctx.store, record.object);
  if (!pipelines.length) throw new OpsError("invalid", `${record.object} records have no pipeline.`);
  const current = pipelineOfRecord(ctx, record);
  const lower = stage.trim().toLowerCase();
  const find = (p: Pipeline) => p.stages.find((s) => s.id === stage) ?? p.stages.find((s) => s.label.toLowerCase() === lower);
  const ordered = current ? [current, ...pipelines.filter((p) => p !== current)] : pipelines;
  let pipeline: Pipeline | undefined;
  let target: PipelineStage | undefined;
  for (const p of ordered) {
    target = find(p);
    if (target) {
      pipeline = p;
      break;
    }
  }
  if (!pipeline || !target) {
    throw new OpsError("validation", `Unknown stage "${stage}". Stages: ${(current ?? pipelines[0]).stages.map((s) => s.label).join(", ")}.`);
  }
  const input: Record<string, unknown> = { [pipeline.stageField]: target.id, probability: target.probability };
  const object = requireObject(ctx.store, record.object);
  if (!object.fields.some((f) => f.id === "probability")) delete input.probability;
  if (object.fields.some((f) => f.id === "pipeline")) input.pipeline = pipeline.id;
  if (opts.lostReason !== undefined && object.fields.some((f) => f.id === "lostReason")) input.lostReason = opts.lostReason;
  if (target.kind !== "open" && object.fields.some((f) => f.id === "closeDate") && !record.fields.closeDate) {
    input.closeDate = new Date(ctx.now()).toISOString().slice(0, 10);
  }
  return updateRecord(ctx, recordId, input, { message: `Move to ${target.label}` });
}

export interface ForecastStage {
  stageId: string;
  label: string;
  kind: StageKind;
  probability: number;
  count: number;
  amount: number;
  weighted: number;
}

export interface Forecast {
  pipelineId: string;
  currency?: string;
  // Open deals only.
  openCount: number;
  openAmount: number;
  weightedAmount: number;
  wonAmount: number;
  lostAmount: number;
  byStage: ForecastStage[];
  // Open deals by close month ("YYYY-MM", "none" when no close date).
  byMonth: { month: string; count: number; amount: number; weighted: number }[];
}

function amountOf(r: CrmRecord): number {
  return typeof r.fields.amount === "number" ? r.fields.amount : 0;
}

// Weighted pipeline: amount × probability (record's own probability when
// set, else the stage's). `from` / `to` filter on the close date.
export function forecast(ctx: OpsContext, opts: { pipelineId?: string; from?: number | string; to?: number | string; ownerId?: string } = {}): Forecast {
  assertCan(ctx, "reports.read");
  const all = pipelinesOf(ctx.store);
  const pipeline = opts.pipelineId ? requirePipeline(ctx.store, opts.pipelineId) : all.find((p) => p.object === "deals") ?? all[0];
  if (!pipeline) throw new OpsError("notFound", "No pipeline.");
  const object = requireObject(ctx.store, pipeline.object);
  const from = opts.from !== undefined ? dateValueToMs(opts.from) : null;
  const to = opts.to !== undefined ? dateValueToMs(opts.to) : null;
  const records = recordsOf(ctx.store, pipeline.object).filter((r) => {
    if (opts.ownerId && r.ownerId !== opts.ownerId) return false;
    if (pipelineOfRecord(ctx, r)?.id !== pipeline.id) return false;
    const close = dateValueToMs(r.fields.closeDate);
    if (from !== null && (close === null || close < from)) return false;
    if (to !== null && (close === null || close > to)) return false;
    return true;
  });
  const byStage: ForecastStage[] = pipeline.stages.map((s) => ({ stageId: s.id, label: s.label, kind: s.kind, probability: s.probability, count: 0, amount: 0, weighted: 0 }));
  const months = new Map<string, { month: string; count: number; amount: number; weighted: number }>();
  let wonAmount = 0;
  let lostAmount = 0;
  for (const r of records) {
    const stage = byStage.find((s) => s.stageId === r.fields[pipeline.stageField]);
    if (!stage) continue;
    const amount = amountOf(r);
    const probability = typeof r.fields.probability === "number" ? r.fields.probability : stage.probability;
    const weighted = stage.kind === "won" ? amount : stage.kind === "lost" ? 0 : (amount * probability) / 100;
    stage.count++;
    stage.amount += amount;
    stage.weighted += weighted;
    if (stage.kind === "won") wonAmount += amount;
    else if (stage.kind === "lost") lostAmount += amount;
    else {
      const close = typeof r.fields.closeDate === "string" ? r.fields.closeDate.slice(0, 7) : "none";
      const m = months.get(close) ?? { month: close, count: 0, amount: 0, weighted: 0 };
      m.count++;
      m.amount += amount;
      m.weighted += weighted;
      months.set(close, m);
    }
  }
  const open = byStage.filter((s) => s.kind === "open");
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    pipelineId: pipeline.id,
    currency: object.fields.find((f) => f.id === "amount")?.currency,
    openCount: open.reduce((a, s) => a + s.count, 0),
    openAmount: round(open.reduce((a, s) => a + s.amount, 0)),
    weightedAmount: round(open.reduce((a, s) => a + s.weighted, 0)),
    wonAmount: round(wonAmount),
    lostAmount: round(lostAmount),
    byStage: byStage.map((s) => ({ ...s, amount: round(s.amount), weighted: round(s.weighted) })),
    byMonth: [...months.values()].sort((a, b) => (a.month === "none" ? 1 : b.month === "none" ? -1 : a.month < b.month ? -1 : 1)).map((m) => ({ ...m, amount: round(m.amount), weighted: round(m.weighted) })),
  };
}
