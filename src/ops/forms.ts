// Lead capture forms.
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
//
// Ingestion (ingestSubmissions):
//   - spam (honeypot filled) → dropped;
//   - unknown / mismatching form, or invalid data → marked failed (kept
//     aside, reported);
//   - dedupe on the form's email field (normalized): existing record →
//     updated with the submitted non-empty values; else created with the
//     form's hiddenValues (record.created fires → automations run);
//   - people forms: the company is found (or created) from the email
//     domain (free-mail domains ignored) and linked when the person has none;
//   - a "Form submission" note is logged on the record (+ company), with
//     meta { source: "form", formId, submissionId } — a submission already
//     logged is never processed twice.
// Inbox credentials are never stored on the form: the environment opens
// inboxes through setInboxSourceResolver() (see ops/forms/inbox.ts).

import { isEmptyFieldValue, normalizeDomain, normalizeEmail, recordLabel, formatFieldValue } from "../core/fields";
import { newId } from "../core/ids";
import type { CrmRecord, LeadForm, ObjectDef } from "../core/types";
import { addActivity } from "./activities";
import { assertCan, OpsError, type OpsContext } from "./context";
import { buildFormArtifacts, defaultFormPath, HONEYPOT_NAME, isFormFieldType } from "./forms/html";
import { resolveInboxSource } from "./forms/inbox";
import { INBOX_KINDS, type InboxSource, type InboxSubmission, type LeadFormDoc } from "./forms/types";
import { createRecord, queryContext, updateRecord } from "./records";
import { activitiesOf, asDoc, formsOf, objectOf, recordsOf, requireObject, thaw, userOf } from "./store";

export * from "./forms/types";
export { buildFormArtifacts, defaultFormPath, escapeHtml, FORM_FIELD_TYPES, HONEYPOT_NAME, isFormFieldType, MIN_FILL_MS } from "./forms/html";
export {
  connectorInboxSource,
  firestoreInboxSource,
  memoryInboxSource,
  parseSubmission,
  resolveInboxSource,
  setInboxSourceResolver,
  type InboxConnector,
  type InboxSourceResolver,
} from "./forms/inbox";

export interface FormBuildResult {
  html: string;
  embedSnippet: string;
  path: string;
}

// ─── Reads ──────────────────────────────────────────────────────────────

export function listForms(ctx: OpsContext): LeadForm[] {
  return ctx.store.list("forms") as unknown as LeadForm[];
}

export function getForm(ctx: OpsContext, id: string): LeadFormDoc {
  const f = ctx.store.get("forms", id) as unknown as LeadFormDoc | undefined;
  if (!f) throw new OpsError("notFound", `Form "${id}" not found.${formsOf(ctx.store).length ? ` Forms: ${formsOf(ctx.store).map((x) => x.id).join(", ")}.` : ""}`);
  return f;
}

// ─── Validation & CRUD ──────────────────────────────────────────────────

export type LeadFormInput = Omit<LeadFormDoc, "id" | "createdAt" | "updatedAt" | "publishedAt" | "publishedUrl" | "lastIngestAt"> & { id?: string };

export function validateForm(ctx: OpsContext, input: Partial<LeadFormInput>): LeadFormInput {
  const errors: string[] = [];
  const name = (input.name ?? "").trim();
  if (!name) errors.push("A name is required.");
  const object = input.object ? objectOf(ctx.store, input.object) : undefined;
  if (!object) errors.push(`Unknown object "${input.object ?? ""}".`);
  const fields: LeadFormDoc["fields"] = [];
  const seen = new Set<string>();
  for (const f of input.fields ?? []) {
    const def = object?.fields.find((x) => x.id === f.field);
    if (object && !def) {
      errors.push(`Field "${f.field}" doesn't exist on ${object.labelPlural}.`);
      continue;
    }
    if (def && !isFormFieldType(def.type)) {
      errors.push(`${def.label}: ${def.type} fields can't be collected by a public form.`);
      continue;
    }
    if (seen.has(f.field)) continue;
    seen.add(f.field);
    fields.push({ field: f.field, label: (f.label ?? "").trim() || def?.label || f.field, required: !!f.required });
  }
  if (!fields.length) errors.push("Add at least one field.");
  const kind = input.inbox?.kind;
  const settings = Object.fromEntries(Object.entries(input.inbox?.settings ?? {}).map(([k, v]) => [k, String(v ?? "").trim()]));
  if (!kind || !INBOX_KINDS.includes(kind)) errors.push(`Pick an inbox: ${INBOX_KINDS.join(", ")}.`);
  if (kind === "s3" && !/^https?:\/\/\S+$/i.test(settings.uploadUrl ?? "")) errors.push("S3 inbox: the public upload URL (https://<bucket>…/inbox/) is required.");
  if (kind === "firebase") {
    if (!settings.projectId) errors.push("Firebase inbox: the project id is required.");
    if (!settings.apiKey) errors.push("Firebase inbox: the web API key is required.");
  }
  if (kind === "webhook") {
    if (!/^https:\/\/\S+$/i.test(settings.url ?? "")) errors.push("Webhook inbox: an https:// URL is required.");
    if (settings.extra) {
      try {
        const parsed = JSON.parse(settings.extra) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      } catch {
        errors.push("Webhook inbox: extra fields must be a JSON object.");
      }
    }
  }
  if (input.ownerId && !userOf(ctx.store, input.ownerId)) errors.push(`Unknown owner "${input.ownerId}".`);
  if (input.redirectUrl && !/^https?:\/\/\S+$/i.test(input.redirectUrl)) errors.push("The redirect URL must start with https://.");
  if (input.publishedPath && (/^\/|\.\./.test(input.publishedPath) || !/\.html?$/.test(input.publishedPath))) errors.push('The page path must be relative and end with ".html" (e.g. forms/contact/index.html).');
  const hiddenValues: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.hiddenValues ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    if (object && !object.fields.some((f) => f.id === k)) errors.push(`Hidden value: field "${k}" doesn't exist on ${object.labelPlural}.`);
    hiddenValues[k] = v;
  }
  if (errors.length) throw new OpsError("validation", errors.join(" "), errors);
  return {
    ...(input.id ? { id: input.id } : {}),
    name,
    object: input.object!,
    fields,
    inbox: { kind: kind!, settings },
    successMessage: (input.successMessage ?? "").trim() || "Thank you! We'll be in touch soon.",
    ...(input.publishedPath ? { publishedPath: input.publishedPath } : {}),
    ...(input.texts ? { texts: input.texts } : {}),
    ...(Object.keys(hiddenValues).length ? { hiddenValues } : {}),
    ...(input.ownerId ? { ownerId: input.ownerId } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    ...(input.redirectUrl ? { redirectUrl: input.redirectUrl } : {}),
  };
}

export async function createForm(ctx: OpsContext, input: LeadFormInput): Promise<LeadFormDoc> {
  assertCan(ctx, "forms.write");
  const valid = validateForm(ctx, input);
  const now = ctx.now();
  const id = input.id ?? newId(now);
  if (ctx.store.get("forms", id)) throw new OpsError("conflict", `Form "${id}" already exists.`);
  const doc: LeadFormDoc = { ...valid, id, createdAt: now, updatedAt: now };
  await ctx.store.write([{ op: "set", collection: "forms", doc: asDoc(doc) }], { message: `Create form ${valid.name}` });
  return getForm(ctx, id);
}

export async function updateForm(ctx: OpsContext, id: string, patch: Partial<LeadFormInput>): Promise<LeadFormDoc> {
  assertCan(ctx, "forms.write");
  const current = thaw(getForm(ctx, id));
  const merged = { ...current, ...patch, id };
  const valid = validateForm(ctx, merged);
  const next: LeadFormDoc = {
    ...valid,
    id,
    ...(current.publishedUrl ? { publishedUrl: current.publishedUrl } : {}),
    ...(current.publishedAt ? { publishedAt: current.publishedAt } : {}),
    ...(current.lastIngestAt ? { lastIngestAt: current.lastIngestAt } : {}),
    createdAt: current.createdAt,
    updatedAt: ctx.now(),
  };
  await ctx.store.write([{ op: "set", collection: "forms", doc: asDoc(next) }], { message: `Update form ${valid.name}` });
  return getForm(ctx, id);
}

export async function deleteForm(ctx: OpsContext, id: string): Promise<{ id: string; publishedPath?: string }> {
  assertCan(ctx, "forms.write");
  const form = getForm(ctx, id);
  await ctx.store.write([{ op: "delete", collection: "forms", id }], { message: "Delete form" });
  return { id, ...(form.publishedAt ? { publishedPath: form.publishedPath || defaultFormPath(form) } : {}) };
}

// Suggested fields for a new form on an object.
export function suggestFormFields(ctx: OpsContext, objectId: string): LeadFormDoc["fields"] {
  const object = requireObject(ctx.store, objectId);
  const wanted = objectId === "people" ? ["firstName", "lastName", "email", "phone", "jobTitle"] : objectId === "companies" ? ["name", "domain", "phone"] : [object.labelField];
  return wanted
    .map((id) => object.fields.find((f) => f.id === id))
    .filter((f): f is NonNullable<typeof f> => !!f && isFormFieldType(f.type))
    .map((f) => ({ field: f.id, label: f.label, required: f.id === "email" || f.id === object.labelField }));
}

// ─── Build & publish ────────────────────────────────────────────────────

export async function buildFormHtml(ctx: OpsContext, formId: string, opts: { baseUrl?: string; lang?: string } = {}): Promise<FormBuildResult & { url?: string }> {
  const form = getForm(ctx, formId);
  const object = requireObject(ctx.store, form.object);
  const built = buildFormArtifacts(form, object, { lang: opts.lang });
  const url = opts.baseUrl ? `${opts.baseUrl.replace(/\/+$/, "")}/${built.path.replace(/index\.html$/, "")}` : form.publishedUrl;
  return { html: built.html, embedSnippet: built.embedSnippet, path: built.path, ...(url ? { url } : {}) };
}

export interface FormUploader {
  put(input: { path: string; content: string }): Promise<void>;
  publicUrl?(path: string): Promise<string>;
}

// Uploads the generated page through a hosting connector (the admin
// passes the siteFiles facade, the CLI its hosting connector).
export async function publishForm(ctx: OpsContext, formId: string, uploader: FormUploader, opts: { lang?: string } = {}): Promise<{ path: string; url?: string; embedSnippet: string }> {
  assertCan(ctx, "forms.write");
  const form = getForm(ctx, formId);
  const built = await buildFormHtml(ctx, formId, { lang: opts.lang });
  await uploader.put({ path: built.path, content: built.html });
  let url: string | undefined;
  try {
    url = uploader.publicUrl ? await uploader.publicUrl(built.path) : undefined;
  } catch {
    url = undefined;
  }
  if (url) url = url.replace(/index\.html$/, "");
  await ctx.store.write(
    [{ op: "patch", collection: "forms", id: form.id, fields: { publishedPath: built.path, publishedAt: ctx.now(), publishedUrl: url, updatedAt: ctx.now() } }],
    { message: `Publish form ${form.name}` },
  );
  return { path: built.path, ...(url ? { url } : {}), embedSnippet: built.embedSnippet };
}

// ─── Ingestion ──────────────────────────────────────────────────────────

export interface IngestReport {
  processed: number;
  created: number;
  updated: number;
  failed: number;
  errors: { submission: string; message: string }[];
  // Additions: spam dropped, companies created, forms skipped (webhook
  // inbox / no credentials), per-submission outcomes.
  spam?: number;
  companiesCreated?: number;
  skippedForms?: { formId: string; reason: string }[];
  results?: { submission: string; formId: string; outcome: "created" | "updated" | "failed" | "spam" | "duplicate"; recordId?: string; message?: string }[];
}

// Free-mail providers: their domain says nothing about the company.
export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.fr",
  "ymail.com",
  "hotmail.com",
  "hotmail.fr",
  "outlook.com",
  "outlook.fr",
  "live.com",
  "live.fr",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "gmx.com",
  "gmx.de",
  "gmx.fr",
  "web.de",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "zoho.com",
  "mail.com",
  "yandex.com",
  "yandex.ru",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "laposte.net",
  "sfr.fr",
  "bbox.fr",
  "qq.com",
  "163.com",
  "fastmail.com",
  "hey.com",
  "tutanota.com",
]);

export function companyDomainOfEmail(email: string): string | null {
  const domain = normalizeEmail(email).split("@")[1];
  if (!domain || !domain.includes(".") || FREE_MAIL_DOMAINS.has(domain)) return null;
  return domain;
}

const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "ac", "edu", "ltd", "plc", "gouv", "asso"]);

function companyNameFromDomain(domain: string): string {
  const parts = domain.split(".");
  parts.pop();
  if (parts.length > 1 && SECOND_LEVEL.has(parts[parts.length - 1])) parts.pop();
  const main = parts.pop() ?? domain;
  return main
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function emailFieldOf(form: LeadFormDoc, object: ObjectDef): string | undefined {
  return form.fields.map((f) => object.fields.find((x) => x.id === f.field)).find((d) => d?.type === "email")?.id ?? (object.fields.some((f) => f.id === "email" && f.type === "email") ? "email" : undefined);
}

function isSpam(sub: InboxSubmission): boolean {
  const hp = sub.data[HONEYPOT_NAME] ?? sub.meta?.hp;
  return typeof hp === "string" ? hp.trim() !== "" : !!hp;
}

function alreadyIngested(ctx: OpsContext, submissionId: string): CrmRecord | null | undefined {
  const a = activitiesOf(ctx.store).find((x) => x.meta?.source === "form" && x.meta?.submissionId === submissionId);
  if (!a) return undefined;
  return (recordsOf(ctx.store).find((r) => a.targets.some((t) => t.id === r.id)) as CrmRecord | undefined) ?? null;
}

interface IngestOneResult {
  outcome: "created" | "updated" | "duplicate";
  record: CrmRecord;
  companyCreated: boolean;
}

async function ingestOne(ctx: OpsContext, form: LeadFormDoc, object: ObjectDef, sub: InboxSubmission, dryRun: boolean): Promise<IngestOneResult> {
  const done = alreadyIngested(ctx, sub.id);
  if (done) return { outcome: "duplicate", record: done, companyCreated: false };
  // Keep only the form's fields; check required ones.
  const values: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const f of form.fields) {
    const def = object.fields.find((x) => x.id === f.field);
    if (!def) continue;
    const raw = sub.data[f.field];
    const empty = raw === undefined || raw === null || (typeof raw === "string" && !raw.trim()) || (Array.isArray(raw) && !raw.length) || (def.type === "boolean" && raw === false && f.required);
    if (empty) {
      if (f.required) missing.push(f.label || def.label);
      continue;
    }
    values[f.field] = typeof raw === "string" ? raw.trim().slice(0, 5000) : raw;
  }
  if (missing.length) throw new OpsError("validation", `Missing required field(s): ${missing.join(", ")}.`);
  const emailField = emailFieldOf(form, object);
  const email = emailField ? normalizeEmail(values[emailField]) : "";
  if (emailField && values[emailField] !== undefined) values[emailField] = email;
  const existing = email ? recordsOf(ctx.store, object.id).find((r) => normalizeEmail(r.fields[emailField!]) === email) : undefined;

  // Company from the email domain (people forms).
  let companyId: string | undefined;
  let companyCreated = false;
  const companyField = object.id === "people" ? object.fields.find((f) => f.id === "company" && f.type === "relation" && f.relation?.object === "companies") : undefined;
  const domain = email ? companyDomainOfEmail(email) : null;
  if (companyField && domain && objectOf(ctx.store, "companies") && isEmptyFieldValue(companyField, existing?.fields.company) && values.company === undefined) {
    const company = recordsOf(ctx.store, "companies").find((c) => normalizeDomain(c.fields.domain) === domain);
    if (company) companyId = company.id;
    else if (!dryRun) {
      const created = await createRecord(ctx, "companies", { name: companyNameFromDomain(domain), domain }, { ownerId: form.ownerId ?? null, message: `Company from form ${form.name}` });
      companyId = created.id;
      companyCreated = true;
    } else companyCreated = true;
    if (companyId) values.company = companyId;
  }

  if (dryRun) {
    const preview: CrmRecord = existing ?? { id: "(new)", object: object.id, fields: { ...form.hiddenValues, ...values }, createdAt: ctx.now(), updatedAt: ctx.now() };
    return { outcome: existing ? "updated" : "created", record: preview, companyCreated };
  }

  let record: CrmRecord;
  let outcome: "created" | "updated";
  if (existing) {
    record = await updateRecord(ctx, existing.id, values, { unknownFields: "drop", message: `Form submission ${form.name}` });
    outcome = "updated";
  } else {
    record = await createRecord(ctx, object.id, { ...(form.hiddenValues ?? {}), ...values }, { unknownFields: "drop", ownerId: form.ownerId ?? null, message: `Form submission ${form.name}` });
    outcome = "created";
  }

  // Timeline note.
  const qctx = queryContext(ctx, object);
  const lines = form.fields
    .filter((f) => values[f.field] !== undefined && f.field !== "company")
    .map((f) => {
      const def = object.fields.find((x) => x.id === f.field)!;
      return `- **${f.label || def.label}:** ${formatFieldValue(def, record.fields[f.field] ?? values[f.field], qctx) || String(values[f.field])}`;
    });
  const page = typeof sub.meta?.page === "string" ? sub.meta.page : undefined;
  if (page) lines.push(`- **Page:** ${page}`);
  const targets = [{ object: record.object, id: record.id }, ...(companyId ? [{ object: "companies", id: companyId }] : [])];
  await addActivity(ctx, {
    type: "note",
    title: `Form submission: ${form.name}`,
    body: lines.join("\n"),
    targets,
    meta: { source: "form", formId: form.id, submissionId: sub.id, submittedAt: sub.createdAt || undefined, ...(page ? { page } : {}) },
  });
  ctx.log?.(`form ${form.id}: ${outcome} ${recordLabel(object, record)}`);
  return { outcome, record, companyCreated };
}

export interface IngestOptions {
  dryRun?: boolean;
  // Read from this inbox instead of resolving each form's.
  source?: InboxSource;
  limit?: number;
}

function emptyReport(): IngestReport & Required<Pick<IngestReport, "spam" | "companiesCreated" | "skippedForms" | "results">> {
  return { processed: 0, created: 0, updated: 0, failed: 0, errors: [], spam: 0, companiesCreated: 0, skippedForms: [], results: [] };
}

// Ingests a list of submissions (any origin). When `source` is given,
// processed / failed submissions are acknowledged on it.
export async function ingestSubmissions(ctx: OpsContext, submissions: InboxSubmission[], opts: { dryRun?: boolean; source?: InboxSource; formId?: string } = {}): Promise<IngestReport> {
  assertCan(ctx, "records.write");
  const report = emptyReport();
  for (const sub of submissions) {
    if (opts.formId && sub.formId && sub.formId !== opts.formId) continue;
    const ack = async (kind: "remove" | "fail", message?: string) => {
      if (opts.dryRun || !opts.source) return;
      try {
        if (kind === "remove") await opts.source.remove(sub.id);
        else await opts.source.markFailed(sub.id, message ?? "failed");
      } catch (err) {
        report.errors.push({ submission: sub.id, message: `Couldn't acknowledge: ${(err as Error).message}` });
      }
    };
    report.processed++;
    if (isSpam(sub)) {
      report.spam++;
      report.results.push({ submission: sub.id, formId: sub.formId, outcome: "spam" });
      await ack("remove");
      continue;
    }
    const form = sub.formId ? (ctx.store.get("forms", sub.formId) as unknown as LeadFormDoc | undefined) : undefined;
    const object = form ? objectOf(ctx.store, form.object) : undefined;
    try {
      if (sub.meta?.invalid) throw new OpsError("validation", "Not a valid submission file.");
      if (!form) throw new OpsError("notFound", `Unknown form "${sub.formId}".`);
      if (!object) throw new OpsError("notFound", `Form "${form.name}" targets a missing object (${form.object}).`);
      const res = await ingestOne(ctx, form, object, sub, !!opts.dryRun);
      if (res.outcome === "created") report.created++;
      if (res.outcome === "updated") report.updated++;
      if (res.companyCreated) report.companiesCreated++;
      report.results.push({ submission: sub.id, formId: sub.formId, outcome: res.outcome, recordId: res.record.id });
      await ack("remove");
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      report.failed++;
      report.errors.push({ submission: sub.id, message });
      report.results.push({ submission: sub.id, formId: sub.formId, outcome: "failed", message });
      await ack("fail", message);
    }
  }
  return report;
}

// Pending submissions of one form (or of every form with a readable inbox).
export async function listInbox(ctx: OpsContext, formId?: string, opts: { source?: InboxSource } = {}): Promise<{ submissions: InboxSubmission[]; skippedForms: { formId: string; reason: string }[] }> {
  assertCan(ctx, "records.read");
  const forms = (formId ? [getForm(ctx, formId)] : (formsOf(ctx.store) as LeadFormDoc[]));
  const skippedForms: { formId: string; reason: string }[] = [];
  const sources = new Map<string, InboxSource>();
  if (opts.source) sources.set(opts.source.key, opts.source);
  else {
    for (const form of forms) {
      if (form.inbox.kind === "webhook") {
        skippedForms.push({ formId: form.id, reason: "Webhook inbox: submissions stay in your webhook service." });
        continue;
      }
      let source: InboxSource | null = null;
      try {
        source = await resolveInboxSource(ctx, form);
      } catch (err) {
        skippedForms.push({ formId: form.id, reason: (err as Error).message });
        continue;
      }
      if (!source) skippedForms.push({ formId: form.id, reason: "No credentials to read this inbox here." });
      else sources.set(source.key, source);
    }
  }
  const wanted = new Set(forms.map((f) => f.id));
  const submissions: InboxSubmission[] = [];
  for (const source of sources.values()) {
    for (const s of await source.list()) if (!formId || s.formId === formId || (!s.formId && wanted.has(formId))) submissions.push(s);
  }
  return { submissions, skippedForms };
}

export async function ingestInbox(ctx: OpsContext, formId?: string, opts: IngestOptions = {}): Promise<IngestReport> {
  assertCan(ctx, "records.write");
  const forms = formId ? [getForm(ctx, formId)] : (formsOf(ctx.store) as LeadFormDoc[]);
  const total = emptyReport();
  const sources = new Map<string, InboxSource>();
  if (opts.source) sources.set(opts.source.key, opts.source);
  else {
    for (const form of forms) {
      if (form.inbox.kind === "webhook") {
        total.skippedForms.push({ formId: form.id, reason: "Webhook inbox: submissions stay in your webhook service." });
        continue;
      }
      let source: InboxSource | null = null;
      try {
        source = await resolveInboxSource(ctx, form);
      } catch (err) {
        total.skippedForms.push({ formId: form.id, reason: (err as Error).message });
        continue;
      }
      if (!source) total.skippedForms.push({ formId: form.id, reason: "No credentials to read this inbox here." });
      else sources.set(source.key, source);
    }
  }
  for (const source of sources.values()) {
    let pending = await source.list();
    if (formId) pending = pending.filter((s) => s.formId === formId);
    if (opts.limit) pending = pending.slice(0, opts.limit);
    const r = await ingestSubmissions(ctx, pending, { dryRun: opts.dryRun, source });
    total.processed += r.processed;
    total.created += r.created;
    total.updated += r.updated;
    total.failed += r.failed;
    total.errors.push(...r.errors);
    total.spam += r.spam ?? 0;
    total.companiesCreated += r.companiesCreated ?? 0;
    total.results.push(...(r.results ?? []));
  }
  if (!opts.dryRun) {
    const touched = new Set(total.results.map((r) => r.formId).filter(Boolean));
    const now = ctx.now();
    const mutations = forms.filter((f) => touched.has(f.id) || formId === f.id).map((f) => ({ op: "patch" as const, collection: "forms" as const, id: f.id, fields: { lastIngestAt: now } }));
    try {
      if (mutations.length) await ctx.store.write(mutations, { message: "Ingest lead inbox" });
    } catch {
      // Bookkeeping only (a member may not be allowed to write forms).
    }
  }
  return total;
}
