// Lead form documents and inbox submissions.
//
// Inbox kinds (`form.inbox.kind`) and their public settings:
//   s3        uploadUrl  public base URL the browser PUTs submissions to,
//                        ending with the inbox prefix, e.g.
//                        https://my-bucket.s3.eu-west-3.amazonaws.com/inbox/
//             prefix     the same prefix as a connector path, read by the
//                        admin / CLI (default "inbox/")
//             source     which credentials read it: "hosting" (the hosting
//                        connector, default) or "data" (the journal
//                        backend's connector)
//   firebase  projectId, apiKey   Firebase web config (public)
//             collection         default "inbox" — docs {formId, data, createdAt}
//   webhook   url        user-owned endpoint (Formspree, Make, Zapier, n8n,
//                        Web3Forms…) — submissions never come back to the
//                        CRM, ingestion skips these forms
//             format     "json" (default) | "form" (urlencoded, no preflight)
//             extra      JSON object of static fields merged into the
//                        payload (e.g. {"access_key": "…"} for Web3Forms)
// No setting is a secret: everything here ends up in the public page.

import type { LeadForm } from "../../core/types";

export type InboxKind = LeadForm["inbox"]["kind"];
export const INBOX_KINDS: readonly InboxKind[] = ["s3", "firebase", "webhook"];
export const DEFAULT_INBOX_PREFIX = "inbox/";
export const DEFAULT_FIREBASE_INBOX = "inbox";

export interface LeadFormTexts {
  // Page heading (default: form name) and intro paragraph.
  title?: string;
  description?: string;
  submit?: string;
  sending?: string;
  error?: string;
  tooFast?: string;
}

// Stored form doc: LeadForm + presentation / bookkeeping.
export interface LeadFormDoc extends LeadForm {
  texts?: LeadFormTexts;
  // Values set on records created from this form (e.g. leadSource,
  // lifecycleStage). Applied on creation only.
  hiddenValues?: Record<string, unknown>;
  // Owner of created records (default: none — let an automation assign).
  ownerId?: string;
  // Accent color of the published page (#rrggbb).
  accentColor?: string;
  // Redirect to this URL after a successful submission (instead of the
  // success message).
  redirectUrl?: string;
  publishedUrl?: string;
  publishedAt?: number;
  lastIngestAt?: number;
  createdAt?: number;
  updatedAt?: number;
}

export const DEFAULT_FORM_TEXTS: Required<Omit<LeadFormTexts, "title" | "description">> = {
  submit: "Submit",
  sending: "Sending…",
  error: "Something went wrong. Please try again in a moment.",
  tooFast: "Please take a second to check your answers, then submit again.",
};

// One submission, whatever the inbox. `id` is the inbox-specific key
// (S3 object key, Firestore doc name).
export interface InboxSubmission {
  id: string;
  formId: string;
  data: Record<string, unknown>;
  createdAt: number;
  meta?: Record<string, unknown>;
}

// Reads / acknowledges submissions of one inbox.
export interface InboxSource {
  // Identifies the inbox (several forms may share one).
  key: string;
  list(): Promise<InboxSubmission[]>;
  // Processed (or spam): remove it from the inbox.
  remove(id: string): Promise<void>;
  // Invalid: keep it aside so it isn't retried forever.
  markFailed(id: string, error: string): Promise<void>;
}
