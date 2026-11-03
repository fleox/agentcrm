// Activities: notes, tasks, calls, emails, meetings attached to records
// (`targets`), the record timeline, and task management.

import { newId } from "../core/ids";
import { paginate, type Page } from "../core/query";
import { ACTIVITY_TYPES, type Activity, type ActivityTarget, type ActivityType } from "../core/types";
import { actorId, assertCan, emit, OpsError, type OpsContext } from "./context";
import { relationFields, relationIds } from "./relations";
import { activitiesOf, asDoc, fileOf, objectsOf, recordOf, recordsOf, requireActivity, userOf } from "./store";
import { fileCleanupMutations, fileTargetPatch } from "./fileRefs";
import type { DocMutation } from "../data/types";

function normalizeAttachments(ctx: OpsContext, ids: string[] | undefined): string[] {
  const out: string[] = [];
  for (const id of ids ?? []) {
    const f = fileOf(ctx.store, id);
    if (!f || f.deletedAt) throw new OpsError("validation", `Attachment "${id}" not found (upload it first).`);
    if (!out.includes(f.id)) out.push(f.id);
  }
  return out;
}

// File metadata patches keeping `targets` in sync with an activity's attachments.
function attachmentTargetMutations(ctx: OpsContext, activityId: string, added: string[], removed: string[]): DocMutation[] {
  const out: DocMutation[] = [];
  const target = { kind: "activity" as const, id: activityId };
  for (const id of added) {
    const f = fileOf(ctx.store, id);
    const m = f && fileTargetPatch(ctx, f, [target]);
    if (m) out.push(m);
  }
  for (const id of removed) {
    const f = fileOf(ctx.store, id);
    const m = f && fileTargetPatch(ctx, f, [], [target]);
    if (m) out.push(m);
  }
  return out;
}

export interface ActivityInput {
  type: ActivityType;
  title: string;
  body?: string;
  targets?: ActivityTarget[];
  dueAt?: number | string | null;
  doneAt?: number | null;
  assigneeId?: string | null;
  meta?: Record<string, unknown>;
  // File ids (uploaded with ops/files.uploadFile) attached to the activity.
  attachments?: string[];
}

export interface ListActivitiesOptions {
  target?: ActivityTarget | string;
  // Also include activities of related records (company → its people and deals).
  includeRelated?: boolean;
  type?: ActivityType;
  types?: ActivityType[];
  assigneeId?: string;
  // Tasks only: open (not done) / done.
  status?: "open" | "done" | "all";
  dueBefore?: number;
  dueAfter?: number;
  since?: number;
  offset?: number;
  limit?: number;
  // "recent" (createdAt desc, timeline) | "due" (dueAt asc, tasks).
  order?: "recent" | "due";
  includeDeleted?: boolean;
}

function toMs(v: number | string | null | undefined): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T09:00:00` : v);
  if (Number.isNaN(t)) throw new OpsError("validation", `Invalid date "${v}".`);
  return t;
}

function normalizeTargets(ctx: OpsContext, targets: ActivityTarget[] | undefined): ActivityTarget[] {
  const out: ActivityTarget[] = [];
  for (const t of targets ?? []) {
    const id = typeof t === "string" ? t : t.id;
    const r = recordOf(ctx.store, id);
    if (!r || r.deletedAt) throw new OpsError("validation", `Target record "${id}" not found.`);
    if (!out.some((x) => x.id === r.id)) out.push({ object: r.object, id: r.id });
  }
  return out;
}

function checkAssignee(ctx: OpsContext, id: string | null | undefined): void {
  if (id && !userOf(ctx.store, id)) throw new OpsError("validation", `Unknown assignee "${id}".`);
}

// Record ids whose activities show on `targetId`'s timeline.
export function timelineScope(ctx: OpsContext, targetId: string, includeRelated: boolean): Set<string> {
  const ids = new Set([targetId]);
  if (!includeRelated) return ids;
  const target = recordOf(ctx.store, targetId);
  if (!target) return ids;
  for (const object of objectsOf(ctx.store)) {
    for (const field of relationFields(object)) {
      if (field.relation!.object !== target.object) continue;
      for (const r of recordsOf(ctx.store, object.id)) if (relationIds(r.fields[field.id]).includes(targetId)) ids.add(r.id);
    }
  }
  return ids;
}

export function listActivities(ctx: OpsContext, opts: ListActivitiesOptions = {}): Page<Activity> {
  assertCan(ctx, "activities.read");
  let items = activitiesOf(ctx.store, { includeDeleted: opts.includeDeleted });
  if (opts.target) {
    const targetId = typeof opts.target === "string" ? opts.target : opts.target.id;
    const scope = timelineScope(ctx, targetId, !!opts.includeRelated);
    items = items.filter((a) => a.targets.some((t) => scope.has(t.id)));
  }
  const types = opts.types ?? (opts.type ? [opts.type] : undefined);
  if (types) items = items.filter((a) => types.includes(a.type));
  if (opts.assigneeId) items = items.filter((a) => a.assigneeId === opts.assigneeId);
  if (opts.status === "open") items = items.filter((a) => !a.doneAt);
  if (opts.status === "done") items = items.filter((a) => !!a.doneAt);
  if (opts.dueBefore !== undefined) items = items.filter((a) => a.dueAt !== undefined && a.dueAt < opts.dueBefore!);
  if (opts.dueAfter !== undefined) items = items.filter((a) => a.dueAt !== undefined && a.dueAt >= opts.dueAfter!);
  if (opts.since !== undefined) items = items.filter((a) => a.createdAt >= opts.since!);
  if (opts.order === "due") {
    items = [...items].sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.createdAt - b.createdAt);
  } else {
    // Timeline: meetings / calls at their start time, others at creation.
    const at = (a: Activity) => (typeof a.meta?.startAt === "number" ? (a.meta.startAt as number) : a.createdAt);
    items = [...items].sort((a, b) => at(b) - at(a) || (a.id < b.id ? 1 : -1));
  }
  return paginate(items, { offset: opts.offset, limit: opts.limit });
}

export function getActivity(ctx: OpsContext, id: string): Activity {
  assertCan(ctx, "activities.read");
  return requireActivity(ctx.store, id);
}

export async function addActivity(ctx: OpsContext, input: ActivityInput, opts: { id?: string; silent?: boolean } = {}): Promise<Activity> {
  assertCan(ctx, "activities.write");
  if (!ACTIVITY_TYPES.includes(input.type)) throw new OpsError("validation", `Unknown activity type "${input.type}".`);
  const title = (input.title ?? "").trim() || (input.body ?? "").trim().split("\n")[0].slice(0, 80);
  if (!title) throw new OpsError("validation", "An activity needs a title.");
  checkAssignee(ctx, input.assigneeId);
  const attachments = normalizeAttachments(ctx, input.attachments);
  const now = ctx.now();
  const activity: Activity = {
    id: opts.id ?? newId(now),
    type: input.type,
    title,
    ...(input.body ? { body: input.body } : {}),
    targets: normalizeTargets(ctx, input.targets),
    ...(toMs(input.dueAt) !== undefined ? { dueAt: toMs(input.dueAt) } : {}),
    ...(input.doneAt ? { doneAt: input.doneAt } : {}),
    ...(input.assigneeId ? { assigneeId: input.assigneeId } : input.type === "task" && actorId(ctx) ? { assigneeId: actorId(ctx) } : {}),
    ...(input.meta ? { meta: input.meta } : {}),
    ...(attachments.length ? { attachments } : {}),
    createdAt: now,
    updatedAt: now,
    ...(actorId(ctx) ? { createdBy: actorId(ctx) } : {}),
  };
  await ctx.store.write([{ op: "set", collection: "activities", doc: asDoc(activity) }, ...attachmentTargetMutations(ctx, activity.id, attachments, [])], { message: `Add ${activity.type}` });
  const stored = requireActivity(ctx.store, activity.id);
  if (!opts.silent) await emit(ctx, "activity.created", { activity: stored });
  return stored;
}

export async function addNote(ctx: OpsContext, target: ActivityTarget | string, body: string, title?: string): Promise<Activity> {
  assertCan(ctx, "activities.write");
  const t = typeof target === "string" ? recordOf(ctx.store, target) : target;
  if (!t) throw new OpsError("notFound", `Record "${String(target)}" not found.`);
  return addActivity(ctx, { type: "note", title: title ?? "", body, targets: [{ object: t.object, id: t.id }] });
}

export interface TaskInput {
  title: string;
  body?: string;
  dueAt?: number | string | null;
  assigneeId?: string | null;
  targets?: ActivityTarget[];
}

export function createTask(ctx: OpsContext, input: TaskInput): Promise<Activity> {
  return addActivity(ctx, { type: "task", ...input });
}

export async function updateActivity(ctx: OpsContext, id: string, patch: Partial<ActivityInput>): Promise<Activity> {
  assertCan(ctx, "activities.write");
  const before = requireActivity(ctx.store, id);
  const fields: Record<string, unknown> = { updatedAt: ctx.now() };
  if (patch.title !== undefined) {
    if (!patch.title.trim()) throw new OpsError("validation", "An activity needs a title.");
    fields.title = patch.title.trim();
  }
  if (patch.body !== undefined) fields.body = patch.body || undefined;
  if (patch.type !== undefined) {
    if (!ACTIVITY_TYPES.includes(patch.type)) throw new OpsError("validation", `Unknown activity type "${patch.type}".`);
    fields.type = patch.type;
  }
  if (patch.targets !== undefined) fields.targets = normalizeTargets(ctx, patch.targets);
  if (patch.dueAt !== undefined) fields.dueAt = toMs(patch.dueAt);
  if (patch.doneAt !== undefined) fields.doneAt = patch.doneAt ?? undefined;
  if (patch.assigneeId !== undefined) {
    checkAssignee(ctx, patch.assigneeId);
    fields.assigneeId = patch.assigneeId ?? undefined;
  }
  if (patch.meta !== undefined) for (const [k, v] of Object.entries(patch.meta)) fields[`meta.${k}`] = v;
  const extra: DocMutation[] = [];
  if (patch.attachments !== undefined) {
    const prev = before.attachments ?? [];
    // Files already attached stay valid even if since soft-deleted elsewhere.
    const next = normalizeAttachments(ctx, patch.attachments.filter((x) => !prev.includes(x)));
    const kept = prev.filter((x) => patch.attachments!.includes(x));
    const all = [...kept, ...next];
    fields.attachments = all.length ? all : undefined;
    extra.push(...attachmentTargetMutations(ctx, id, next, prev.filter((x) => !all.includes(x))));
  }
  await ctx.store.write([{ op: "patch", collection: "activities", id, fields }, ...extra], { message: "Update activity" });
  const activity = requireActivity(ctx.store, id);
  await emit(ctx, "activity.updated", { activity, before });
  if (!before.doneAt && activity.doneAt) await emit(ctx, "activity.completed", { activity });
  return activity;
}

export function completeTask(ctx: OpsContext, id: string, done = true): Promise<Activity> {
  return updateActivity(ctx, id, { doneAt: done ? ctx.now() : null });
}

export async function deleteActivity(ctx: OpsContext, id: string, opts: { hard?: boolean } = {}): Promise<{ id: string }> {
  assertCan(ctx, "activities.write");
  requireActivity(ctx.store, id);
  await ctx.store.write(
    opts.hard
      ? [{ op: "delete", collection: "activities", id }, ...fileCleanupMutations(ctx, { activities: [id] })]
      : [{ op: "patch", collection: "activities", id, fields: { deletedAt: ctx.now(), updatedAt: ctx.now() } }],
    { message: "Delete activity" },
  );
  return { id };
}

export interface ListTasksOptions {
  assigneeId?: string;
  status?: "open" | "done" | "all";
  overdue?: boolean;
  dueWithinDays?: number;
  target?: string;
  limit?: number;
  offset?: number;
}

export function listTasks(ctx: OpsContext, opts: ListTasksOptions = {}): Page<Activity> {
  const now = ctx.now();
  return listActivities(ctx, {
    type: "task",
    assigneeId: opts.assigneeId,
    status: opts.status ?? "open",
    target: opts.target,
    dueBefore: opts.overdue ? now : opts.dueWithinDays !== undefined ? now + opts.dueWithinDays * 86_400_000 : undefined,
    order: "due",
    limit: opts.limit,
    offset: opts.offset,
  });
}

// Last activity time on a record (or its related records) — used by
// stale-deal detection and the inactivity trigger.
export function lastActivityAt(ctx: OpsContext, recordId: string): number | undefined {
  let max: number | undefined;
  for (const a of activitiesOf(ctx.store)) {
    if (!a.targets.some((t) => t.id === recordId)) continue;
    const at = Math.max(a.createdAt, a.doneAt ?? 0);
    if (max === undefined || at > max) max = at;
  }
  return max;
}
