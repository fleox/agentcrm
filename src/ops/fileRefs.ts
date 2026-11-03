// Mutation helpers keeping file metadata (`files` collection) in sync
// with the records / activities they are attached to. Leaf module (only
// ./store) so records.ts, dedupe.ts and activities.ts can use it without
// import cycles. The business ops live in ./files.ts.

import type { FileMeta, FileTarget } from "../core/types";
import type { DocMutation } from "../data/types";
import type { OpsContext } from "./context";
import { activitiesOf, filesOf, objectsOf, recordsOf } from "./store";

export const sameTarget = (a: FileTarget, b: FileTarget) => a.kind === b.kind && a.id === b.id;

// Field ids of an object holding file references (image / files types).
export function fileFieldIds(ctx: OpsContext, objectId: string): string[] {
  const o = objectsOf(ctx.store).find((x) => x.id === objectId);
  return o ? o.fields.filter((f) => f.type === "image" || f.type === "files").map((f) => f.id) : [];
}

export function fileIdsIn(value: unknown): string[] {
  if (typeof value === "string" && value) return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && !!v);
  return [];
}

// Every file id referenced by a record field or an activity's attachments
// (soft-deleted ones included: they are restorable).
export function referencedFileIds(ctx: OpsContext): Set<string> {
  const out = new Set<string>();
  const byObject = new Map<string, string[]>();
  for (const r of recordsOf(ctx.store, undefined, { includeDeleted: true })) {
    let ids = byObject.get(r.object);
    if (!ids) byObject.set(r.object, (ids = fileFieldIds(ctx, r.object)));
    for (const f of ids) for (const id of fileIdsIn(r.fields[f])) out.add(id);
  }
  for (const a of activitiesOf(ctx.store, { includeDeleted: true })) for (const id of a.attachments ?? []) out.add(id);
  return out;
}

// Hard delete of records / activities: their files lose those targets;
// files left without any target are soft-deleted (purged by compact).
export function fileCleanupMutations(ctx: OpsContext, doomed: { records?: Iterable<string>; activities?: Iterable<string> }): DocMutation[] {
  const records = new Set(doomed.records ?? []);
  const activities = new Set(doomed.activities ?? []);
  if (!records.size && !activities.size) return [];
  const now = ctx.now();
  const out: DocMutation[] = [];
  for (const f of filesOf(ctx.store, { includeDeleted: true })) {
    const gone = (t: FileTarget) => (t.kind === "record" ? records.has(t.id) : activities.has(t.id));
    if (!f.targets.some(gone)) continue;
    const rest = f.targets.filter((t) => !gone(t));
    const fields: Record<string, unknown> = { targets: rest, updatedAt: now };
    if (!rest.length && !f.deletedAt) fields.deletedAt = now;
    out.push({ op: "patch", collection: "files", id: f.id, fields });
  }
  return out;
}

// Merge: files of the merged-away records now belong to the primary.
export function fileMergeMutations(ctx: OpsContext, duplicates: Iterable<string>, primary: { object: string; id: string }): DocMutation[] {
  const dup = new Set(duplicates);
  const now = ctx.now();
  const out: DocMutation[] = [];
  for (const f of filesOf(ctx.store, { includeDeleted: true })) {
    if (!f.targets.some((t) => t.kind === "record" && dup.has(t.id))) continue;
    const targets: FileTarget[] = [];
    for (const t of f.targets) {
      const next: FileTarget = t.kind === "record" && dup.has(t.id) ? { kind: "record", object: primary.object, id: primary.id } : t;
      if (!targets.some((x) => sameTarget(x, next))) targets.push(next);
    }
    out.push({ op: "patch", collection: "files", id: f.id, fields: { targets, updatedAt: now } });
  }
  return out;
}

// Patch adding / removing one target of a file (null when unchanged).
export function fileTargetPatch(ctx: OpsContext, file: FileMeta, add: FileTarget[], remove: FileTarget[] = []): DocMutation | null {
  let targets = file.targets.filter((t) => !remove.some((r) => sameTarget(r, t)));
  for (const t of add) if (!targets.some((x) => sameTarget(x, t))) targets = [...targets, t];
  if (targets.length === file.targets.length && targets.every((t, i) => sameTarget(t, file.targets[i]))) return null;
  return { op: "patch", collection: "files", id: file.id, fields: { targets, updatedAt: ctx.now() } };
}
