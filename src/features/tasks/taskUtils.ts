// Pure helpers for the tasks UI: due-date buckets, completion buckets and
// <input type="date|time"> conversions (local time).

import type { Activity } from "../../core/types";

export const DAY_MS = 86_400_000;
// Time used when a due date is set without a time (same as ops/activities.ts).
export const DEFAULT_DUE_TIME = "09:00";

export type DueGroup = "overdue" | "today" | "tomorrow" | "thisWeek" | "later" | "noDate";
export const DUE_GROUPS: DueGroup[] = ["overdue", "today", "tomorrow", "thisWeek", "later", "noDate"];

export type DoneGroup = "doneToday" | "doneYesterday" | "doneThisWeek" | "doneEarlier";
export const DONE_GROUPS: DoneGroup[] = ["doneToday", "doneYesterday", "doneThisWeek", "doneEarlier"];

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Calendar-day arithmetic that survives DST changes.
export function addDays(dayStart: number, n: number): number {
  const d = new Date(dayStart);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function isOverdue(task: Activity, now: number): boolean {
  return !task.doneAt && task.dueAt !== undefined && task.dueAt < now;
}

export function dueGroup(task: Activity, now: number): DueGroup {
  if (task.dueAt === undefined) return "noDate";
  if (task.dueAt < now) return "overdue";
  const today = startOfDay(now);
  if (task.dueAt < addDays(today, 1)) return "today";
  if (task.dueAt < addDays(today, 2)) return "tomorrow";
  if (task.dueAt < addDays(today, 7)) return "thisWeek";
  return "later";
}

export function doneGroup(task: Activity, now: number): DoneGroup {
  const at = task.doneAt ?? 0;
  const today = startOfDay(now);
  if (at >= today) return "doneToday";
  if (at >= addDays(today, -1)) return "doneYesterday";
  if (at >= addDays(today, -7)) return "doneThisWeek";
  return "doneEarlier";
}

export function compareByDue(a: Activity, b: Activity): number {
  return (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.createdAt - b.createdAt;
}

export function compareByDone(a: Activity, b: Activity): number {
  return (b.doneAt ?? 0) - (a.doneAt ?? 0);
}

export interface TaskSection<G extends string = string> {
  id: G;
  tasks: Activity[];
}

// Open tasks grouped by due date, done tasks by completion recency (empty
// groups dropped, order preserved).
export function groupTasks(tasks: Activity[], now: number): TaskSection<DueGroup | DoneGroup>[] {
  const open = new Map<DueGroup, Activity[]>();
  const done = new Map<DoneGroup, Activity[]>();
  for (const t of tasks) {
    if (t.doneAt) {
      const g = doneGroup(t, now);
      done.set(g, [...(done.get(g) ?? []), t]);
    } else {
      const g = dueGroup(t, now);
      open.set(g, [...(open.get(g) ?? []), t]);
    }
  }
  const out: TaskSection<DueGroup | DoneGroup>[] = [];
  for (const g of DUE_GROUPS) if (open.get(g)?.length) out.push({ id: g, tasks: open.get(g)!.sort(compareByDue) });
  for (const g of DONE_GROUPS) if (done.get(g)?.length) out.push({ id: g, tasks: done.get(g)!.sort(compareByDone) });
  return out;
}

// Flat order: open by due date, then done by completion (newest first).
export function sortTasks(tasks: Activity[]): Activity[] {
  const open = tasks.filter((t) => !t.doneAt).sort(compareByDue);
  const done = tasks.filter((t) => !!t.doneAt).sort(compareByDone);
  return [...open, ...done];
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toDateInput(ms: number | undefined): string {
  if (ms === undefined) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toTimeInput(ms: number | undefined): string {
  if (ms === undefined) return "";
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "2024-06-15" + "14:30" → epoch ms (local). Empty date → undefined.
export function fromDateTimeInputs(date: string, time?: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time && /^\d{2}:\d{2}$/.test(time) ? time : DEFAULT_DUE_TIME).split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

// Keeps the time of day of `previous` (or the default) on a new day.
export function withDay(dayStart: number, previous: number | undefined): number {
  return fromDateTimeInputs(toDateInput(dayStart), previous !== undefined ? toTimeInput(previous) : DEFAULT_DUE_TIME)!;
}

export function hasCustomTime(ms: number | undefined): boolean {
  return ms !== undefined && toTimeInput(ms) !== DEFAULT_DUE_TIME;
}
