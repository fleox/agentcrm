// Duplicate detection and merge. People match on email, companies on
// domain, every object on a normalised label. Merging keeps the primary
// record, fills its empty fields from the duplicates (arrays are united),
// repoints every relation and activity to it, then hard-deletes the
// duplicates — in ONE write.

import { isEmptyFieldValue, normalizeDomain, normalizeEmail, recordLabel } from "../core/fields";
import type { CrmRecord, ObjectDef } from "../core/types";
import type { DocMutation } from "../data/types";
import { actorId, assertCan, emit, OpsError, type OpsContext } from "./context";
import { rewriteReferences } from "./relations";
import { activitiesOf, asDoc, recordsOf, requireObject, requireRecord } from "./store";

export interface DuplicateGroup {
  reason: "email" | "domain" | "name" | "phone";
  key: string;
  records: { id: string; label: string; updatedAt: number }[];
}

function normLabel(s: unknown): string {
  return typeof s === "string"
    ? s
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\b(inc|llc|ltd|sas|sarl|gmbh|corp|corporation|co)\b\.?/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
    : "";
}

export function findDuplicates(ctx: OpsContext, objectId: string, opts: { by?: DuplicateGroup["reason"][] } = {}): DuplicateGroup[] {
  assertCan(ctx, "records.read");
  const object = requireObject(ctx.store, objectId);
  const has = (id: string) => object.fields.some((f) => f.id === id);
  const by = opts.by ?? [...(has("email") ? ["email" as const] : []), ...(has("domain") ? ["domain" as const] : []), "name" as const];
  const records = recordsOf(ctx.store, objectId);
  const groups: DuplicateGroup[] = [];
  const grouped = new Set<string>();
  for (const reason of by) {
    const buckets = new Map<string, CrmRecord[]>();
    for (const r of records) {
      const key =
        reason === "email"
          ? normalizeEmail(r.fields.email)
          : reason === "domain"
            ? normalizeDomain(r.fields.domain)
            : reason === "phone"
              ? String(r.fields.phone ?? "").replace(/[^\d]/g, "").slice(-9)
              : normLabel(recordLabel(object, r));
      if (!key || (reason === "phone" && key.length < 6)) continue;
      const list = buckets.get(key) ?? [];
      list.push(r);
      buckets.set(key, list);
    }
    for (const [key, list] of buckets) {
      if (list.length < 2) continue;
      const sig = list.map((r) => r.id).sort().join(",");
      if (grouped.has(sig)) continue;
      grouped.add(sig);
      groups.push({
        reason,
        key,
        records: list.sort((a, b) => b.updatedAt - a.updatedAt).map((r) => ({ id: r.id, label: recordLabel(object, r), updatedAt: r.updatedAt })),
      });
    }
  }
  return groups;
}

export interface MergeOptions {
  // fieldId → id of the record whose value wins (default: primary, then
  // the most recently updated duplicate with a value).
  pick?: Record<string, string>;
}

export interface MergeResult {
  record: CrmRecord;
  merged: string[];
  movedActivities: number;
  rewiredReferences: number;
}

function mergedFields(object: ObjectDef, primary: CrmRecord, others: CrmRecord[], pick: Record<string, string>): Record<string, unknown> {
  const all = [primary, ...[...others].sort((a, b) => b.updatedAt - a.updatedAt)];
  const out: Record<string, unknown> = { ...primary.fields };
  for (const field of object.fields) {
    const chosen = pick[field.id];
    if (chosen) {
      const src = all.find((r) => r.id === chosen);
      if (src) {
        if (isEmptyFieldValue(field, src.fields[field.id])) delete out[field.id];
        else out[field.id] = src.fields[field.id];
      }
      continue;
    }
    const isArray = field.type === "tags" || field.type === "multiSelect" || (field.type === "relation" && field.relation?.cardinality === "many");
    if (isArray) {
      const union = [...new Set(all.flatMap((r) => (Array.isArray(r.fields[field.id]) ? (r.fields[field.id] as unknown[]) : [])))];
      if (union.length) out[field.id] = union;
      continue;
    }
    if (isEmptyFieldValue(field, out[field.id])) {
      const donor = all.find((r) => !isEmptyFieldValue(field, r.fields[field.id]));
      if (donor) out[field.id] = donor.fields[field.id];
    }
  }
  return out;
}

export async function mergeRecords(ctx: OpsContext, primaryId: string, duplicateIds: string[], opts: MergeOptions = {}): Promise<MergeResult> {
  assertCan(ctx, "records.write");
  assertCan(ctx, "records.delete");
  const primary = requireRecord(ctx.store, primaryId);
  const ids = [...new Set(duplicateIds)].filter((id) => id !== primaryId);
  if (!ids.length) throw new OpsError("validation", "Nothing to merge: give at least one other record.");
  const others = ids.map((id) => requireRecord(ctx.store, id));
  for (const o of others) if (o.object !== primary.object) throw new OpsError("validation", `Can't merge a ${o.object} record into a ${primary.object} record.`);
  const object = requireObject(ctx.store, primary.object);
  const fields = mergedFields(object, primary, others, opts.pick ?? {});
  // Self-references between merged records would point at the primary itself.
  for (const f of object.fields) {
    if (f.type !== "relation" || f.relation?.object !== object.id) continue;
    const v = fields[f.id];
    if (Array.isArray(v)) {
      const rest = v.filter((x) => x !== primaryId && !ids.includes(x as string));
      if (rest.length) fields[f.id] = rest;
      else delete fields[f.id];
    } else if (v === primaryId || ids.includes(v as string)) delete fields[f.id];
  }
  const now = ctx.now();
  const record: CrmRecord = {
    ...primary,
    fields,
    ownerId: primary.ownerId ?? others.find((o) => o.ownerId)?.ownerId,
    createdAt: Math.min(primary.createdAt, ...others.map((o) => o.createdAt)),
    updatedAt: now,
    ...(actorId(ctx) ? { updatedBy: actorId(ctx) } : {}),
  };
  if (!record.ownerId) delete record.ownerId;
  const refs = rewriteReferences(ctx, ids, primaryId);
  const mutations: DocMutation[] = [{ op: "set", collection: "records", doc: asDoc(record) }, ...refs];
  let movedActivities = 0;
  const doomed = new Set(ids);
  for (const a of activitiesOf(ctx.store, { includeDeleted: true })) {
    if (!a.targets.some((t) => doomed.has(t.id))) continue;
    movedActivities++;
    const targets = a.targets.map((t) => (doomed.has(t.id) ? { object: primary.object, id: primaryId } : t));
    const unique = targets.filter((t, i) => targets.findIndex((x) => x.id === t.id) === i);
    mutations.push({ op: "patch", collection: "activities", id: a.id, fields: { targets: unique, updatedAt: now } });
  }
  for (const id of ids) mutations.push({ op: "delete", collection: "records", id });
  await ctx.store.write(mutations, { message: `Merge ${ids.length + 1} ${object.labelPlural}` });
  const stored = requireRecord(ctx.store, primaryId);
  await emit(ctx, "record.updated", { record: stored, before: primary, changed: Object.keys(fields).filter((k) => JSON.stringify(fields[k]) !== JSON.stringify(primary.fields[k])) });
  for (const o of others) await emit(ctx, "record.deleted", { record: o, hard: true });
  return { record: stored, merged: ids, movedActivities, rewiredReferences: refs.length };
}
