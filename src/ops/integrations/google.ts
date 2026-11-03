// Gmail + Google Calendar REST clients and mappers. Each client takes a
// Google OAuth access token (from the Google Identity Services token
// client, see src/features/integrations/) and an optional fetch.

import { base64UrlDecode, buildGmailRaw, decodeHeaderValue, htmlToText, parseAddress, parseAddressList, type OutgoingEmail } from "./mime";
import { defaultFetch, requestJson, type CalendarEvent, type EmailMessage, type FetchLike } from "./types";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
];

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR = "https://www.googleapis.com/calendar/v3";

// ─── Gmail JSON shapes (subset) ──────────────────────────────────────────

export interface GmailHeader {
  name: string;
  value: string;
}
export interface GmailPart {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}
export interface GmailMessageJson {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

function header(headers: GmailHeader[] | undefined, name: string): string | undefined {
  const h = headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value;
}

function decodeEntities(s: string): string {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function findPart(part: GmailPart | undefined, mime: string): GmailPart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mime && part.body?.data) return part;
  for (const p of part.parts ?? []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return undefined;
}

export function gmailBodyText(payload: GmailPart | undefined): string | undefined {
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) return base64UrlDecode(plain.body.data).replace(/\r\n/g, "\n").trim();
  const html = findPart(payload, "text/html");
  if (html?.body?.data) return htmlToText(base64UrlDecode(html.body.data));
  return undefined;
}

export function mapGmailMessage(json: GmailMessageJson): EmailMessage {
  const headers = json.payload?.headers;
  const dateHeader = header(headers, "Date");
  const internal = json.internalDate ? Number(json.internalDate) : NaN;
  const parsed = dateHeader ? Date.parse(dateHeader) : NaN;
  const body = gmailBodyText(json.payload);
  return {
    id: json.id,
    ...(json.threadId ? { threadId: json.threadId } : {}),
    provider: "google",
    from: parseAddress(header(headers, "From") ?? ""),
    to: parseAddressList(header(headers, "To")),
    cc: parseAddressList(header(headers, "Cc")),
    subject: decodeHeaderValue(header(headers, "Subject") ?? "").trim(),
    snippet: decodeEntities(json.snippet ?? ""),
    date: Number.isFinite(internal) ? internal : Number.isFinite(parsed) ? parsed : 0,
    ...(body ? { body } : {}),
    ...(header(headers, "Message-ID") || header(headers, "Message-Id") ? { internetMessageId: header(headers, "Message-ID") ?? header(headers, "Message-Id") } : {}),
    url: `https://mail.google.com/mail/u/0/#all/${json.id}`,
    ...(json.labelIds ? { labels: json.labelIds } : {}),
  };
}

// Gmail search query for a set of addresses and/or domains.
export function buildGmailQuery(opts: { emails?: string[]; domains?: string[] }): string {
  const terms: string[] = [];
  for (const e of opts.emails ?? []) if (e) terms.push(`from:${e}`, `to:${e}`, `cc:${e}`);
  for (const d of opts.domains ?? []) if (d) terms.push(`from:*@${d}`, `to:*@${d}`);
  return terms.join(" OR ");
}

// ─── Gmail client ────────────────────────────────────────────────────────

function auth(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra };
}

export async function gmailListMessageIds(
  token: string,
  opts: { q?: string; maxResults?: number; pageToken?: string } = {},
  fetchImpl: FetchLike = defaultFetch,
): Promise<{ ids: { id: string; threadId?: string }[]; nextPageToken?: string }> {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  params.set("maxResults", String(opts.maxResults ?? 20));
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  const data = await requestJson<{ messages?: { id: string; threadId?: string }[]; nextPageToken?: string }>("google", fetchImpl, `${GMAIL}/messages?${params}`, {
    headers: auth(token),
  });
  return { ids: data?.messages ?? [], ...(data?.nextPageToken ? { nextPageToken: data.nextPageToken } : {}) };
}

export async function gmailGetMessage(
  token: string,
  id: string,
  opts: { format?: "metadata" | "full" } = {},
  fetchImpl: FetchLike = defaultFetch,
): Promise<EmailMessage> {
  const params = new URLSearchParams({ format: opts.format ?? "metadata" });
  if ((opts.format ?? "metadata") === "metadata") for (const h of ["From", "To", "Cc", "Subject", "Date", "Message-ID"]) params.append("metadataHeaders", h);
  const json = await requestJson<GmailMessageJson>("google", fetchImpl, `${GMAIL}/messages/${encodeURIComponent(id)}?${params}`, { headers: auth(token) });
  return mapGmailMessage(json);
}

// list + get (metadata) — most recent first.
export async function gmailSearchMessages(
  token: string,
  opts: { q: string; maxResults?: number; format?: "metadata" | "full" },
  fetchImpl: FetchLike = defaultFetch,
): Promise<EmailMessage[]> {
  if (!opts.q) return [];
  const { ids } = await gmailListMessageIds(token, { q: opts.q, maxResults: opts.maxResults }, fetchImpl);
  const messages = await Promise.all(ids.map((m) => gmailGetMessage(token, m.id, { format: opts.format }, fetchImpl)));
  return messages.sort((a, b) => b.date - a.date);
}

export async function gmailProfile(token: string, fetchImpl: FetchLike = defaultFetch): Promise<{ emailAddress: string }> {
  return requestJson<{ emailAddress: string }>("google", fetchImpl, `${GMAIL}/profile`, { headers: auth(token) });
}

export async function gmailSend(
  token: string,
  email: OutgoingEmail & { threadId?: string },
  fetchImpl: FetchLike = defaultFetch,
): Promise<{ id: string; threadId?: string }> {
  const raw = buildGmailRaw(email);
  return requestJson<{ id: string; threadId?: string }>("google", fetchImpl, `${GMAIL}/messages/send`, {
    method: "POST",
    headers: auth(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ raw, ...(email.threadId ? { threadId: email.threadId } : {}) }),
  });
}

// ─── Google Calendar ─────────────────────────────────────────────────────

export interface GoogleEventJson {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; responseStatus?: string; organizer?: boolean; self?: boolean; resource?: boolean }[];
  organizer?: { email?: string };
}

function googleTime(t: { dateTime?: string; date?: string } | undefined): { ms: number; allDay: boolean } {
  if (t?.dateTime) return { ms: Date.parse(t.dateTime), allDay: false };
  if (t?.date) {
    const [y, m, d] = t.date.split("-").map(Number);
    return { ms: new Date(y, m - 1, d).getTime(), allDay: true };
  }
  return { ms: NaN, allDay: false };
}

export function mapGoogleEvent(json: GoogleEventJson): CalendarEvent {
  const start = googleTime(json.start);
  const end = googleTime(json.end);
  return {
    id: json.id,
    provider: "google",
    title: (json.summary ?? "").trim() || "(no title)",
    start: start.ms,
    end: Number.isFinite(end.ms) ? end.ms : start.ms,
    ...(start.allDay ? { allDay: true } : {}),
    attendees: (json.attendees ?? [])
      .filter((a) => a.email && !a.resource)
      .map((a) => ({
        email: a.email!.toLowerCase(),
        ...(a.displayName ? { name: a.displayName } : {}),
        ...(a.responseStatus ? { response: a.responseStatus } : {}),
        ...(a.organizer ? { organizer: true } : {}),
      })),
    ...(json.location ? { location: json.location } : {}),
    ...(json.htmlLink || json.hangoutLink ? { url: json.htmlLink ?? json.hangoutLink } : {}),
    ...(json.description ? { description: json.description } : {}),
    ...(json.status === "cancelled" ? { cancelled: true } : {}),
    ...(json.organizer?.email ? { organizer: json.organizer.email.toLowerCase() } : {}),
  };
}

export async function googleListEvents(
  token: string,
  opts: { timeMin: number; timeMax?: number; maxResults?: number; calendarId?: string; q?: string },
  fetchImpl: FetchLike = defaultFetch,
): Promise<CalendarEvent[]> {
  const out: CalendarEvent[] = [];
  let pageToken: string | undefined;
  const max = opts.maxResults ?? 250;
  do {
    const params = new URLSearchParams({
      timeMin: new Date(opts.timeMin).toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(Math.min(250, max)),
    });
    if (opts.timeMax !== undefined) params.set("timeMax", new Date(opts.timeMax).toISOString());
    if (opts.q) params.set("q", opts.q);
    if (pageToken) params.set("pageToken", pageToken);
    const data = await requestJson<{ items?: GoogleEventJson[]; nextPageToken?: string }>(
      "google",
      fetchImpl,
      `${CALENDAR}/calendars/${encodeURIComponent(opts.calendarId ?? "primary")}/events?${params}`,
      { headers: auth(token) },
    );
    for (const e of data?.items ?? []) out.push(mapGoogleEvent(e));
    pageToken = data?.nextPageToken;
  } while (pageToken && out.length < max);
  return out.slice(0, max);
}
