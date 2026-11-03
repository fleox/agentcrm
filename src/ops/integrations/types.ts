// Provider-neutral shapes for the email / calendar integrations (Gmail,
// Google Calendar, Outlook via Microsoft Graph). Pure TS: the API
// clients take an access token and an injectable `fetch`; OAuth itself
// runs in the browser (src/features/integrations/).

export type IntegrationProvider = "google" | "microsoft";
export const INTEGRATION_PROVIDERS: readonly IntegrationProvider[] = ["google", "microsoft"];

export interface EmailAddress {
  // Lower-cased address.
  email: string;
  name?: string;
}

export type EmailDirection = "inbound" | "outbound";

export interface EmailMessage {
  // Provider message id (Gmail id / Graph id).
  id: string;
  threadId?: string;
  provider: IntegrationProvider;
  from: EmailAddress | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  snippet: string;
  // Epoch ms.
  date: number;
  // Plain-text body when fetched in full.
  body?: string;
  // RFC 5322 Message-ID header, when known.
  internetMessageId?: string;
  // Link to open the message in the provider's web UI.
  url?: string;
  labels?: string[];
}

export interface CalendarAttendee {
  email: string;
  name?: string;
  // "accepted" | "declined" | "tentative" | "needsAction" | …
  response?: string;
  organizer?: boolean;
}

export interface CalendarEvent {
  id: string;
  provider: IntegrationProvider;
  title: string;
  // Epoch ms.
  start: number;
  end: number;
  allDay?: boolean;
  attendees: CalendarAttendee[];
  location?: string;
  url?: string;
  description?: string;
  cancelled?: boolean;
  organizer?: string;
}

// Minimal fetch signature so tests can inject a fake.
export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export class IntegrationApiError extends Error {
  constructor(
    readonly provider: IntegrationProvider,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "IntegrationApiError";
  }
  // 401: token expired / revoked → reconnect.
  get unauthorized(): boolean {
    return this.status === 401;
  }
}

export const defaultFetch: FetchLike = (input, init) => (globalThis.fetch as unknown as FetchLike)(input, init);

export async function requestJson<T>(
  provider: IntegrationProvider,
  fetchImpl: FetchLike,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<T> {
  const res = await fetchImpl(url, init);
  if (!res.ok) {
    let message = `${provider} API error ${res.status}`;
    try {
      const text = await res.text();
      try {
        const data = JSON.parse(text) as { error?: { message?: string } | string; error_description?: string };
        const m = typeof data.error === "string" ? data.error_description || data.error : data.error?.message;
        if (m) message = `${message}: ${m}`;
      } catch {
        if (text) message = `${message}: ${text.slice(0, 200)}`;
      }
    } catch {
      // ignore
    }
    throw new IntegrationApiError(provider, res.status, message);
  }
  if (res.status === 202 || res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
