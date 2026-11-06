// Mirror of an external source into one object: rows matched by a key field
// (an id from the source system), created / updated only where a value
// differs, records whose key left the source flagged in an archive field
// (never deleted: notes, tasks and deals may hang on them). Relation values
// point at other mirrored objects by THEIR key: { "$key": "12" } or
// { "$key": ["12", "13"] }, resolved against the related object's key field.
// A reference that matches no record leaves that relation as it is (for a
// `many` relation: if any id is unresolved, the whole value is kept) and is
// listed in `unresolvedRefs`; an explicit null / [] / "" still clears.
// New records carry the same stamps as createRecord (createdBy, updatedBy,
// fieldUpdates) for a known actor. One store write, no automation fires
// (bulk mirror, not user activity).

import { recordLabel } from "../core/fields";
import type { CrmRecord, FieldDef, ObjectDef } from "../core/types";
import { newId } from "../core/ids";
import type { DocMutation } from "../data/types";
import { assertCan, OpsError, type OpsContext } from "./context";
import { creationStamps, prepareRecordFields, recordPatchMutation } from "./records";
import { asDoc, recordsOf, requireObject } from "./store";

export interface SyncRow {
  key: string;
  fields: Record<string, unknown>;
}

export interface SyncSpec {
  object: string;
  // Field holding the source id (text, ideally unique).
  key: string;
  rows: SyncRow[];
  // Boolean field set to true on records whose key is not in `rows` (and
  // back to false when it reappears). Omitted: such records are left alone.
  archiveField?: string;
  // Key field of the related objects (default: same id as `key`).
  refKey?: string;
}

export interface SyncReport {
  object: string;
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
  archived: number;
  // Relation references with no matching record (sync that object first):
  // `unresolved` counts the keys, `unresolvedRefs` lists them per row and
  // field (the relation was left unchanged on that row).
  unresolved: number;
  unresolvedRefs: Array<{ key: string; field: string; refs: string[] }>;
  errors: Array<{ key: string; message: string }>;
  samples: { created: string[]; updated: Array<{ key: string; fields: string[] }>; archived: string[] };
}

const SAMPLE = 10;

function isRef(v: unknown): v is { $key: unknown } {
  return !!v && typeof v === "object" && !Array.isArray(v) && "$key" in (v as Record<string, unknown>);
}

export async function syncRecords(ctx: OpsContext, spec: SyncSpec): Promise<SyncReport> {
  assertCan(ctx, "records.write");
  const object: ObjectDef = requireObject(ctx.store, spec.object);
  const keyField = object.fields.find((f) => f.id === spec.key);
  if (!keyField) throw new OpsError("validation", `${object.labelPlural} has no field "${spec.key}" (the key).`);
  const archive: FieldDef | undefined = spec.archiveField ? object.fields.find((f) => f.id === spec.archiveField) : undefined;
  if (spec.archiveField && archive?.type !== "boolean") throw new OpsError("validation", `--archive-field must be a boolean field of ${object.labelPlural}.`);
  const refKey = spec.refKey ?? spec.key;

  const report: SyncReport = { object: object.id, rows: 0, created: 0, updated: 0, unchanged: 0, archived: 0, unresolved: 0, unresolvedRefs: [], errors: [], samples: { created: [], updated: [], archived: [] } };

  // Last row wins for a duplicated key.
  const rows = new Map<string, Record<string, unknown>>();
  for (const r of spec.rows) {
    const key = String(r?.key ?? "").trim();
    if (key) rows.set(key, r.fields ?? {});
  }
  report.rows = rows.size;

  const byKey = (objectId: string, field: string) => {
    const m = new Map<string, string>();
    for (const r of recordsOf(ctx.store, objectId)) {
      const v = r.fields[field];
      if (v !== undefined && v !== null && v !== "") m.set(String(v), r.id);
    }
    return m;
  };
  const existing = new Map<string, CrmRecord>();
  for (const r of recordsOf(ctx.store, object.id)) {
    const v = r.fields[spec.key];
    if (v !== undefined && v !== null && v !== "") existing.set(String(v), r);
  }
  const refMaps = new Map<string, Map<string, string>>();
  // KEEP = some key matched nothing: the row leaves this relation unchanged.
  const KEEP = Symbol("keep");
  const resolve = (rowKey: string, field: FieldDef, value: { $key: unknown }): unknown => {
    const target = field.relation?.object;
    if (!target) throw new OpsError("validation", `${field.label} is not a relation: { "$key": … } only fits relation fields.`);
    if (!refMaps.has(target)) refMaps.set(target, byKey(target, refKey));
    const map = refMaps.get(target)!;
    const keys = (Array.isArray(value.$key) ? value.$key : [value.$key])
      .filter((k) => k !== null && k !== undefined && String(k).trim() !== "")
      .map((k) => String(k).trim());
    const missing = keys.filter((k) => !map.has(k));
    if (missing.length) {
      report.unresolved += missing.length;
      report.unresolvedRefs.push({ key: rowKey, field: field.id, refs: missing });
      return KEEP;
    }
    const ids = keys.map((k) => map.get(k)!);
    return field.relation?.cardinality === "many" ? ids : ids[0] ?? null;
  };

  const mutations: DocMutation[] = [];
  const now = ctx.now();
  for (const [key, raw] of rows) {
    try {
      const input: Record<string, unknown> = { [spec.key]: key };
      for (const [fieldId, v] of Object.entries(raw)) {
        const field = object.fields.find((f) => f.id === fieldId);
        const value = field && isRef(v) ? resolve(key, field, v) : v;
        if (value !== KEEP) input[fieldId] = value;
      }
      if (archive) input[archive.id] = false;
      const previous = existing.get(key) ?? null;
      const prepared = prepareRecordFields(ctx, object, input, previous, { unknownFields: "error" });
      if (previous) {
        if (!prepared.changed.length) {
          report.unchanged++;
          continue;
        }
        mutations.push(recordPatchMutation(ctx, previous, prepared.fields, prepared.changed));
        report.updated++;
        if (report.samples.updated.length < SAMPLE) report.samples.updated.push({ key, fields: prepared.changed });
      } else {
        const record: CrmRecord = { id: newId(now), object: object.id, fields: prepared.fields, createdAt: now, updatedAt: now, ...creationStamps(ctx, prepared.fields, now) };
        mutations.push({ op: "set", collection: "records", doc: asDoc(record) });
        report.created++;
        if (report.samples.created.length < SAMPLE) report.samples.created.push(`${key} ${recordLabel(object, record)}`);
      }
    } catch (err) {
      report.errors.push({ key, message: (err as Error).message });
    }
  }

  if (archive) {
    for (const [key, r] of existing) {
      if (rows.has(key) || r.fields[archive.id] === true) continue;
      mutations.push(recordPatchMutation(ctx, r, { [archive.id]: true }, [archive.id]));
      report.archived++;
      if (report.samples.archived.length < SAMPLE) report.samples.archived.push(`${key} ${recordLabel(object, r)}`);
    }
  }

  if (mutations.length) await ctx.store.write(mutations, { message: `Sync ${object.labelPlural}: ${report.created} new, ${report.updated} updated, ${report.archived} archived` });
  return report;
}
