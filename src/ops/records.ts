// Records: list (filter / sort / search / paginate), get (relations
// expanded), create, update (per-field patch), soft delete, restore,
// bulk operations. Every write validates through core/fields.ts and the
// object definition, keeps derived fields in sync (person name, deal
// pipeline / probability) and emits plugin actions.

import { defaultFieldValues, FieldValidationError, isEmptyFieldValue, normalizeDomain, normalizeEmail, recordLabel, validateRecordFields, type FieldError } from "../core/fields";
import { newId } from "../core/ids";
import { applyFilters, applySorts, paginate, resolveField, type Page } from "../core/query";
import { normalizeStandardFields } from "../core/schema/standardObjects";
import { buildSearchIndex } from "../core/search";
import type { CrmRecord, Filter, ObjectDef, Sort } from "../core/types";
import type { DocMutation } from "../data/types";
import { actorId, assertCan, emit, OpsError, type OpsContext } from "./context";
import { fileCleanupMutations } from "./fileRefs";
import { expandRelations, inverseRelations, labelOf, rewriteReferences, validateRelationValue, type InverseRelation, type RecordRef } from "./relations";
import { activitiesOf, asDoc, objectsOf, pipelinesOf, recordOf, recordsOf, requireObject, requireRecord, userOf } from "./store";

export type RecordInput = Record<string, unknown>;

export interface ListRecordsOptions {
  filters?: Filter[];
  sorts?: Sort[];
  search?: string;
  viewId?: string;
  ownerId?: string;
  offset?: number;
  limit?: number;
  includeDeleted?: boolean;
  onlyDeleted?: boolean;
}

export interface WriteRecordOptions {
  // Unknown field ids: error (default) or ignored.
  unknownFields?: "error" | "drop";
  // Interpret ambiguous dates day-first (CSV from Europe).
  dayFirst?: boolean;
  // Skip plugin actions (bulk internal writes).
  silent?: boolean;
  message?: string;
}

export interface RecordDetails {
  record: CrmRecord;
  label: string;
  object: { id: string; labelSingular: string; labelPlural: string };
  relations: Record<string, RecordRef[]>;
  inverse: InverseRelation[];
  activityCount: number;
}

// ─── Reads ──────────────────────────────────────────────────────────────

export function queryContext(ctx: OpsContext, object: ObjectDef) {
  return {
    object,
    now: ctx.now(),
    recordLabel: (_o: string, id: string) => labelOf(ctx, id),
    userName: (id: string) => userOf(ctx.store, id)?.name,
  };
}

export function listRecords(ctx: OpsContext, objectId: string, opts: ListRecordsOptions = {}): Page<CrmRecord> {
  assertCan(ctx, "records.read");
  const object = requireObject(ctx.store, objectId);
  // Explicit filters / sorts (CLI, AI tools) must name real fields: an unknown
  // field never excludes anything (that keeps saved views with a deleted field
  // working), so a typo would silently return — and let bulk actions touch —
  // every record. Saved view filters keep the lenient behaviour.
  const unknown = [...(opts.filters ?? []), ...(opts.sorts ?? [])].map((f) => f.field).filter((f) => !resolveField(object, f));
  if (unknown.length) {
    throw new OpsError("validation", `Unknown field${unknown.length > 1 ? "s" : ""} ${[...new Set(unknown)].map((f) => `"${f}"`).join(", ")} on ${object.labelPlural}. Fields: ${object.fields.map((f) => f.id).join(", ")}, id, ownerId, createdAt, updatedAt.`);
  }
  let filters = opts.filters ?? [];
  let sorts = opts.sorts ?? [];
  if (opts.viewId) {
    const view = ctx.store.get("views", opts.viewId) as unknown as { object: string; filters: Filter[]; sorts: Sort[] } | undefined;
    if (!view || view.object !== objectId) throw new OpsError("notFound", `View "${opts.viewId}" not found on ${object.labelPlural}.`);
    filters = [...view.filters, ...filters];
    if (!opts.sorts?.length) sorts = view.sorts;
  }
  let records = recordsOf(ctx.store, objectId, { includeDeleted: opts.includeDeleted || opts.onlyDeleted });
  if (opts.onlyDeleted) records = records.filter((r) => r.deletedAt);
  if (opts.ownerId) records = records.filter((r) => r.ownerId === opts.ownerId);
  const qctx = queryContext(ctx, object);
  records = applyFilters(records, filters, qctx);
  if (opts.search?.trim()) {
    const index = buildSearchIndex({ objects: objectsOf(ctx.store), records });
    const hits = index.search(opts.search, { objects: [objectId], limit: records.length, includeDeleted: true });
    const byId = new Map(records.map((r) => [r.id, r]));
    records = hits.map((h) => byId.get(h.id)).filter((r): r is CrmRecord => !!r);
    if (sorts.length && opts.sorts?.length) records = applySorts(records, sorts, qctx);
  } else {
    records = applySorts(records, sorts.length ? sorts : [{ field: "createdAt", dir: "desc" }], qctx);
  }
  return paginate(records, { offset: opts.offset, limit: opts.limit });
}

export function getRecord(ctx: OpsContext, id: string, opts: { includeDeleted?: boolean } = {}): CrmRecord {
  assertCan(ctx, "records.read");
  return requireRecord(ctx.store, id, opts);
}

export function getRecordDetails(ctx: OpsContext, id: string): RecordDetails {
  assertCan(ctx, "records.read");
  const record = requireRecord(ctx.store, id, { includeDeleted: true });
  const object = requireObject(ctx.store, record.object);
  return {
    record,
    label: recordLabel(object, record),
    object: { id: object.id, labelSingular: object.labelSingular, labelPlural: object.labelPlural },
    relations: expandRelations(ctx, record),
    inverse: inverseRelations(ctx, record),
    activityCount: activitiesOf(ctx.store).filter((a) => a.targets.some((t) => t.id === id)).length,
  };
}

export function searchRecords(ctx: OpsContext, query: string, opts: { objects?: string[]; limit?: number } = {}) {
  assertCan(ctx, "records.read");
  const index = buildSearchIndex({ objects: objectsOf(ctx.store), records: recordsOf(ctx.store), activities: activitiesOf(ctx.store) });
  return index.search(query, { objects: opts.objects, limit: opts.limit ?? 20 });
}

// ─── Write preparation ──────────────────────────────────────────────────

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function uniqueKey(type: string, value: unknown): string {
  if (type === "email") return normalizeEmail(value);
  if (type === "url") return normalizeDomain(value) || String(value).toLowerCase();
  return typeof value === "string" ? value.trim().toLowerCase() : JSON.stringify(value);
}

interface Prepared {
  fields: Record<string, unknown>;
  changed: string[];
  stageChange: { pipelineId: string; from: string | null; to: string } | null;
}

// Validates `input` against the object and merges it over `previous`.
export function prepareRecordFields(
  ctx: OpsContext,
  object: ObjectDef,
  input: RecordInput,
  previous: CrmRecord | null,
  opts: WriteRecordOptions = {},
): Prepared {
  const res = validateRecordFields(object, input, { partial: !!previous, unknownFields: opts.unknownFields, dayFirst: opts.dayFirst });
  const errors: FieldError[] = [...res.errors];
  let merged: Record<string, unknown> = previous ? { ...previous.fields } : { ...defaultFieldValues(object) };
  for (const [k, v] of Object.entries(res.values)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  merged = normalizeStandardFields(object.id, merged, previous?.fields ?? null);

  // Pipelines: keep stage / pipeline / probability consistent.
  let stageChange: Prepared["stageChange"] = null;
  for (const pipeline of pipelinesOf(ctx.store, object.id)) {
    const stageField = pipeline.stageField;
    const prevStage = (previous?.fields[stageField] as string | undefined) ?? null;
    const stage = merged[stageField] as string | undefined;
    const hasPipelineField = object.fields.some((f) => f.id === "pipeline");
    const pipelineOfRecord = hasPipelineField ? (merged.pipeline as string | undefined) : pipeline.id;
    const stageInThis = stage ? pipeline.stages.find((s) => s.id === stage) : undefined;
    if (stageInThis) {
      if (hasPipelineField && pipelineOfRecord !== pipeline.id) merged.pipeline = pipeline.id;
      if (stage !== prevStage) {
        stageChange = { pipelineId: pipeline.id, from: prevStage, to: stage! };
        if (object.fields.some((f) => f.id === "probability") && !Object.prototype.hasOwnProperty.call(input, "probability")) {
          merged.probability = stageInThis.probability;
        }
      }
    } else if (hasPipelineField && pipelineOfRecord === pipeline.id && !stage && pipeline.stages[0]) {
      // Pipeline set without a stage → first stage.
      merged[stageField] = pipeline.stages[0].id;
      if (object.fields.some((f) => f.id === "probability") && merged.probability === undefined) merged.probability = pipeline.stages[0].probability;
      stageChange = { pipelineId: pipeline.id, from: prevStage, to: pipeline.stages[0].id };
    }
  }

  // Cross-record checks: relations, users, uniqueness.
  const others = recordsOf(ctx.store, object.id).filter((r) => r.id !== previous?.id);
  for (const field of object.fields) {
    const value = merged[field.id];
    const touched = !previous || Object.prototype.hasOwnProperty.call(res.values, field.id) || !sameValue(value, previous.fields[field.id]);
    if (!touched || isEmptyFieldValue(field, value)) continue;
    if (field.type === "relation") {
      const err = validateRelationValue(ctx, field, value);
      if (err) errors.push({ field: field.id, code: "invalidRelation", message: err });
    } else if (field.type === "user") {
      if (!userOf(ctx.store, String(value))) errors.push({ field: field.id, code: "invalidUser", message: `${field.label}: unknown user "${value}".` });
    }
    if (field.unique) {
      const key = uniqueKey(field.type, value);
      const clash = others.find((r) => !isEmptyFieldValue(field, r.fields[field.id]) && uniqueKey(field.type, r.fields[field.id]) === key);
      if (clash) {
        errors.push({
          field: field.id,
          code: "notUnique",
          message: `${field.label} "${String(value)}" is already used by ${recordLabel(object, clash)} (${clash.id}).`,
        });
      }
    }
  }
  if (errors.length) throw new OpsError("validation", new FieldValidationError(errors).message, errors);

  const changed = previous
    ? [...new Set([...Object.keys(merged), ...Object.keys(previous.fields)])].filter((k) => !sameValue(merged[k], previous.fields[k]))
    : Object.keys(merged);
  return { fields: merged, changed, stageChange };
}

function checkOwner(ctx: OpsContext, ownerId: string | null | undefined): void {
  if (ownerId && !userOf(ctx.store, ownerId)) throw new OpsError("validation", `Unknown owner "${ownerId}".`);
}

// ─── Writes ─────────────────────────────────────────────────────────────

export async function createRecord(
  ctx: OpsContext,
  objectId: string,
  input: RecordInput,
  opts: WriteRecordOptions & { id?: string; ownerId?: string | null } = {},
): Promise<CrmRecord> {
  assertCan(ctx, "records.write");
  const object = requireObject(ctx.store, objectId);
  const prepared = prepareRecordFields(ctx, object, input, null, opts);
  const now = ctx.now();
  const ownerId = opts.ownerId === undefined ? actorId(ctx) : opts.ownerId ?? undefined;
  checkOwner(ctx, ownerId);
  const id = opts.id ?? newId(now);
  if (recordOf(ctx.store, id)) throw new OpsError("conflict", `Record "${id}" already exists.`);
  const record: CrmRecord = {
    id,
    object: object.id,
    fields: prepared.fields,
    ...(ownerId ? { ownerId } : {}),
    createdAt: now,
    updatedAt: now,
    ...(actorId(ctx) ? { createdBy: actorId(ctx), updatedBy: actorId(ctx) } : {}),
  };
  await ctx.store.write([{ op: "set", collection: "records", doc: asDoc(record) }], { message: opts.message ?? `Create ${object.labelSingular}` });
  const stored = requireRecord(ctx.store, id);
  if (!opts.silent) {
    await emit(ctx, "record.created", { record: stored });
    if (prepared.stageChange) await emit(ctx, "stage.changed", { record: stored, ...prepared.stageChange, from: null });
  }
  return stored;
}

// Mutation patching only the changed fields (per-field LWW on the journal).
export function recordPatchMutation(ctx: OpsContext, previous: CrmRecord, fields: Record<string, unknown>, changed: string[], extra: Record<string, unknown> = {}): DocMutation {
  const patch: Record<string, unknown> = { updatedAt: ctx.now(), ...extra };
  if (actorId(ctx)) patch.updatedBy = actorId(ctx);
  for (const k of changed) patch[`fields.${k}`] = fields[k];
  return { op: "patch", collection: "records", id: previous.id, fields: patch };
}

export async function updateRecord(
  ctx: OpsContext,
  id: string,
  input: RecordInput,
  opts: WriteRecordOptions & { ownerId?: string | null } = {},
): Promise<CrmRecord> {
  assertCan(ctx, "records.write");
  const before = requireRecord(ctx.store, id);
  const object = requireObject(ctx.store, before.object);
  const prepared = prepareRecordFields(ctx, object, input, before, opts);
  const extra: Record<string, unknown> = {};
  if (opts.ownerId !== undefined && opts.ownerId !== before.ownerId) {
    checkOwner(ctx, opts.ownerId);
    extra.ownerId = opts.ownerId ?? undefined;
  }
  if (!prepared.changed.length && !Object.keys(extra).length) return before;
  await ctx.store.write([recordPatchMutation(ctx, before, prepared.fields, prepared.changed, extra)], { message: opts.message ?? `Update ${object.labelSingular}` });
  const record = requireRecord(ctx.store, id);
  if (!opts.silent) {
    await emit(ctx, "record.updated", { record, before, changed: [...prepared.changed, ...Object.keys(extra)] });
    if (prepared.stageChange) await emit(ctx, "stage.changed", { record, ...prepared.stageChange });
  }
  return record;
}

export async function setRecordOwner(ctx: OpsContext, id: string, ownerId: string | null): Promise<CrmRecord> {
  return updateRecord(ctx, id, {}, { ownerId });
}

// Soft delete by default (restorable). `hard: true` removes the record,
// its references and the activities that only target it.
export async function deleteRecord(ctx: OpsContext, id: string, opts: { hard?: boolean; silent?: boolean } = {}): Promise<{ id: string; hard: boolean }> {
  assertCan(ctx, "records.delete");
  const record = requireRecord(ctx.store, id, { includeDeleted: opts.hard });
  const object = objectsOf(ctx.store).find((o) => o.id === record.object);
  const mutations = opts.hard
    ? hardDeleteMutations(ctx, [id])
    : [{ op: "patch" as const, collection: "records" as const, id, fields: { deletedAt: ctx.now(), updatedAt: ctx.now(), ...(actorId(ctx) ? { updatedBy: actorId(ctx) } : {}) } }];
  await ctx.store.write(mutations, { message: `Delete ${object?.labelSingular ?? "record"}` });
  if (!opts.silent) await emit(ctx, "record.deleted", { record, hard: !!opts.hard });
  return { id, hard: !!opts.hard };
}

// Mutations that physically remove records: the docs, references to
// them, and activities whose only targets they are (others lose the target).
export function hardDeleteMutations(ctx: OpsContext, ids: string[]): DocMutation[] {
  const doomed = new Set(ids);
  const out: DocMutation[] = ids.map((id) => ({ op: "delete", collection: "records", id }));
  out.push(...rewriteReferences(ctx, ids, null));
  const doomedActivities: string[] = [];
  for (const a of activitiesOf(ctx.store, { includeDeleted: true })) {
    if (!a.targets.some((t) => doomed.has(t.id))) continue;
    const rest = a.targets.filter((t) => !doomed.has(t.id));
    if (rest.length === 0) {
      out.push({ op: "delete", collection: "activities", id: a.id });
      doomedActivities.push(a.id);
    } else out.push({ op: "patch", collection: "activities", id: a.id, fields: { targets: rest, updatedAt: ctx.now() } });
  }
  // Their files lose these targets (orphans are purged by compact).
  out.push(...fileCleanupMutations(ctx, { records: ids, activities: doomedActivities }));
  return out;
}

export async function restoreRecord(ctx: OpsContext, id: string): Promise<CrmRecord> {
  assertCan(ctx, "records.write");
  const record = requireRecord(ctx.store, id, { includeDeleted: true });
  if (!record.deletedAt) return record;
  await ctx.store.write([{ op: "patch", collection: "records", id, fields: { deletedAt: undefined, updatedAt: ctx.now() } }], { message: "Restore record" });
  const restored = requireRecord(ctx.store, id);
  await emit(ctx, "record.restored", { record: restored });
  return restored;
}

export interface BulkResult {
  updated: string[];
  errors: { id: string; message: string }[];
}

// One write for every record; records failing validation are reported
// and skipped.
export async function bulkUpdate(ctx: OpsContext, ids: string[], input: RecordInput, opts: WriteRecordOptions = {}): Promise<BulkResult> {
  assertCan(ctx, "records.write");
  const mutations: DocMutation[] = [];
  const events: { before: CrmRecord; changed: string[]; stage: Prepared["stageChange"] }[] = [];
  const errors: BulkResult["errors"] = [];
  for (const id of ids) {
    try {
      const before = requireRecord(ctx.store, id);
      const object = requireObject(ctx.store, before.object);
      const prepared = prepareRecordFields(ctx, object, input, before, opts);
      if (!prepared.changed.length) continue;
      mutations.push(recordPatchMutation(ctx, before, prepared.fields, prepared.changed));
      events.push({ before, changed: prepared.changed, stage: prepared.stageChange });
    } catch (err) {
      errors.push({ id, message: (err as Error).message });
    }
  }
  if (mutations.length) await ctx.store.write(mutations, { message: opts.message ?? `Update ${mutations.length} records` });
  if (!opts.silent) {
    for (const e of events) {
      const record = requireRecord(ctx.store, e.before.id);
      await emit(ctx, "record.updated", { record, before: e.before, changed: e.changed });
      if (e.stage) await emit(ctx, "stage.changed", { record, ...e.stage });
    }
  }
  return { updated: events.map((e) => e.before.id), errors };
}

export async function bulkDelete(ctx: OpsContext, ids: string[], opts: { hard?: boolean } = {}): Promise<{ deleted: string[] }> {
  assertCan(ctx, "records.delete");
  const records = ids.map((id) => requireRecord(ctx.store, id, { includeDeleted: opts.hard }));
  const now = ctx.now();
  const mutations: DocMutation[] = opts.hard
    ? hardDeleteMutations(ctx, ids)
    : ids.map((id) => ({ op: "patch", collection: "records", id, fields: { deletedAt: now, updatedAt: now } }));
  if (mutations.length) await ctx.store.write(mutations, { message: `Delete ${ids.length} records` });
  for (const record of records) await emit(ctx, "record.deleted", { record, hard: !!opts.hard });
  return { deleted: ids };
}
