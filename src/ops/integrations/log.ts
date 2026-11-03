// Email logging and meeting sync: turns provider messages / calendar
// events into "email" / "meeting" activities on the matched contacts.
// Idempotent through meta.provider + meta.externalId.

import { normalizeEmail } from "../../core/fields";
import type { Activity, ActivityTarget, CrmRecord } from "../../core/types";
import { addActivity, listActivities, updateActivity, type ActivityInput } from "../activities";
import { assertCan, OpsError, type OpsContext } from "../context";
import { activitiesOf, recordOf } from "../store";
import { matchContacts, recordDomain, recordEmails } from "./match";
import type { CalendarEvent, EmailDirection, EmailMessage, IntegrationProvider } from "./types";

// ─── Lookups ─────────────────────────────────────────────────────────────

export function findSyncedActivity(ctx: OpsContext, provider: IntegrationProvider, externalId: string, type?: "email" | "meeting"): Activity | undefined {
  assertCan(ctx, "activities.read");
  return activitiesOf(ctx.store).find(
    (a) => a.meta?.provider === provider && a.meta?.externalId === externalId && (!type || a.type === type),
  );
}

// externalIds already logged as email activities (for "Logged" badges).
export function loggedEmailIds(ctx: OpsContext, provider?: IntegrationProvider): Set<string> {
  assertCan(ctx, "activities.read");
  const out = new Set<string>();
  for (const a of activitiesOf(ctx.store)) {
    if (a.type !== "email" || typeof a.meta?.externalId !== "string") continue;
    if (provider && a.meta.provider !== provider) continue;
    out.add(`${String(a.meta.provider)}:${a.meta.externalId}`);
  }
  return out;
}

// What to search the mailbox for, for a record: people → their email
// addresses; companies → their domain + their people's addresses.
export function contactQuery(ctx: OpsContext, record: CrmRecord): { emails: string[]; domains: string[] } {
  assertCan(ctx, "records.read");
  if (record.object === "companies") {
    const domain = recordDomain(record);
    return { emails: [], domains: domain ? [domain] : [] };
  }
  return { emails: recordEmails(ctx, record), domains: [] };
}

// ─── Email logging ───────────────────────────────────────────────────────

export interface LogEmailOptions {
  // The mailbox owner's addresses: decides the direction and is never
  // matched as a contact.
  selfEmails?: string[];
  direction?: EmailDirection;
  // Extra targets always attached (e.g. the record the user is on).
  targets?: ActivityTarget[];
}

function participants(m: EmailMessage): string[] {
  return [m.from?.email, ...m.to.map((a) => a.email), ...m.cc.map((a) => a.email)].filter((x): x is string => !!x).map(normalizeEmail);
}

function addTarget(out: ActivityTarget[], t: ActivityTarget): void {
  if (!out.some((x) => x.id === t.id)) out.push({ object: t.object, id: t.id });
}

// Matched people + their companies + companies matched by domain.
export function targetsForEmails(ctx: OpsContext, emails: string[], extra: ActivityTarget[] = []): ActivityTarget[] {
  const match = matchContacts(ctx, emails);
  const out: ActivityTarget[] = [];
  for (const t of extra) {
    const r = recordOf(ctx.store, t.id);
    if (r && !r.deletedAt) addTarget(out, { object: r.object, id: r.id });
  }
  for (const p of match.people) {
    addTarget(out, { object: "people", id: p.id });
    const companyId = typeof p.fields.company === "string" ? p.fields.company : undefined;
    const company = companyId ? recordOf(ctx.store, companyId) : undefined;
    if (company && !company.deletedAt) addTarget(out, { object: company.object, id: company.id });
  }
  for (const c of match.companies) addTarget(out, { object: "companies", id: c.id });
  return out;
}

export function emailDirection(message: EmailMessage, opts: LogEmailOptions, ctx?: OpsContext): EmailDirection {
  if (opts.direction) return opts.direction;
  const self = new Set((opts.selfEmails ?? []).map(normalizeEmail));
  const from = message.from?.email ? normalizeEmail(message.from.email) : "";
  if (self.size) return from && self.has(from) ? "outbound" : "inbound";
  if (ctx && from && matchContacts(ctx, [from]).people.length) return "inbound";
  return "outbound";
}

export function emailToActivityInput(ctx: OpsContext, message: EmailMessage, opts: LogEmailOptions = {}): ActivityInput {
  const self = new Set((opts.selfEmails ?? []).map(normalizeEmail));
  const emails = participants(message).filter((e) => !self.has(e));
  const targets = targetsForEmails(ctx, emails, opts.targets);
  const meta: Record<string, unknown> = {
    provider: message.provider,
    externalId: message.id,
    ...(message.threadId ? { threadId: message.threadId } : {}),
    from: message.from?.email ?? "",
    ...(message.from?.name ? { fromName: message.from.name } : {}),
    to: message.to.map((a) => a.email),
    cc: message.cc.map((a) => a.email),
    subject: message.subject,
    direction: emailDirection(message, opts, ctx),
    date: message.date,
    ...(message.internetMessageId ? { internetMessageId: message.internetMessageId } : {}),
    ...(message.url ? { url: message.url } : {}),
  };
  const body = (message.body ?? message.snippet ?? "").trim();
  return {
    type: "email",
    title: message.subject.trim() || "(no subject)",
    ...(body ? { body: body.length > 20_000 ? `${body.slice(0, 20_000)}…` : body } : {}),
    targets,
    meta,
  };
}

export interface LogEmailResult {
  activity: Activity;
  created: boolean;
}

export async function logEmail(ctx: OpsContext, message: EmailMessage, opts: LogEmailOptions = {}): Promise<LogEmailResult> {
  assertCan(ctx, "activities.write");
  const existing = findSyncedActivity(ctx, message.provider, message.id, "email");
  if (existing) return { activity: existing, created: false };
  const input = emailToActivityInput(ctx, message, opts);
  if (!input.targets?.length) throw new OpsError("validation", "No CRM contact matches this email's participants.");
  const activity = await addActivity(ctx, input);
  return { activity, created: true };
}

// ─── Meeting sync ────────────────────────────────────────────────────────

export interface SyncMeetingsOptions {
  selfEmails?: string[];
  // Also attach these records (e.g. the record the sync was started from).
  targets?: ActivityTarget[];
  // Create meetings even when no attendee matches a contact, as long as
  // `targets` is set (default false: unmatched events are skipped).
  includeUnmatched?: boolean;
}

export interface SyncMeetingsResult {
  created: Activity[];
  updated: Activity[];
  unchanged: number;
  skipped: number;
}

function meetingMeta(event: CalendarEvent): Record<string, unknown> {
  return {
    provider: event.provider,
    externalId: event.id,
    startAt: event.start,
    endAt: event.end,
    attendees: event.attendees.map((a) => a.email),
    ...(event.location ? { location: event.location } : {}),
    ...(event.url ? { url: event.url } : {}),
    ...(event.allDay ? { allDay: true } : {}),
    ...(event.organizer ? { organizer: event.organizer } : {}),
  };
}

export async function syncMeetings(ctx: OpsContext, events: CalendarEvent[], opts: SyncMeetingsOptions = {}): Promise<SyncMeetingsResult> {
  assertCan(ctx, "activities.write");
  const self = new Set((opts.selfEmails ?? []).map(normalizeEmail));
  const result: SyncMeetingsResult = { created: [], updated: [], unchanged: 0, skipped: 0 };
  for (const event of events) {
    if (!Number.isFinite(event.start)) {
      result.skipped++;
      continue;
    }
    const existing = findSyncedActivity(ctx, event.provider, event.id, "meeting");
    if (event.cancelled) {
      if (existing && !existing.meta?.cancelled) result.updated.push(await updateActivity(ctx, existing.id, { meta: { cancelled: true } }));
      else result.skipped++;
      continue;
    }
    const emails = event.attendees.map((a) => normalizeEmail(a.email)).filter((e) => e && !self.has(e));
    const matched = targetsForEmails(ctx, emails);
    const extra = targetsForEmails(ctx, [], opts.targets);
    if (!existing) {
      if (!matched.length && !(opts.includeUnmatched && extra.length)) {
        result.skipped++;
        continue;
      }
      const targets = [...extra];
      for (const t of matched) addTarget(targets, t);
      result.created.push(
        await addActivity(ctx, {
          type: "meeting",
          title: event.title,
          ...(event.description ? { body: event.description.slice(0, 20_000) } : {}),
          targets,
          meta: meetingMeta(event),
        }),
      );
      continue;
    }
    // Existing: refresh times / title / location / attendees / targets.
    const meta = meetingMeta(event);
    const changedMeta: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(meta)) if (JSON.stringify(existing.meta?.[k]) !== JSON.stringify(v)) changedMeta[k] = v;
    const targets = existing.targets.map((t) => ({ ...t }));
    for (const t of matched) addTarget(targets, t);
    const patch: Partial<ActivityInput> = {};
    if (Object.keys(changedMeta).length) patch.meta = changedMeta;
    if (existing.title !== event.title) patch.title = event.title;
    if (targets.length !== existing.targets.length) patch.targets = targets;
    if (!Object.keys(patch).length) {
      result.unchanged++;
      continue;
    }
    result.updated.push(await updateActivity(ctx, existing.id, patch));
  }
  return result;
}

// Meeting activities on a record (and, for companies, its people)
// starting at or after `from` (default now), soonest first.
export function upcomingMeetings(ctx: OpsContext, recordId: string, opts: { from?: number; limit?: number } = {}): Activity[] {
  const from = opts.from ?? ctx.now();
  return listActivities(ctx, { target: recordId, includeRelated: true, type: "meeting" })
    .items.filter((a) => typeof a.meta?.startAt === "number" && (a.meta.endAt as number | undefined ?? (a.meta.startAt as number)) >= from && !a.meta?.cancelled)
    .sort((a, b) => (a.meta!.startAt as number) - (b.meta!.startAt as number))
    .slice(0, opts.limit ?? 10);
}
