// Field values: emptiness, coercion (from CSV / CLI / AI input), validation
// and display formatting, per FieldType. Pure — no React, no store.
//
// Storage formats (what ends up in CrmRecord.fields):
//   text, longText, email, phone, url  string (email lower-cased, url with scheme)
//   number, currency, percent          number (percent: 0–100, 45 = 45 %)
//   rating                             integer 1–5
//   date                               "YYYY-MM-DD" string (no timezone)
//   datetime                           epoch milliseconds
//   boolean                            boolean
//   select                             option id (string)
//   multiSelect                        option ids (string[])
//   tags                               free strings (string[], de-duplicated)
//   relation  one                      record id (string)
//   relation  many                     record ids (string[])
//   user                               CrmUser id (string)
//   address                            AddressValue object
// Empty values are removed from the record (undefined), never stored as "".

import type { AddressValue, CrmRecord, FieldDef, FieldType, ObjectDef, SelectOption } from "./types";

// Color tokens for select options / pipeline stages. The UI maps them to
// Tailwind classes (components/ui/colors.ts).
export const OPTION_COLORS = ["gray", "blue", "green", "yellow", "orange", "red", "purple", "pink", "teal", "indigo"] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

export function colorAt(index: number): OptionColor {
  return OPTION_COLORS[((index % OPTION_COLORS.length) + OPTION_COLORS.length) % OPTION_COLORS.length];
}

export type FieldErrorCode =
  | "required"
  | "invalidText"
  | "invalidNumber"
  | "outOfRange"
  | "invalidDate"
  | "invalidBoolean"
  | "invalidEmail"
  | "invalidPhone"
  | "invalidUrl"
  | "unknownOption"
  | "invalidRelation"
  | "invalidUser"
  | "invalidAddress"
  | "unknownField"
  | "readOnly"
  | "notUnique";

export interface FieldError {
  field: string;
  code: FieldErrorCode;
  message: string;
}

export class FieldValidationError extends Error {
  constructor(readonly errors: FieldError[]) {
    super(errors.map((e) => e.message).join("; "));
    this.name = "FieldValidationError";
  }
}

export type CoerceResult = { ok: true; value: unknown } | { ok: false; code: FieldErrorCode; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9 ().\-/]{5,25}(\s*(x|ext\.?)\s*\d{1,6})?$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "oui", "on", "x", "✓"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "non", "off", ""]);

// ─── Emptiness ───────────────────────────────────────────────────────────

export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return Number.isNaN(value);
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).every((v) => isEmptyValue(v));
  return false;
}

export function isEmptyFieldValue(field: FieldDef, value: unknown): boolean {
  if (field.type === "boolean") return value === undefined || value === null;
  if (field.type === "rating") return value === undefined || value === null || value === 0;
  return isEmptyValue(value);
}

// ─── Helpers ─────────────────────────────────────────────────────────────

export function findOption(field: FieldDef, raw: unknown): SelectOption | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  const options = field.options ?? [];
  const lower = s.toLowerCase();
  return options.find((o) => o.id === s) ?? options.find((o) => o.label.toLowerCase() === lower) ?? options.find((o) => o.id.toLowerCase() === lower);
}

export function optionLabel(field: FieldDef, id: unknown): string {
  return findOption(field, id)?.label ?? (id == null ? "" : String(id));
}

function splitList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.flatMap((v) => (v == null ? [] : [String(v).trim()])).filter(Boolean);
  if (raw === undefined || raw === null) return [];
  return String(raw)
    .split(/[,;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// "1 234,56" / "1,234.56" / "$1,234" / "12k" → number.
export function parseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/[\s  ]/g, "").replace(/[€$£¥₹%]|[A-Z]{3}$/gi, "");
  if (!s) return null;
  let mult = 1;
  const suffix = /([kmb])$/i.exec(s);
  if (suffix) {
    mult = { k: 1e3, m: 1e6, b: 1e9 }[suffix[1].toLowerCase() as "k" | "m" | "b"];
    s = s.slice(0, -1);
  }
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // Whichever comes last is the decimal separator.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // "1,234" (thousands) vs "12,5" (decimal): 3 digits after → thousands.
    s = /,\d{3}$/.test(s) && s.split(",").length >= 2 && !/^0,/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  }
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s) * mult;
  return Number.isFinite(n) ? n : null;
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Accepts "YYYY-MM-DD", ISO datetimes, "DD/MM/YYYY", "MM/DD/YYYY" (when
// unambiguous or `dayFirst`), Date and epoch ms.
export function parseDateValue(raw: unknown, opts: { dayFirst?: boolean } = {}): string | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : toIsoDate(raw);
  if (typeof raw === "number") return Number.isFinite(raw) ? toIsoDate(new Date(raw)) : null;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const iso = DATE_RE.exec(s);
  if (iso) return validYmd(+iso[1], +iso[2], +iso[3]);
  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (slash) {
    let a = +slash[1];
    let b = +slash[2];
    let y = +slash[3];
    if (y < 100) y += 2000;
    // Disambiguate: if the first part can't be a month it's a day.
    const dayFirst = a > 12 ? true : b > 12 ? false : (opts.dayFirst ?? false);
    if (!dayFirst) [a, b] = [b, a];
    return validYmd(y, b, a);
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    // A datetime string: keep its calendar date as written when it has one.
    const prefix = /^(\d{4})-(\d{2})-(\d{2})T/.exec(s);
    return prefix ? validYmd(+prefix[1], +prefix[2], +prefix[3]) : toIsoDate(new Date(t));
  }
  return null;
}

function validYmd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
}

export function parseDateTimeValue(raw: unknown): number | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.getTime();
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.trim();
  if (/^\d{10,13}$/.test(s)) return Number(s) * (s.length === 10 ? 1000 : 1);
  const date = parseDateValue(s);
  const t = Date.parse(DATE_RE.test(s) ? `${s}T00:00:00` : s);
  if (!Number.isNaN(t)) return t;
  return date ? Date.parse(`${date}T00:00:00`) : null;
}

// Epoch ms of a stored date / datetime value (local midnight for dates).
export function dateValueToMs(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const m = DATE_RE.exec(value);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  if (value instanceof Date) return value.getTime();
  return null;
}

export function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return withScheme.replace(/\/+$/, "") === `${u.protocol}//${u.host}` ? `${u.protocol}//${u.host}` : u.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

// "https://www.Acme.com/about" → "acme.com". Used for company dedupe/search.
export function normalizeDomain(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let s = raw.trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "");
  s = s.split(/[/?#]/)[0].split("@").pop() ?? "";
  return s.replace(/:\d+$/, "").replace(/\.$/, "");
}

export function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

// ─── Coercion ────────────────────────────────────────────────────────────

const fail = (code: FieldErrorCode, message: string): CoerceResult => ({ ok: false, code, message });
const ok = (value: unknown): CoerceResult => ({ ok: true, value });

export interface CoerceOptions {
  // Interpret "03/04/2024" as 3 April (default: US month-first when ambiguous).
  dayFirst?: boolean;
  // Unknown select labels: create nothing and fail (default), or keep the
  // raw value as-is ("keep") — import dry runs report them.
  unknownOptions?: "fail" | "keep";
}

// Converts any reasonable input (string from CSV / CLI, JSON from an AI
// tool, typed value from the UI) into the storage format. Empty input →
// { ok: true, value: undefined }.
export function coerceFieldValue(field: FieldDef, raw: unknown, opts: CoerceOptions = {}): CoerceResult {
  if (field.type !== "boolean" && (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "") || (Array.isArray(raw) && raw.length === 0))) {
    return ok(undefined);
  }
  const label = field.label;
  switch (field.type) {
    case "text":
    case "longText": {
      if (typeof raw === "object") return fail("invalidText", `${label}: expected text.`);
      const s = String(raw);
      return ok(field.type === "text" ? s.trim() : s);
    }
    case "email": {
      const s = normalizeEmail(String(raw));
      return EMAIL_RE.test(s) ? ok(s) : fail("invalidEmail", `${label}: "${raw}" is not a valid email address.`);
    }
    case "phone": {
      const s = String(raw).trim();
      return PHONE_RE.test(s) ? ok(s) : fail("invalidPhone", `${label}: "${raw}" is not a valid phone number.`);
    }
    case "url": {
      const s = normalizeUrl(String(raw));
      return s ? ok(s) : fail("invalidUrl", `${label}: "${raw}" is not a valid URL.`);
    }
    case "number":
    case "currency":
    case "percent": {
      const n = parseNumber(raw);
      if (n === null) return fail("invalidNumber", `${label}: "${raw}" is not a number.`);
      if (field.type === "percent" && typeof raw === "number" && raw > 0 && raw < 1 && !Number.isInteger(raw)) {
        // 0.45 from a spreadsheet = 45 %.
        return ok(Math.round(raw * 10000) / 100);
      }
      return ok(n);
    }
    case "rating": {
      const n = parseNumber(raw);
      if (n === null) return fail("invalidNumber", `${label}: "${raw}" is not a rating.`);
      const r = Math.round(n);
      if (r === 0) return ok(undefined);
      return r >= 1 && r <= 5 ? ok(r) : fail("outOfRange", `${label}: rating must be between 1 and 5.`);
    }
    case "date": {
      const d = parseDateValue(raw, opts);
      return d ? ok(d) : fail("invalidDate", `${label}: "${raw}" is not a valid date.`);
    }
    case "datetime": {
      const t = parseDateTimeValue(raw);
      return t !== null ? ok(t) : fail("invalidDate", `${label}: "${raw}" is not a valid date/time.`);
    }
    case "boolean": {
      if (raw === undefined || raw === null) return ok(undefined);
      if (typeof raw === "boolean") return ok(raw);
      if (typeof raw === "number") return ok(raw !== 0);
      const s = String(raw).trim().toLowerCase();
      if (TRUE_WORDS.has(s)) return ok(true);
      if (FALSE_WORDS.has(s)) return s === "" ? ok(undefined) : ok(false);
      return fail("invalidBoolean", `${label}: "${raw}" is not yes/no.`);
    }
    case "select": {
      const value = Array.isArray(raw) ? raw[0] : raw;
      const opt = findOption(field, value);
      if (opt) return ok(opt.id);
      if (opts.unknownOptions === "keep") return ok(String(value).trim());
      return fail("unknownOption", `${label}: "${value}" is not one of ${(field.options ?? []).map((o) => o.label).join(", ") || "(no options)"}.`);
    }
    case "multiSelect": {
      const out: string[] = [];
      for (const part of splitList(raw)) {
        const opt = findOption(field, part);
        if (opt) {
          if (!out.includes(opt.id)) out.push(opt.id);
        } else if (opts.unknownOptions === "keep") {
          if (!out.includes(part)) out.push(part);
        } else {
          return fail("unknownOption", `${label}: "${part}" is not one of ${(field.options ?? []).map((o) => o.label).join(", ")}.`);
        }
      }
      return ok(out.length ? out : undefined);
    }
    case "tags": {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const t of splitList(raw)) {
        const key = t.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          out.push(t);
        }
      }
      return ok(out.length ? out : undefined);
    }
    case "relation": {
      const many = field.relation?.cardinality === "many";
      const ids = splitList(raw);
      if (ids.some((id) => !/^[\w-]{1,64}$/.test(id))) return fail("invalidRelation", `${label}: expected record id(s).`);
      if (many) return ok(ids.length ? [...new Set(ids)] : undefined);
      if (ids.length > 1) return fail("invalidRelation", `${label}: only one record can be linked.`);
      return ok(ids[0]);
    }
    case "user": {
      const value = Array.isArray(raw) ? raw[0] : raw;
      const s = String(value).trim();
      return /^[\w@.+-]{1,128}$/.test(s) ? ok(s) : fail("invalidUser", `${label}: expected a user id.`);
    }
    case "address": {
      if (typeof raw === "string") return ok({ street: raw.trim() } satisfies AddressValue);
      if (typeof raw !== "object" || Array.isArray(raw)) return fail("invalidAddress", `${label}: expected an address.`);
      const src = raw as Record<string, unknown>;
      const out: AddressValue = {};
      for (const k of ["street", "city", "postalCode", "region", "country"] as const) {
        const v = src[k];
        if (v !== undefined && v !== null && String(v).trim()) out[k] = String(v).trim();
      }
      return ok(Object.keys(out).length ? out : undefined);
    }
  }
}

// ─── Validation of a whole record ────────────────────────────────────────

export interface ValidateOptions extends CoerceOptions {
  // Only the given keys are checked (patch): required fields absent from
  // `input` are not reported.
  partial?: boolean;
  // Unknown field ids: error (default) or silently dropped.
  unknownFields?: "error" | "drop";
}

export interface ValidateResult {
  ok: boolean;
  // Coerced values for every provided field (undefined = clear it).
  values: Record<string, unknown>;
  errors: FieldError[];
}

export function validateRecordFields(object: ObjectDef, input: Record<string, unknown>, opts: ValidateOptions = {}): ValidateResult {
  const byId = new Map(object.fields.map((f) => [f.id, f]));
  const values: Record<string, unknown> = {};
  const errors: FieldError[] = [];
  for (const [key, raw] of Object.entries(input)) {
    const field = byId.get(key);
    if (!field) {
      if (opts.unknownFields !== "drop") errors.push({ field: key, code: "unknownField", message: `Unknown field "${key}" on ${object.labelPlural}.` });
      continue;
    }
    const res = coerceFieldValue(field, raw, opts);
    if (!res.ok) errors.push({ field: key, code: res.code, message: res.message });
    else values[key] = res.value;
  }
  for (const field of object.fields) {
    if (!field.required) continue;
    const provided = Object.prototype.hasOwnProperty.call(input, field.id);
    if (opts.partial && !provided) continue;
    if (isEmptyFieldValue(field, values[field.id]) && !errors.some((e) => e.field === field.id)) {
      errors.push({ field: field.id, code: "required", message: `${field.label} is required.` });
    }
  }
  return { ok: errors.length === 0, values, errors };
}

// Default values for a new record (FieldDef.defaultValue).
export function defaultFieldValues(object: ObjectDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of object.fields) {
    if (f.defaultValue === undefined) continue;
    const res = coerceFieldValue(f, f.defaultValue);
    if (res.ok && res.value !== undefined) out[f.id] = res.value;
  }
  return out;
}

// ─── Display ─────────────────────────────────────────────────────────────

export interface FormatContext {
  // BCP-47 locale for Intl ("en-US").
  locale?: string;
  // Fallback currency for currency fields without one.
  currency?: string;
  // Resolves a related record's label (relation fields).
  recordLabel?: (object: string, id: string) => string | undefined;
  // Resolves a user's display name (user fields).
  userName?: (id: string) => string | undefined;
}

export function formatNumber(n: number, locale = "en-US", opts: Intl.NumberFormatOptions = {}): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, ...opts }).format(n);
  } catch {
    return String(n);
  }
}

export function formatCurrency(n: number, currency = "USD", locale = "en-US", compact = false): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: compact || Number.isInteger(n) ? 0 : 2,
      ...(compact ? { notation: "compact" } : {}),
    }).format(n);
  } catch {
    return `${formatNumber(n, locale)} ${currency}`;
  }
}

export function formatAddress(a: AddressValue | null | undefined): string {
  if (!a || typeof a !== "object") return "";
  const cityLine = [a.postalCode, a.city].filter(Boolean).join(" ");
  return [a.street, cityLine, a.region, a.country].filter(Boolean).join(", ");
}

// Plain-text rendering of a stored value (tables, CSV export, AI tools).
export function formatFieldValue(field: FieldDef, value: unknown, ctx: FormatContext = {}): string {
  if (isEmptyFieldValue(field, value)) return "";
  const locale = ctx.locale ?? "en-US";
  switch (field.type) {
    case "number":
      return typeof value === "number" ? formatNumber(value, locale) : String(value);
    case "currency":
      return typeof value === "number" ? formatCurrency(value, field.currency ?? ctx.currency ?? "USD", locale) : String(value);
    case "percent":
      return typeof value === "number" ? `${formatNumber(value, locale)} %`.replace(" %", locale.startsWith("en") ? "%" : " %") : String(value);
    case "rating":
      return "★".repeat(Number(value) || 0);
    case "date": {
      const ms = dateValueToMs(value);
      return ms === null ? String(value) : new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(ms);
    }
    case "datetime": {
      const ms = dateValueToMs(value);
      return ms === null
        ? String(value)
        : new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(ms);
    }
    case "boolean":
      return value ? "Yes" : "No";
    case "select":
      return optionLabel(field, value);
    case "multiSelect":
      return (Array.isArray(value) ? value : [value]).map((v) => optionLabel(field, v)).join(", ");
    case "tags":
      return (Array.isArray(value) ? value : [value]).map(String).join(", ");
    case "relation": {
      const ids = Array.isArray(value) ? value : [value];
      const target = field.relation?.object ?? "";
      return ids.map((id) => ctx.recordLabel?.(target, String(id)) ?? String(id)).join(", ");
    }
    case "user":
      return ctx.userName?.(String(value)) ?? String(value);
    case "address":
      return formatAddress(value as AddressValue);
    default:
      return String(value);
  }
}

// Comparable key for sorting: numbers for numeric / date types, lower-case
// strings otherwise. Empty values sort last (handled by query.ts).
export function comparableValue(field: FieldDef | undefined, value: unknown, ctx: FormatContext = {}): number | string | null {
  if (value === undefined || value === null || value === "") return null;
  if (!field) return typeof value === "number" ? value : String(value).toLowerCase();
  switch (field.type) {
    case "number":
    case "currency":
    case "percent":
    case "rating":
      return typeof value === "number" ? value : parseNumber(value);
    case "date":
    case "datetime":
      return dateValueToMs(value);
    case "boolean":
      return value ? 1 : 0;
    case "select": {
      // Sort by option order, the way kanban columns are ordered.
      const idx = (field.options ?? []).findIndex((o) => o.id === value);
      return idx === -1 ? String(value).toLowerCase() : idx;
    }
    default: {
      const text = formatFieldValue(field, value, ctx);
      return text ? text.toLowerCase() : null;
    }
  }
}

export function getField(object: ObjectDef, fieldId: string): FieldDef | undefined {
  return object.fields.find((f) => f.id === fieldId);
}

// Display label of a record (its object's labelField), with fallbacks.
export function recordLabel(object: ObjectDef | undefined, record: Pick<CrmRecord, "id" | "fields">): string {
  if (!object) return record.id;
  const primary = record.fields[object.labelField];
  if (typeof primary === "string" && primary.trim()) return primary.trim();
  const first = record.fields.firstName;
  const last = record.fields.lastName;
  const full = [first, last].filter((v) => typeof v === "string" && v.trim()).join(" ");
  if (full) return full;
  for (const key of ["email", "domain", "title", "subject"]) {
    const v = record.fields[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return `${object.labelSingular} ${record.id.slice(-4)}`;
}

// Which value types can be migrated to which (schema type change).
export function canConvertType(from: FieldType, to: FieldType): boolean {
  if (from === to) return true;
  if (from === "relation" || to === "relation") return false;
  return true;
}

// Best-effort conversion of an existing value when a field's type changes.
// Returns undefined when the value can't be represented in the new type.
export function convertValue(from: FieldDef, to: FieldDef, value: unknown): unknown {
  if (isEmptyFieldValue(from, value)) return undefined;
  if (from.type === to.type && from.type !== "select" && from.type !== "multiSelect") return value;
  // Go through the human representation (option labels, formatted dates as ISO).
  let human: unknown = value;
  if (from.type === "select") human = optionLabel(from, value);
  else if (from.type === "multiSelect") human = (Array.isArray(value) ? value : [value]).map((v) => optionLabel(from, v));
  else if (from.type === "address") human = formatAddress(value as AddressValue);
  else if (from.type === "datetime" && to.type === "date") human = typeof value === "number" ? toIsoDate(new Date(value)) : value;
  else if (from.type === "boolean" && (to.type === "text" || to.type === "longText")) human = value ? "Yes" : "No";
  if (to.type === "select" && Array.isArray(human)) human = human[0];
  const res = coerceFieldValue(to, human, { unknownOptions: "fail" });
  return res.ok ? res.value : undefined;
}
