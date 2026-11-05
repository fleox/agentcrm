// Relations are stored on the record field holding the id (`one`) or the
// id array (`many`); inverse lists are computed here — never dual-written.

import { recordLabel } from "../core/fields";
import type { CrmRecord, FieldDef, ObjectDef } from "../core/types";
import type { DocMutation } from "../data/types";
import { actorId, assertCan, OpsError, type OpsContext } from "./context";
import { objectOf, objectsOf, recordOf, recordsOf, requireObject, requireRecord } from "./store";

export interface RecordRef {
  id: string;
  object: string;
  label: string;
}

export interface InverseRelation {
  // Object holding the relation field (e.g. "people" for company → people).
  object: string;
  field: string;
  fieldLabel: string;
  // Name to show on the target side ("People", or FieldDef.relation.inverseField).
  label: string;
  records: RecordRef[];
}

export function relationFields(object: ObjectDef): FieldDef[] {
  return object.fields.filter((f) => f.type === "relation" && f.relation);
}

export function relationIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" && value ? [value] : [];
}

export function toRef(ctx: OpsContext, record: CrmRecord): RecordRef {
  return { id: record.id, object: record.object, label: recordLabel(objectOf(ctx.store, record.object), record) };
}

export function labelOf(ctx: OpsContext, id: string): string | undefined {
  const r = recordOf(ctx.store, id);
  return r ? recordLabel(objectOf(ctx.store, r.object), r) : undefined;
}

// Records linked from `record` through its relation field `fieldId`.
export function relatedRecords(ctx: OpsContext, record: CrmRecord, fieldId: string): CrmRecord[] {
  return relationIds(record.fields[fieldId])
    .map((id) => recordOf(ctx.store, id))
    .filter((r): r is CrmRecord => !!r && !r.deletedAt);
}

// Every record of every object pointing at `record` (computed inverse).
export function inverseRelations(ctx: OpsContext, record: CrmRecord): InverseRelation[] {
  const out: InverseRelation[] = [];
  for (const object of objectsOf(ctx.store)) {
    for (const field of relationFields(object)) {
      if (field.relation!.object !== record.object) continue;
      const records = recordsOf(ctx.store, object.id).filter((r) => relationIds(r.fields[field.id]).includes(record.id));
      out.push({
        object: object.id,
        field: field.id,
        fieldLabel: field.label,
        label: object.labelPlural,
        records: records.map((r) => toRef(ctx, r)),
      });
    }
  }
  return out;
}

// Expanded view of a record's own relation fields.
export function expandRelations(ctx: OpsContext, record: CrmRecord): Record<string, RecordRef[]> {
  const object = objectOf(ctx.store, record.object);
  const out: Record<string, RecordRef[]> = {};
  if (!object) return out;
  for (const field of relationFields(object)) out[field.id] = relatedRecords(ctx, record, field.id).map((r) => toRef(ctx, r));
  return out;
}

// Checks that ids exist and belong to the relation's target object.
export function validateRelationValue(ctx: OpsContext, field: FieldDef, value: unknown): string | null {
  const target = field.relation?.object;
  for (const id of relationIds(value)) {
    const r = recordOf(ctx.store, id);
    if (!r || r.deletedAt) return `${field.label}: record "${id}" not found.`;
    if (r.object !== target) return `${field.label}: "${id}" is a ${r.object} record, expected ${target}.`;
  }
  return null;
}

function patchFieldMutation(ctx: OpsContext, record: CrmRecord, fieldId: string, value: unknown): DocMutation {
  return {
    op: "patch",
    collection: "records",
    id: record.id,
    fields: {
      [`fields.${fieldId}`]: value,
      updatedAt: ctx.now(),
      updatedBy: actorId(ctx),
      ...(actorId(ctx) ? { [`fieldUpdates.${fieldId}`]: { by: actorId(ctx), at: ctx.now() } } : {}),
    },
  };
}

// Mutations replacing every reference to `fromId` with `toId` (merge) or
// removing it (toId null: hard delete).
export function rewriteReferences(ctx: OpsContext, fromIds: string[], toId: string | null): DocMutation[] {
  const from = new Set(fromIds);
  const out: DocMutation[] = [];
  for (const object of objectsOf(ctx.store)) {
    const fields = relationFields(object);
    if (!fields.length) continue;
    for (const r of recordsOf(ctx.store, object.id, { includeDeleted: true })) {
      if (from.has(r.id)) continue;
      for (const field of fields) {
        const ids = relationIds(r.fields[field.id]);
        if (!ids.some((id) => from.has(id))) continue;
        if (field.relation!.cardinality === "many") {
          const next = [...new Set(ids.map((id) => (from.has(id) ? toId : id)).filter((id): id is string => !!id))];
          out.push(patchFieldMutation(ctx, r, field.id, next.length ? next : undefined));
        } else {
          out.push(patchFieldMutation(ctx, r, field.id, toId ?? undefined));
        }
      }
    }
  }
  return out;
}

// Adds `targetId` to the relation field `fieldId` of `recordId`.
export async function linkRecords(ctx: OpsContext, recordId: string, fieldId: string, targetId: string): Promise<CrmRecord> {
  assertCan(ctx, "records.write");
  const record = requireRecord(ctx.store, recordId);
  const object = requireObject(ctx.store, record.object);
  const field = object.fields.find((f) => f.id === fieldId);
  if (!field || field.type !== "relation") throw new OpsError("invalid", `"${fieldId}" is not a relation field of ${object.labelPlural}.`);
  const err = validateRelationValue(ctx, field, targetId);
  if (err) throw new OpsError("validation", err);
  const ids = relationIds(record.fields[fieldId]);
  const value = field.relation!.cardinality === "many" ? [...new Set([...ids, targetId])] : targetId;
  await ctx.store.write([patchFieldMutation(ctx, record, fieldId, value)], { message: `Link ${object.labelSingular}` });
  return requireRecord(ctx.store, recordId);
}

export async function unlinkRecords(ctx: OpsContext, recordId: string, fieldId: string, targetId: string): Promise<CrmRecord> {
  assertCan(ctx, "records.write");
  const record = requireRecord(ctx.store, recordId);
  const ids = relationIds(record.fields[fieldId]).filter((id) => id !== targetId);
  const object = requireObject(ctx.store, record.object);
  const field = object.fields.find((f) => f.id === fieldId);
  if (!field || field.type !== "relation") throw new OpsError("invalid", `"${fieldId}" is not a relation field of ${object.labelPlural}.`);
  const value = field.relation!.cardinality === "many" ? (ids.length ? ids : undefined) : ids[0];
  await ctx.store.write([patchFieldMutation(ctx, record, fieldId, value)], { message: `Unlink ${object.labelSingular}` });
  return requireRecord(ctx.store, recordId);
}
