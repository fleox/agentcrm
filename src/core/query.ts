// In-memory filtering / sorting / pagination of records (the whole dataset
// is in memory — see DataStore). Used by views, ops/records.list, reports
// and the automations engine (conditions).
//
// Filter semantics, by op:
//   eq / neq          equality. Text: case-insensitive. select: option id
//                     (or label). multiSelect / tags / relation many: "contains
//                     this value". date: same calendar day.
//   contains /        substring (case-insensitive) of the displayed value;
//   notContains       for relations, of the related records' labels.
//   empty / notEmpty  isEmptyFieldValue.
//   gt gte lt lte     numeric (numbers, dates, ratings).
//   in / notIn        value is an array; record value (any of, for arrays) ∈ array.
//   before / after    dates / datetimes (value: ISO date, epoch ms, "today", "now").
//   withinDays        value N: date within the next N days (N > 0) or the
//                     last |N| days (N < 0), relative to ctx.now.
// Filters on "id", "ownerId", "createdAt", "updatedAt", "createdBy",
// "updatedBy" target the record's own properties.

import type { CrmRecord, FieldDef, Filter, ObjectDef, Sort } from "./types";
import { comparableValue, dateValueToMs, findOption, formatFieldValue, isEmptyFieldValue, isEmptyValue, parseDateValue, parseNumber, type FormatContext } from "./fields";

export interface QueryContext extends FormatContext {
  object: ObjectDef;
  now?: number;
}

const DAY = 86_400_000;

const SYSTEM_FIELDS: Record<string, FieldDef> = {
  id: { id: "id", label: "ID", type: "text", system: true },
  ownerId: { id: "ownerId", label: "Owner", type: "user", system: true },
  createdBy: { id: "createdBy", label: "Created by", type: "user", system: true },
  updatedBy: { id: "updatedBy", label: "Updated by", type: "user", system: true },
  createdAt: { id: "createdAt", label: "Created", type: "datetime", system: true },
  updatedAt: { id: "updatedAt", label: "Updated", type: "datetime", system: true },
};

export function systemFieldDef(id: string): FieldDef | undefined {
  return SYSTEM_FIELDS[id];
}

export function isSystemProp(id: string): boolean {
  return id in SYSTEM_FIELDS;
}

export function resolveField(object: ObjectDef, fieldId: string): FieldDef | undefined {
  return object.fields.find((f) => f.id === fieldId) ?? SYSTEM_FIELDS[fieldId];
}

export function getRecordValue(record: CrmRecord, fieldId: string): unknown {
  if (fieldId in SYSTEM_FIELDS) return (record as unknown as Record<string, unknown>)[fieldId];
  return record.fields[fieldId];
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

function resolveDateArg(value: unknown, now: number): number | null {
  if (value === "now") return now;
  if (value === "today") {
    const d = new Date(now);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  if (typeof value === "string") {
    const rel = /^([+-]?\d+)d$/.exec(value.trim());
    if (rel) return now + Number(rel[1]) * DAY;
    const iso = parseDateValue(value);
    if (iso && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return dateValueToMs(iso);
  }
  return dateValueToMs(value);
}

function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function textOf(field: FieldDef, value: unknown, ctx: QueryContext): string {
  return formatFieldValue(field, value, ctx).toLowerCase();
}

// Normalises a filter operand for comparison with stored values.
function normalizeOperand(field: FieldDef, operand: unknown): unknown {
  if ((field.type === "select" || field.type === "multiSelect") && operand !== undefined && operand !== null) {
    return findOption(field, operand)?.id ?? String(operand);
  }
  return operand;
}

function equals(field: FieldDef, stored: unknown, operand: unknown, ctx: QueryContext): boolean {
  const op = normalizeOperand(field, operand);
  switch (field.type) {
    case "number":
    case "currency":
    case "percent":
    case "rating": {
      const a = typeof stored === "number" ? stored : parseNumber(stored);
      const b = parseNumber(op);
      return a !== null && b !== null && a === b;
    }
    case "boolean":
      return Boolean(stored) === (op === true || op === "true" || op === 1 || op === "1" || op === "yes");
    case "date":
    case "datetime": {
      const a = dateValueToMs(stored);
      const b = resolveDateArg(op, ctx.now ?? Date.now());
      return a !== null && b !== null && sameDay(a, b);
    }
    case "multiSelect":
    case "tags":
      return asArray(stored).some((v) => String(v).toLowerCase() === String(op).toLowerCase());
    case "relation":
      return asArray(stored).some((v) => String(v) === String(op));
    case "select":
    case "user":
      return stored !== undefined && stored !== null && String(stored) === String(op);
    default:
      return typeof stored === "string" && typeof op !== "object" && stored.trim().toLowerCase() === String(op ?? "").trim().toLowerCase();
  }
}

function contains(field: FieldDef, stored: unknown, operand: unknown, ctx: QueryContext): boolean {
  const needle = String(operand ?? "").trim().toLowerCase();
  if (!needle) return true;
  if (field.type === "relation") {
    const target = field.relation?.object ?? "";
    return asArray(stored).some((id) => {
      const label = ctx.recordLabel?.(target, String(id)) ?? String(id);
      return label.toLowerCase().includes(needle);
    });
  }
  return textOf(field, stored, ctx).includes(needle);
}

function compareNum(field: FieldDef, stored: unknown, operand: unknown, ctx: QueryContext): [number, number] | null {
  const isDate = field.type === "date" || field.type === "datetime";
  const a = isDate ? dateValueToMs(stored) : typeof stored === "number" ? stored : parseNumber(stored);
  const b = isDate ? resolveDateArg(operand, ctx.now ?? Date.now()) : parseNumber(operand);
  return a === null || b === null ? null : [a, b];
}

export function matchesFilter(record: CrmRecord, filter: Filter, ctx: QueryContext): boolean {
  const field = resolveField(ctx.object, filter.field);
  // Unknown field (deleted since the view was saved): never excludes.
  if (!field) return true;
  const stored = getRecordValue(record, filter.field);
  const value = filter.value;
  switch (filter.op) {
    case "eq":
      return equals(field, stored, value, ctx);
    case "neq":
      return !equals(field, stored, value, ctx);
    case "contains":
      return contains(field, stored, value, ctx);
    case "notContains":
      return !contains(field, stored, value, ctx);
    case "empty":
      return isEmptyFieldValue(field, stored);
    case "notEmpty":
      return !isEmptyFieldValue(field, stored);
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "before":
    case "after": {
      const pair = compareNum(field, stored, value, ctx);
      if (!pair) return false;
      const [a, b] = pair;
      if (filter.op === "gt" || filter.op === "after") return a > b;
      if (filter.op === "gte") return a >= b;
      if (filter.op === "lt" || filter.op === "before") return a < b;
      return a <= b;
    }
    case "in":
    case "notIn": {
      const set = asArray(value).map((v) => String(normalizeOperand(field, v)));
      const hit = asArray(stored).some((v) => set.includes(String(v)));
      return filter.op === "in" ? hit : !hit;
    }
    case "withinDays": {
      const ms = dateValueToMs(stored);
      const days = parseNumber(value);
      if (ms === null || days === null) return false;
      const now = ctx.now ?? Date.now();
      return days >= 0 ? ms >= now - DAY && ms <= now + days * DAY : ms >= now + days * DAY && ms <= now;
    }
    default:
      return true;
  }
}

export function applyFilters(records: CrmRecord[], filters: Filter[] | undefined, ctx: QueryContext): CrmRecord[] {
  if (!filters?.length) return records;
  return records.filter((r) => filters.every((f) => matchesFilter(r, f, ctx)));
}

export function applySorts(records: CrmRecord[], sorts: Sort[] | undefined, ctx: QueryContext): CrmRecord[] {
  if (!sorts?.length) return records;
  const keyed = records.map((r) => ({
    r,
    keys: sorts.map((s) => comparableValue(resolveField(ctx.object, s.field), getRecordValue(r, s.field), ctx)),
  }));
  keyed.sort((a, b) => {
    for (let i = 0; i < sorts.length; i++) {
      const x = a.keys[i];
      const y = b.keys[i];
      // Empty values last, whatever the direction.
      if (x === null && y === null) continue;
      if (x === null) return 1;
      if (y === null) return -1;
      let c: number;
      if (typeof x === "number" && typeof y === "number") c = x - y;
      else c = String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
      if (c !== 0) return sorts[i].dir === "desc" ? -c : c;
    }
    return a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0;
  });
  return keyed.map((k) => k.r);
}

export interface PageRequest {
  offset?: number;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export function paginate<T>(items: T[], req: PageRequest = {}): Page<T> {
  const offset = Math.max(0, Math.floor(req.offset ?? 0));
  const limit = req.limit === undefined ? items.length : Math.max(0, Math.floor(req.limit));
  const slice = items.slice(offset, offset + limit);
  return { items: slice, total: items.length, offset, limit, hasMore: offset + slice.length < items.length };
}

// Groups records by a select / user / relation-one / boolean field (kanban).
// Keys keep the option order; records without a value go under "".
export function groupRecords(records: CrmRecord[], field: FieldDef): Map<string, CrmRecord[]> {
  const groups = new Map<string, CrmRecord[]>();
  if (field.type === "select") for (const o of field.options ?? []) groups.set(o.id, []);
  for (const r of records) {
    const v = getRecordValue(r, field.id);
    const key = isEmptyValue(v) ? "" : Array.isArray(v) ? String(v[0]) : String(v);
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  return groups;
}
