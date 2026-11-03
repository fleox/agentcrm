// Microsoft Graph (Outlook mail + calendar) clients and mappers, plus the
// pure parts of the authorization-code + PKCE flow for a SPA public
// client (no client secret). The popup itself lives in
// src/features/integrations/.

import { emailList, htmlToText, type OutgoingEmail } from "./mime";
import { defaultFetch, IntegrationApiError, requestJson, type CalendarEvent, type EmailAddress, type EmailMessage, type FetchLike } from "./types";
import { base64UrlEncode } from "./mime";

export const MICROSOFT_SCOPES = ["openid", "profile", "email", "offline_access", "User.Read", "Mail.Read", "Mail.Send", "Calendars.Read"];
const GRAPH = "https://graph.microsoft.com/v1.0";

// ─── OAuth (authorization code + PKCE) ───────────────────────────────────

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export async function createPkcePair(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): Promise<PkcePair> {
  const verifier = base64UrlEncode(random(32));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge: base64UrlEncode(digest) };
}

export function microsoftAuthority(tenant?: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent((tenant ?? "").trim() || "common")}/oauth2/v2.0`;
}

export function buildMicrosoftAuthorizeUrl(opts: {
  clientId: string;
  tenant?: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string[];
  loginHint?: string;
  prompt?: "select_account" | "login" | "consent" | "none";
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: "code",
    redirect_uri: opts.redirectUri,
    response_mode: "query",
    scope: (opts.scopes ?? MICROSOFT_SCOPES).join(" "),
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    prompt: opts.prompt ?? "select_account",
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `${microsoftAuthority(opts.tenant)}/authorize?${params}`;
}

export interface MicrosoftTokens {
  accessToken: string;
  // Epoch ms.
  expiresAt: number;
  refreshToken?: string;
  scope?: string;
}

async function tokenRequest(tenant: string | undefined, body: Record<string, string>, fetchImpl: FetchLike, now: number): Promise<MicrosoftTokens> {
  const data = await requestJson<{ access_token: string; expires_in: number; refresh_token?: string; scope?: string }>(
    "microsoft",
    fetchImpl,
    `${microsoftAuthority(tenant)}/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() },
  );
  if (!data?.access_token) throw new IntegrationApiError("microsoft", 400, "No access token in the token response.");
  return {
    accessToken: data.access_token,
    expiresAt: now + (Number(data.expires_in) || 3600) * 1000,
    ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
    ...(data.scope ? { scope: data.scope } : {}),
  };
}

export function exchangeMicrosoftCode(
  opts: { clientId: string; tenant?: string; redirectUri: string; code: string; codeVerifier: string; scopes?: string[]; now?: number },
  fetchImpl: FetchLike = defaultFetch,
): Promise<MicrosoftTokens> {
  return tokenRequest(
    opts.tenant,
    {
      client_id: opts.clientId,
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.codeVerifier,
      scope: (opts.scopes ?? MICROSOFT_SCOPES).join(" "),
    },
    fetchImpl,
    opts.now ?? Date.now(),
  );
}

export function refreshMicrosoftToken(
  opts: { clientId: string; tenant?: string; refreshToken: string; scopes?: string[]; now?: number },
  fetchImpl: FetchLike = defaultFetch,
): Promise<MicrosoftTokens> {
  return tokenRequest(
    opts.tenant,
    { client_id: opts.clientId, grant_type: "refresh_token", refresh_token: opts.refreshToken, scope: (opts.scopes ?? MICROSOFT_SCOPES).join(" ") },
    fetchImpl,
    opts.now ?? Date.now(),
  );
}

// ─── Graph JSON shapes (subset) ──────────────────────────────────────────

interface GraphRecipient {
  emailAddress?: { address?: string; name?: string };
}
export interface GraphMessageJson {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: GraphRecipient;
  sender?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  sentDateTime?: string;
  internetMessageId?: string;
  webLink?: string;
  isDraft?: boolean;
}

function recipient(r: GraphRecipient | undefined): EmailAddress | null {
  const email = r?.emailAddress?.address?.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  const name = r?.emailAddress?.name?.trim();
  return name && name.toLowerCase() !== email ? { email, name } : { email };
}

function recipients(list: GraphRecipient[] | undefined): EmailAddress[] {
  return (list ?? []).map(recipient).filter((a): a is EmailAddress => !!a);
}

export function mapGraphMessage(json: GraphMessageJson): EmailMessage {
  const date = Date.parse(json.receivedDateTime ?? json.sentDateTime ?? "");
  const body = json.body?.content
    ? json.body.contentType?.toLowerCase() === "html"
      ? htmlToText(json.body.content)
      : json.body.content.trim()
    : undefined;
  return {
    id: json.id,
    ...(json.conversationId ? { threadId: json.conversationId } : {}),
    provider: "microsoft",
    from: recipient(json.from ?? json.sender),
    to: recipients(json.toRecipients),
    cc: recipients(json.ccRecipients),
    subject: (json.subject ?? "").trim(),
    snippet: (json.bodyPreview ?? "").trim(),
    date: Number.isFinite(date) ? date : 0,
    ...(body ? { body } : {}),
    ...(json.internetMessageId ? { internetMessageId: json.internetMessageId } : {}),
    ...(json.webLink ? { url: json.webLink } : {}),
  };
}

// KQL $search over participants (from / to / cc) — addresses or domains.
export function buildGraphSearch(opts: { emails?: string[]; domains?: string[] }): string {
  const terms = [...(opts.emails ?? []), ...(opts.domains ?? [])].filter(Boolean).map((x) => `participants:${x.replace(/"/g, "")}`);
  return terms.join(" OR ");
}

// ─── Graph client ────────────────────────────────────────────────────────

const MESSAGE_SELECT = "id,conversationId,subject,bodyPreview,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,internetMessageId,webLink";

function auth(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Prefer: 'IdType="ImmutableId"', ...extra };
}

export async function graphMe(token: string, fetchImpl: FetchLike = defaultFetch): Promise<{ email: string; name?: string }> {
  const me = await requestJson<{ mail?: string; userPrincipalName?: string; displayName?: string }>("microsoft", fetchImpl, `${GRAPH}/me?$select=mail,userPrincipalName,displayName`, {
    headers: auth(token),
  });
  return { email: (me?.mail || me?.userPrincipalName || "").toLowerCase(), ...(me?.displayName ? { name: me.displayName } : {}) };
}

export async function graphSearchMessages(
  token: string,
  opts: { emails?: string[]; domains?: string[]; top?: number },
  fetchImpl: FetchLike = defaultFetch,
): Promise<EmailMessage[]> {
  const search = buildGraphSearch(opts);
  if (!search) return [];
  const params = new URLSearchParams({ $search: `"${search}"`, $top: String(opts.top ?? 25), $select: MESSAGE_SELECT });
  const data = await requestJson<{ value?: GraphMessageJson[] }>("microsoft", fetchImpl, `${GRAPH}/me/messages?${params}`, { headers: auth(token) });
  return (data?.value ?? []).filter((m) => !m.isDraft).map(mapGraphMessage).sort((a, b) => b.date - a.date);
}

export async function graphGetMessage(token: string, id: string, fetchImpl: FetchLike = defaultFetch): Promise<EmailMessage> {
  const json = await requestJson<GraphMessageJson>("microsoft", fetchImpl, `${GRAPH}/me/messages/${encodeURIComponent(id)}?$select=${MESSAGE_SELECT},body`, {
    headers: auth(token, { Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"' }),
  });
  return mapGraphMessage(json);
}

function graphRecipients(list: (EmailAddress | string)[] | undefined) {
  return emailList(list).map((a) => ({ emailAddress: { address: a.email, ...(a.name ? { name: a.name } : {}) } }));
}

export function buildGraphMessage(email: OutgoingEmail): Record<string, unknown> {
  const to = graphRecipients(email.to);
  if (!to.length) throw new Error("An email needs at least one recipient.");
  const cc = graphRecipients(email.cc);
  const bcc = graphRecipients(email.bcc);
  return {
    subject: email.subject,
    body: { contentType: "Text", content: email.body },
    toRecipients: to,
    ...(cc.length ? { ccRecipients: cc } : {}),
    ...(bcc.length ? { bccRecipients: bcc } : {}),
  };
}

// Body for POST /me/sendMail.
export function buildGraphSendMailBody(email: OutgoingEmail, opts: { saveToSentItems?: boolean } = {}): { message: Record<string, unknown>; saveToSentItems: boolean } {
  return { message: buildGraphMessage(email), saveToSentItems: opts.saveToSentItems ?? true };
}

// POST /me/sendMail — fire and forget (Graph returns 202 without an id).
export async function graphSendMail(token: string, email: OutgoingEmail, fetchImpl: FetchLike = defaultFetch): Promise<void> {
  await requestJson<void>("microsoft", fetchImpl, `${GRAPH}/me/sendMail`, {
    method: "POST",
    headers: auth(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(buildGraphSendMailBody(email)),
  });
}

// Draft + send, so the caller gets a stable (immutable) message id to log.
export async function graphSendViaDraft(token: string, email: OutgoingEmail, fetchImpl: FetchLike = defaultFetch): Promise<{ id: string; threadId?: string; internetMessageId?: string }> {
  const draft = await requestJson<GraphMessageJson>("microsoft", fetchImpl, `${GRAPH}/me/messages`, {
    method: "POST",
    headers: auth(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(buildGraphMessage(email)),
  });
  await requestJson<void>("microsoft", fetchImpl, `${GRAPH}/me/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST", headers: auth(token) });
  return { id: draft.id, ...(draft.conversationId ? { threadId: draft.conversationId } : {}), ...(draft.internetMessageId ? { internetMessageId: draft.internetMessageId } : {}) };
}

// ─── Calendar ────────────────────────────────────────────────────────────

export interface GraphEventJson {
  id: string;
  subject?: string;
  bodyPreview?: string;
  isCancelled?: boolean;
  isAllDay?: boolean;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  location?: { displayName?: string };
  webLink?: string;
  onlineMeeting?: { joinUrl?: string } | null;
  attendees?: { emailAddress?: { address?: string; name?: string }; status?: { response?: string }; type?: string }[];
  organizer?: GraphRecipient;
}

// Graph returns "2024-06-20T09:00:00.0000000" in the requested time zone
// (we ask for UTC via the Prefer header).
function graphTime(t: { dateTime?: string; timeZone?: string } | undefined): number {
  if (!t?.dateTime) return NaN;
  const s = t.dateTime;
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s);
  const utc = !t.timeZone || /^(utc|gmt|etc\/utc)$/i.test(t.timeZone);
  return Date.parse(hasZone || !utc ? s : `${s.replace(/\.\d+$/, "")}Z`);
}

export function mapGraphEvent(json: GraphEventJson): CalendarEvent {
  const start = graphTime(json.start);
  const end = graphTime(json.end);
  const organizer = recipient(json.organizer);
  return {
    id: json.id,
    provider: "microsoft",
    title: (json.subject ?? "").trim() || "(no title)",
    start,
    end: Number.isFinite(end) ? end : start,
    ...(json.isAllDay ? { allDay: true } : {}),
    attendees: (json.attendees ?? [])
      .filter((a) => a.emailAddress?.address && a.type !== "resource")
      .map((a) => ({
        email: a.emailAddress!.address!.toLowerCase(),
        ...(a.emailAddress?.name ? { name: a.emailAddress.name } : {}),
        ...(a.status?.response && a.status.response !== "none" ? { response: a.status.response } : {}),
        ...(organizer && organizer.email === a.emailAddress!.address!.toLowerCase() ? { organizer: true } : {}),
      })),
    ...(json.location?.displayName ? { location: json.location.displayName } : {}),
    ...(json.onlineMeeting?.joinUrl || json.webLink ? { url: json.onlineMeeting?.joinUrl ?? json.webLink } : {}),
    ...(json.bodyPreview ? { description: json.bodyPreview } : {}),
    ...(json.isCancelled ? { cancelled: true } : {}),
    ...(organizer ? { organizer: organizer.email } : {}),
  };
}

export async function graphCalendarView(
  token: string,
  opts: { start: number; end: number; top?: number },
  fetchImpl: FetchLike = defaultFetch,
): Promise<CalendarEvent[]> {
  const out: CalendarEvent[] = [];
  const max = opts.top ?? 250;
  const params = new URLSearchParams({
    startDateTime: new Date(opts.start).toISOString(),
    endDateTime: new Date(opts.end).toISOString(),
    $top: String(Math.min(100, max)),
    $orderby: "start/dateTime",
    $select: "id,subject,bodyPreview,isCancelled,isAllDay,start,end,location,webLink,onlineMeeting,attendees,organizer",
  });
  let url: string | undefined = `${GRAPH}/me/calendarView?${params}`;
  while (url && out.length < max) {
    const data: { value?: GraphEventJson[]; "@odata.nextLink"?: string } = await requestJson("microsoft", fetchImpl, url, {
      headers: auth(token, { Prefer: 'IdType="ImmutableId", outlook.timezone="UTC"' }),
    });
    for (const e of data?.value ?? []) out.push(mapGraphEvent(e));
    url = data?.["@odata.nextLink"];
  }
  return out.slice(0, max);
}
