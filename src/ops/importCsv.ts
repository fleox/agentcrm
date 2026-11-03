// CSV import: column → field mapping (suggested automatically), type
// coercion, dedupe (people by email, companies by domain, others by
// label), relation resolution by label (and creation of missing companies
// for people / deals), dry-run report. A real run is ONE store write.

import Papa from "papaparse";
import { coerceFieldValue, findOption, normalizeDomain, normalizeEmail, recordLabel } from "../core/fields";
import { newId } from "../core/ids";
import type { CrmRecord, FieldDef, ObjectDef } from "../core/types";
import type { DocMutation } from "../data/types";
import { camelId } from "../shared/lib/utils";
import { actorId, assertCan, emit, OpsError, type OpsContext } from "./context";
import { prepareRecordFields, recordPatchMutation } from "./records";
import { asDoc, objectOf, recordsOf, requireObject, usersOf, thaw } from "./store";

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  errors: { row: number; message: string }[];
}

export function parseCsv(text: string, opts: { delimiter?: string } = {}): ParsedCsv {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    delimiter: opts.delimiter ?? "",
    transformHeader: (h) => h.trim(),
  });
  return {
    headers: (res.meta.fields ?? []).filter((h) => h !== ""),
    rows: res.data,
    errors: res.errors.map((e) => ({ row: (e.row ?? 0) + 2, message: e.message })),
  };
}

// Special mapping targets besides field ids.
export const MAPPING_OWNER = "$owner";
export const MAPPING_ID = "$id";
export const MAPPING_SKIP = "";

const ALIASES: Record<string, string[]> = {
  firstName: ["first name", "firstname", "first", "given name", "prénom", "prenom"],
  lastName: ["last name", "lastname", "last", "surname", "family name", "nom de famille", "nom"],
  name: ["name", "full name", "fullname", "company name", "deal name", "nom complet", "raison sociale"],
  email: ["email", "e-mail", "email address", "mail", "courriel", "adresse e-mail"],
  phone: ["phone", "phone number", "telephone", "tel", "mobile", "téléphone"],
  jobTitle: ["job title", "title", "position", "role", "poste", "fonction"],
  company: ["company", "organization", "organisation", "account", "société", "entreprise"],
  domain: ["domain", "website", "web site", "url", "site", "site web"],
  city: ["city", "town", "ville"],
  linkedin: ["linkedin", "linkedin url", "linkedin profile"],
  amount: ["amount", "value", "deal value", "montant"],
  stage: ["stage", "deal stage", "étape", "statut"],
  closeDate: ["close date", "closing date", "expected close", "date de clôture"],
  industry: ["industry", "sector", "secteur"],
  employees: ["employees", "headcount", "company size", "employés", "effectif"],
  annualRevenue: ["annual revenue", "revenue", "chiffre d'affaires", "ca"],
  leadSource: ["lead source", "source", "origine"],
  lifecycleStage: ["lifecycle stage", "lifecycle", "status", "cycle de vie"],
  tags: ["tags", "labels", "étiquettes"],
};

function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Best-guess mapping header → field id ("" = skip).
export function suggestMapping(object: ObjectDef, headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const h of headers) {
    const n = norm(h);
    let match =
      object.fields.find((f) => norm(f.id) === n || norm(f.label) === n || camelId(h) === f.id) ??
      object.fields.find((f) => (ALIASES[f.id] ?? []).some((a) => norm(a) === n));
    if (!match && (n === "owner" || n === "assigned to" || n === "proprietaire")) {
      out[h] = MAPPING_OWNER;
      continue;
    }
    if (!match && n === "id") {
      out[h] = MAPPING_ID;
      continue;
    }
    if (match && used.has(match.id)) match = undefined;
    out[h] = match?.id ?? MAPPING_SKIP;
    if (match) used.add(match.id);
  }
  return out;
}

export interface ImportOptions {
  object: string;
  csv: string;
  // header → field id / MAPPING_OWNER / MAPPING_ID / "" (skip). Default: suggested.
  mapping?: Record<string, string>;
  dryRun?: boolean;
  // Existing duplicate found: update it (default), skip the row, or create anyway.
  onDuplicate?: "update" | "skip" | "create";
  dayFirst?: boolean;
  // Unknown select values: add them as new options (default true).
  createOptions?: boolean;
  // Relation values that match no record: create the target (companies
  // only, by name / domain) — default true.
  createRelated?: boolean;
  delimiter?: string;
}

export interface ImportRowReport {
  row: number;
  action: "create" | "update" | "skip" | "error";
  id?: string;
  label?: string;
  messages?: string[];
}

export interface ImportReport {
  object: string;
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  mapping: Record<string, string>;
  unmappedColumns: string[];
  newOptions: { field: string; labels: string[] }[];
  createdRelated: { object: string; label: string }[];
  rows: ImportRowReport[];
}

function dedupeKey(object: ObjectDef, fields: Record<string, unknown>): string | null {
  if (object.id === "people" || object.fields.some((f) => f.id === "email" && f.unique)) {
    const e = normalizeEmail(fields.email);
    if (e) return `email:${e}`;
  }
  if (object.id === "companies" || object.fields.some((f) => f.id === "domain" && f.unique)) {
    const d = normalizeDomain(fields.domain);
    if (d) return `domain:${d}`;
  }
  const label = fields[object.labelField];
  if (object.id !== "people" && typeof label === "string" && label.trim()) return `label:${label.trim().toLowerCase()}`;
  return null;
}

export async function importCsv(ctx: OpsContext, opts: ImportOptions): Promise<ImportReport> {
  assertCan(ctx, "import");
  const baseObject = requireObject(ctx.store, opts.object);
  const parsed = parseCsv(opts.csv, { delimiter: opts.delimiter });
  const mapping = opts.mapping ?? suggestMapping(baseObject, parsed.headers);
  for (const target of Object.values(mapping)) {
    if (target && target !== MAPPING_OWNER && target !== MAPPING_ID && !baseObject.fields.some((f) => f.id === target)) {
      throw new OpsError("validation", `Mapping targets unknown field "${target}" on ${baseObject.labelPlural}.`);
    }
  }
  const onDuplicate = opts.onDuplicate ?? "update";
  const createOptions = opts.createOptions !== false;
  const createRelated = opts.createRelated !== false;
  const report: ImportReport = {
    object: baseObject.id,
    dryRun: !!opts.dryRun,
    total: parsed.rows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    mapping,
    unmappedColumns: parsed.headers.filter((h) => !mapping[h]),
    newOptions: [],
    createdRelated: [],
    rows: [],
  };

  // 1. New select options (applied to a working copy of the object).
  const object: ObjectDef = thaw(baseObject);
  if (createOptions) {
    for (const [header, fieldId] of Object.entries(mapping)) {
      const field = object.fields.find((f) => f.id === fieldId);
      if (!field || (field.type !== "select" && field.type !== "multiSelect") || field.system) continue;
      const fresh: string[] = [];
      for (const row of parsed.rows) {
        const raw = row[header];
        if (!raw?.trim()) continue;
        const parts = field.type === "multiSelect" ? raw.split(/[,;|]/) : [raw];
        for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
          if (!findOption(field, p) && !fresh.some((x) => x.toLowerCase() === p.toLowerCase())) fresh.push(p);
        }
      }
      if (fresh.length) {
        const start = field.options?.length ?? 0;
        field.options = [...(field.options ?? []), ...fresh.map((label, i) => ({ id: uniqueOptionId(field, label), label, color: ["gray", "blue", "green", "yellow", "orange", "red", "purple", "pink", "teal", "indigo"][(start + i) % 10] }))];
        report.newOptions.push({ field: field.id, labels: fresh });
      }
    }
  }

  // 2. Indexes for dedupe and relation lookups.
  const existing = recordsOf(ctx.store, object.id);
  const byKey = new Map<string, CrmRecord>();
  for (const r of existing) {
    const k = dedupeKey(object, r.fields);
    if (k && !byKey.has(k)) byKey.set(k, r);
  }
  const lookups = new Map<string, Map<string, string>>();
  const lookupFor = (target: string): Map<string, string> => {
    let m = lookups.get(target);
    if (!m) {
      m = new Map();
      const o = objectOf(ctx.store, target);
      for (const r of recordsOf(ctx.store, target)) {
        m.set(r.id, r.id);
        m.set(recordLabel(o, r).toLowerCase(), r.id);
        const d = normalizeDomain(r.fields.domain);
        if (d) m.set(d, r.id);
        const e = normalizeEmail(r.fields.email);
        if (e) m.set(e, r.id);
      }
      lookups.set(target, m);
    }
    return m;
  };
  const usersByKey = new Map<string, string>();
  for (const u of usersOf(ctx.store)) {
    usersByKey.set(u.id, u.id);
    usersByKey.set(normalizeEmail(u.email), u.id);
    usersByKey.set(u.name.toLowerCase(), u.id);
  }

  const mutations: DocMutation[] = [];
  const createdDocs: CrmRecord[] = [];
  const updatedDocs: { before: CrmRecord; changed: string[] }[] = [];
  const pendingRelated = new Map<string, CrmRecord>();
  const seenInFile = new Map<string, string>();
  const now = ctx.now();
  // Validation runs against the working object (new options included).
  const vctx: OpsContext = {
    ...ctx,
    store: {
      ...ctx.store,
      kind: ctx.store.kind,
      list: (c) => ctx.store.list(c),
      get: (c, id) => {
        if (c === "objects" && id === object.id) return asDoc(object);
        if (c === "records" && pendingRelated.has(id)) return asDoc(pendingRelated.get(id)!);
        return ctx.store.get(c, id);
      },
    },
  };

  parsed.rows.forEach((row, index) => {
    const rowNo = index + 2;
    const messages: string[] = [];
    const input: Record<string, unknown> = {};
    let ownerId: string | undefined;
    let explicitId: string | undefined;
    for (const [header, target] of Object.entries(mapping)) {
      const raw = row[header];
      if (!target || raw === undefined) continue;
      if (target === MAPPING_OWNER) {
        if (raw.trim()) {
          ownerId = usersByKey.get(raw.trim().toLowerCase()) ?? usersByKey.get(normalizeEmail(raw));
          if (!ownerId) messages.push(`Unknown owner "${raw}" (ignored).`);
        }
        continue;
      }
      if (target === MAPPING_ID) {
        explicitId = raw.trim() || undefined;
        continue;
      }
      const field = object.fields.find((f) => f.id === target)!;
      if (field.type === "relation") {
        const resolved = resolveRelation(field, raw);
        if (resolved !== undefined) input[target] = resolved;
        continue;
      }
      if (field.type === "user") {
        if (raw.trim()) {
          const uid = usersByKey.get(raw.trim().toLowerCase()) ?? usersByKey.get(normalizeEmail(raw));
          if (uid) input[target] = uid;
          else messages.push(`${field.label}: unknown user "${raw}" (ignored).`);
        }
        continue;
      }
      const res = coerceFieldValue(field, raw, { dayFirst: opts.dayFirst, unknownOptions: "fail" });
      if (!res.ok) messages.push(res.message);
      else if (res.value !== undefined) input[target] = res.value;
    }
    if (messages.some((m) => !m.endsWith("(ignored)."))) {
      report.failed++;
      report.rows.push({ row: rowNo, action: "error", messages });
      return;
    }

    const key = dedupeKey(object, input);
    const dupInFile = key ? seenInFile.get(key) : undefined;
    const existingRecord = explicitId ? existing.find((r) => r.id === explicitId) : key ? byKey.get(key) : undefined;
    if (dupInFile && onDuplicate !== "create") {
      report.skipped++;
      report.rows.push({ row: rowNo, action: "skip", id: dupInFile, messages: [...messages, `Duplicate of row with the same ${key!.split(":")[0]} earlier in the file.`] });
      return;
    }
    try {
      if (existingRecord && onDuplicate !== "create") {
        if (onDuplicate === "skip") {
          report.skipped++;
          report.rows.push({ row: rowNo, action: "skip", id: existingRecord.id, label: recordLabel(object, existingRecord), messages: [...messages, "Already exists."] });
          return;
        }
        // Update: only fill / overwrite the mapped, non-empty values.
        const prepared = prepareRecordFields(vctx, object, input, existingRecord, { unknownFields: "drop" });
        if (prepared.changed.length || (ownerId && ownerId !== existingRecord.ownerId)) {
          mutations.push(recordPatchMutation(ctx, existingRecord, prepared.fields, prepared.changed, ownerId ? { ownerId } : {}));
          updatedDocs.push({ before: existingRecord, changed: prepared.changed });
        }
        report.updated++;
        if (key) seenInFile.set(key, existingRecord.id);
        report.rows.push({ row: rowNo, action: "update", id: existingRecord.id, label: recordLabel(object, existingRecord), ...(messages.length ? { messages } : {}) });
        return;
      }
      const prepared = prepareRecordFields(vctx, object, input, null, { unknownFields: "drop" });
      const id = explicitId && !existing.some((r) => r.id === explicitId) ? explicitId : newId(now);
      const record: CrmRecord = {
        id,
        object: object.id,
        fields: prepared.fields,
        ...(ownerId ?? actorId(ctx) ? { ownerId: ownerId ?? actorId(ctx) } : {}),
        createdAt: now,
        updatedAt: now,
        ...(actorId(ctx) ? { createdBy: actorId(ctx), updatedBy: actorId(ctx) } : {}),
      };
      mutations.push({ op: "set", collection: "records", doc: asDoc(record) });
      createdDocs.push(record);
      if (key) seenInFile.set(key, id);
      report.created++;
      report.rows.push({ row: rowNo, action: "create", id, label: recordLabel(object, record), ...(messages.length ? { messages } : {}) });
    } catch (err) {
      report.failed++;
      const details = (err as OpsError).details as { message: string }[] | undefined;
      report.rows.push({ row: rowNo, action: "error", messages: [...messages, ...(details?.map((d) => d.message) ?? [(err as Error).message])] });
    }
  });

  function resolveRelation(field: FieldDef, raw: string): unknown {
    const target = field.relation!.object;
    const parts = field.relation!.cardinality === "many" ? raw.split(/[,;|]/) : [raw];
    const ids: string[] = [];
    for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
      const m = lookupFor(target);
      const hit = m.get(part) ?? m.get(part.toLowerCase()) ?? m.get(normalizeDomain(part)) ?? m.get(normalizeEmail(part));
      if (hit) {
        ids.push(hit);
        continue;
      }
      if (createRelated && target === "companies") {
        const targetObject = objectOf(ctx.store, target);
        const isDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(part) && !part.includes(" ");
        const id = newId(now);
        const fields: Record<string, unknown> = isDomain ? { name: part.split(".")[0].replace(/^./, (c) => c.toUpperCase()), domain: `https://${normalizeDomain(part)}` } : { name: part };
        const rec: CrmRecord = { id, object: target, fields, ...(actorId(ctx) ? { ownerId: actorId(ctx), createdBy: actorId(ctx) } : {}), createdAt: now, updatedAt: now };
        pendingRelated.set(id, rec);
        m.set(part.toLowerCase(), id);
        if (isDomain) m.set(normalizeDomain(part), id);
        mutations.push({ op: "set", collection: "records", doc: asDoc(rec) });
        createdDocs.push(rec);
        report.createdRelated.push({ object: target, label: recordLabel(targetObject, rec) });
        ids.push(id);
      }
    }
    if (!ids.length) return undefined;
    return field.relation!.cardinality === "many" ? ids : ids[0];
  }

  if (opts.dryRun) return report;
  if (report.newOptions.length) mutations.unshift({ op: "set", collection: "objects", doc: asDoc({ ...object, updatedAt: now }) });
  if (mutations.length) {
    await ctx.store.write(mutations, { message: `Import ${report.created} new / ${report.updated} updated ${object.labelPlural}` });
    for (const r of createdDocs) await emit(ctx, "record.created", { record: r });
    for (const u of updatedDocs) {
      const after = ctx.store.get("records", u.before.id) as unknown as CrmRecord;
      if (after) await emit(ctx, "record.updated", { record: after, before: u.before, changed: u.changed });
    }
  }
  return report;
}

function uniqueOptionId(field: FieldDef, label: string): string {
  const base =
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "option";
  const taken = new Set((field.options ?? []).map((o) => o.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

