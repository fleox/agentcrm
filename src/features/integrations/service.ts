// Provider-neutral calls used by the UI: wraps src/ops/integrations with
// the browser tokens (auth.ts). No business rules here.

import type { CrmRecord } from "../../core/types";
import type { OpsContext } from "../../ops/context";
import {
  buildGmailQuery,
  contactQuery,
  gmailSearchMessages,
  gmailSend,
  googleListEvents,
  graphCalendarView,
  graphSearchMessages,
  graphSendViaDraft,
  logEmail,
  syncMeetings,
  type CalendarEvent,
  type EmailMessage,
  type IntegrationProvider,
  type OutgoingEmail,
  type SyncMeetingsResult,
  emailList,
} from "../../ops/integrations";
import { withToken } from "./auth";
import { connectedProviders, getStoredToken, type IntegrationSettings } from "./state";

const DAY = 86_400_000;
export const SYNC_PAST_DAYS = 30;
export const SYNC_FUTURE_DAYS = 30;

export function selfEmails(): string[] {
  return connectedProviders()
    .map((p) => getStoredToken(p)?.account)
    .filter((x): x is string => !!x);
}

export interface EmailSearchResult {
  messages: EmailMessage[];
  errors: { provider: IntegrationProvider; message: string }[];
}

export async function searchRecordEmails(ctx: OpsContext, record: CrmRecord, settings: IntegrationSettings, opts: { max?: number } = {}): Promise<EmailSearchResult> {
  const query = contactQuery(ctx, record);
  const out: EmailSearchResult = { messages: [], errors: [] };
  if (!query.emails.length && !query.domains.length) return out;
  const max = opts.max ?? 20;
  await Promise.all(
    connectedProviders().map(async (provider) => {
      try {
        const list =
          provider === "google"
            ? await withToken("google", settings, (t) => gmailSearchMessages(t, { q: buildGmailQuery(query), maxResults: max }))
            : await withToken("microsoft", settings, (t) => graphSearchMessages(t, { ...query, top: max }));
        out.messages.push(...list);
      } catch (err) {
        out.errors.push({ provider, message: (err as Error).message });
      }
    }),
  );
  out.messages.sort((a, b) => b.date - a.date);
  return out;
}

export async function sendEmail(
  ctx: OpsContext,
  provider: IntegrationProvider,
  email: OutgoingEmail,
  settings: IntegrationSettings,
  opts: { log: boolean; record?: CrmRecord },
): Promise<{ message: EmailMessage; logged: boolean }> {
  const sent =
    provider === "google"
      ? await withToken("google", settings, (t) => gmailSend(t, email))
      : await withToken("microsoft", settings, (t) => graphSendViaDraft(t, email));
  const account = getStoredToken(provider)?.account;
  const message: EmailMessage = {
    id: sent.id,
    ...(sent.threadId ? { threadId: sent.threadId } : {}),
    provider,
    from: account ? { email: account } : null,
    to: emailList(email.to),
    cc: emailList(email.cc),
    subject: email.subject,
    snippet: email.body.slice(0, 200),
    body: email.body,
    date: Date.now(),
  };
  if (!opts.log) return { message, logged: false };
  await logEmail(ctx, message, {
    direction: "outbound",
    selfEmails: selfEmails(),
    ...(opts.record ? { targets: [{ object: opts.record.object, id: opts.record.id }] } : {}),
  });
  return { message, logged: true };
}

export async function fetchEvents(provider: IntegrationProvider, settings: IntegrationSettings, from: number, to: number): Promise<CalendarEvent[]> {
  return provider === "google"
    ? withToken("google", settings, (t) => googleListEvents(t, { timeMin: from, timeMax: to }))
    : withToken("microsoft", settings, (t) => graphCalendarView(t, { start: from, end: to }));
}

// Past 30 + next 30 days, every connected provider. Idempotent.
export async function syncAllMeetings(
  ctx: OpsContext,
  settings: IntegrationSettings,
  opts: { now?: number; providers?: IntegrationProvider[] } = {},
): Promise<SyncMeetingsResult & { errors: string[] }> {
  const now = opts.now ?? Date.now();
  const total: SyncMeetingsResult & { errors: string[] } = { created: [], updated: [], unchanged: 0, skipped: 0, errors: [] };
  for (const provider of opts.providers ?? connectedProviders()) {
    try {
      const events = await fetchEvents(provider, settings, now - SYNC_PAST_DAYS * DAY, now + SYNC_FUTURE_DAYS * DAY);
      const r = await syncMeetings(ctx, events, { selfEmails: selfEmails() });
      total.created.push(...r.created);
      total.updated.push(...r.updated);
      total.unchanged += r.unchanged;
      total.skipped += r.skipped;
    } catch (err) {
      total.errors.push(`${provider}: ${(err as Error).message}`);
    }
  }
  return total;
}
