// Lead capture forms — STUB (owned by the forms agent).
//
// Contract:
//   - buildFormHtml(ctx, formId, opts) returns a self-contained static
//     HTML page (+ embed snippet) that posts submissions to the form's
//     inbox (an S3 bucket prefix writable anonymously, a Firestore
//     collection, or a user-owned webhook) — no server of ours;
//   - ingestInbox(ctx, formId?, opts) reads pending submissions from the
//     inbox, creates / dedupes records through ops/records.ts, logs an
//     activity, and deletes (or marks) processed submissions;
//   - called by the admin while open and by `agentcrm forms ingest --yes`.

import type { LeadForm } from "../core/types";
import type { OpsContext } from "./context";

export interface FormBuildResult {
  html: string;
  embedSnippet: string;
  path: string;
}

export async function buildFormHtml(_ctx: OpsContext, formId: string, _opts: { baseUrl?: string } = {}): Promise<FormBuildResult> {
  throw new Error(`buildFormHtml is not implemented yet (form ${formId}).`);
}

export interface IngestReport {
  processed: number;
  created: number;
  updated: number;
  failed: number;
  errors: { submission: string; message: string }[];
}

export async function ingestInbox(_ctx: OpsContext, _formId?: string, _opts: { dryRun?: boolean } = {}): Promise<IngestReport> {
  return { processed: 0, created: 0, updated: 0, failed: 0, errors: [] };
}

export function listForms(ctx: OpsContext): LeadForm[] {
  return ctx.store.list("forms") as unknown as LeadForm[];
}
