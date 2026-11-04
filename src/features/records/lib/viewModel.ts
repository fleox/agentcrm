// Pure helpers behind the object list page: columns, filter operators per
// field type, record defaults derived from filters, kanban columns. No
// React here (unit-testable).

import { findOption, isEmptyFieldValue, recordLabel } from "../../../core/fields";
import { applyFilters, applySorts, resolveField, getRecordValue, type QueryContext } from "../../../core/query";
import type { CrmRecord, CrmUser, FieldDef, FieldType, Filter, FilterOp, ObjectDef, Pipeline, PipelineStage, Sort, ViewDef } from "../../../core/types";

// Record properties that can be shown as columns next to object fields.
export const SYSTEM_COLUMNS = ["ownerId", "createdAt", "updatedAt"] as const;

export function columnField(object: ObjectDef, id: string): FieldDef | undefined {
  return resolveField(object, id);
}

// Columns to render: the label field first (always), then the view's
// columns that still exist.
export function visibleColumns(object: ObjectDef, columns: string[]): string[] {
  const valid = columns.filter((c) => c !== object.labelField && !!resolveField(object, c));
  return [object.labelField, ...new Set(valid)];
}

// Every column the user may toggle (object fields + system props).
export function availableColumns(object: ObjectDef): FieldDef[] {
  const fields = object.fields.filter((f) => !f.hidden && f.id !== object.labelField);
  return [...fields, ...SYSTEM_COLUMNS.map((id) => resolveField(object, id)!).filter(Boolean)];
}

export function filterableFields(object: ObjectDef): FieldDef[] {
  return [...object.fields.filter((f) => !f.hidden), ...SYSTEM_COLUMNS.map((id) => resolveField(object, id)!).filter(Boolean)];
}

const TEXTY: FilterOp[] = ["contains", "notContains", "eq", "neq", "empty", "notEmpty"];
const NUMERIC: FilterOp[] = ["eq", "neq", "gt", "gte", "lt", "lte", "empty", "notEmpty"];
const DATES: FilterOp[] = ["eq", "before", "after", "withinDays", "empty", "notEmpty"];
const CHOICE: FilterOp[] = ["in", "notIn", "eq", "neq", "empty", "notEmpty"];
const MULTI: FilterOp[] = ["eq", "neq", "in", "notIn", "empty", "notEmpty"];

export function filterOpsFor(type: FieldType): FilterOp[] {
  switch (type) {
    case "number":
    case "currency":
    case "percent":
    case "rating":
      return NUMERIC;
    case "date":
    case "datetime":
      return DATES;
    case "select":
    case "user":
      return CHOICE;
    case "multiSelect":
    case "tags":
      return MULTI;
    case "relation":
      return ["eq", "neq", "contains", "notContains", "empty", "notEmpty"];
    case "boolean":
      return ["eq", "neq"];
    case "address":
    case "longText":
      return ["contains", "notContains", "empty", "notEmpty"];
    default:
      return TEXTY;
  }
}

export function opNeedsValue(op: FilterOp): boolean {
  return op !== "empty" && op !== "notEmpty";
}

// Default operand when a filter is created / its op changes.
export function defaultFilterValue(field: FieldDef, op: FilterOp): unknown {
  if (!opNeedsValue(op)) return undefined;
  if (op === "in" || op === "notIn") return [];
  if (op === "withinDays") return 7;
  if (field.type === "boolean") return true;
  return undefined;
}

export function isFilterComplete(f: Filter): boolean {
  if (!opNeedsValue(f.op)) return true;
  if (Array.isArray(f.value)) return f.value.length > 0;
  return f.value !== undefined && f.value !== null && f.value !== "";
}

// Rollup fields (`field.rollup`) store the values of every child record (an
// operator's status on all its markets). While the list is filtered on a
// rollup's scope relation (Markets = FR), the rollup is recomputed from the
// children in that scope only, so the cells, the other filters and the sorts
// all see the values for those markets. The scope relation itself (Markets)
// is narrowed to the filtered markets too. Unscoped: the stored values stand.
export function scopeRollups(
  records: CrmRecord[],
  allRecords: CrmRecord[],
  object: ObjectDef,
  filters: Filter[],
  qctx: Omit<QueryContext, "object">,
  objectOf: (id: string) => ObjectDef | undefined,
): { records: CrmRecord[]; scoped: string[]; narrowed: string[] } {
  const rollups = object.fields.filter((f) => f.rollup?.scope && filters.some((x) => x.field === f.rollup!.scope!.field && isFilterComplete(x)));
  if (!rollups.length) return { records, scoped: [], narrowed: [] };
  const scopeFields = [...new Set(rollups.map((f) => f.rollup!.scope!.field))];
  const childCache = new Map<string, Map<string, CrmRecord[]>>();
  const children = (f: FieldDef): Map<string, CrmRecord[]> => {
    const r = f.rollup!;
    const key = JSON.stringify([r.object, r.via, r.where ?? []]);
    if (!childCache.has(key)) {
      const childObject = objectOf(r.object);
      let list = allRecords.filter((c) => c.object === r.object && !c.deletedAt);
      if (childObject && r.where?.length) list = applyFilters(list, r.where, { ...qctx, object: childObject });
      const byParent = new Map<string, CrmRecord[]>();
      for (const c of list) for (const p of asIds(c.fields[r.via])) byParent.set(p, [...(byParent.get(p) ?? []), c]);
      childCache.set(key, byParent);
    }
    return childCache.get(key)!;
  };
  const out = records.map((rec) => {
    const fields = { ...rec.fields };
    for (const f of rollups) {
      const r = f.rollup!;
      const target = objectOf(r.object)?.fields.find((x) => x.id === r.scope!.via)?.relation?.object ?? "";
      const inScope = (children(f).get(rec.id) ?? []).filter((c) => inFilters(asIds(c.fields[r.scope!.via]), r.scope!.field, target, filters, qctx));
      fields[f.id] = rollupValue(f, inScope.map((c) => c.fields[r.field]));
    }
    for (const id of scopeFields) {
      const field = object.fields.find((x) => x.id === id);
      const target = field?.relation?.object ?? "";
      const kept = asIds(rec.fields[id]).filter((v) => inFilters([v], id, target, filters, qctx));
      fields[id] = field?.relation?.cardinality === "one" ? kept[0] : kept;
    }
    return { ...rec, fields };
  });
  // `narrowed`: every field whose shown value is partial (not editable inline).
  return { records: out, scoped: rollups.map((f) => f.id), narrowed: [...rollups.map((f) => f.id), ...scopeFields] };
}

function asIds(v: unknown): string[] {
  return (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]).map(String);
}

// Do these ids (of `target` records) pass every list filter on the scope
// relation `field`? eq / in / contains narrow; other operators (neq, notIn,
// empty…) select parents, not markets: they keep everything.
function inFilters(ids: string[], field: string, target: string, filters: Filter[], qctx: Omit<QueryContext, "object">): boolean {
  return filters.every((x) => x.field !== field || !isFilterComplete(x) || scopeMatches(ids, x, target, qctx));
}

function scopeMatches(ids: string[], filter: Filter, target: string, qctx: Omit<QueryContext, "object">): boolean {
  const values = asIds(filter.value);
  switch (filter.op) {
    case "eq":
    case "in":
      return ids.some((id) => values.includes(id));
    case "contains": {
      const needle = String(filter.value ?? "").trim().toLowerCase();
      return ids.some((id) => (qctx.recordLabel?.(target, id) ?? id).toLowerCase().includes(needle));
    }
    default:
      return true;
  }
}

// Child values → the rollup field's own type: options in option order,
// distinct tags / ids, a sum for numbers, distinct text joined.
function rollupValue(field: FieldDef, values: unknown[]): unknown {
  const flat = values.flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => v !== undefined && v !== null && v !== "");
  switch (field.type) {
    case "multiSelect":
    case "select": {
      const ids = new Set(flat.map((v) => findOption(field, v)?.id).filter((x): x is string => !!x));
      const ordered = (field.options ?? []).map((o) => o.id).filter((id) => ids.has(id));
      return field.type === "select" ? ordered[0] : ordered.length ? ordered : undefined;
    }
    case "relation": {
      const ids = [...new Set(flat.map(String))];
      return field.relation?.cardinality === "one" ? ids[0] : ids.length ? ids : undefined;
    }
    case "tags": {
      const tags = [...new Set(flat.map((v) => String(v).trim()))].sort((a, b) => a.localeCompare(b));
      return tags.length ? tags : undefined;
    }
    case "number":
    case "currency":
    case "percent":
      return flat.length ? flat.reduce<number>((s, v) => s + (Number(v) || 0), 0) : undefined;
    default: {
      const text = [...new Set(flat.map(String))];
      return text.length ? text.join(", ") : undefined;
    }
  }
}

// Field values implied by the active filters (a record created from a
// filtered view lands in it): eq on select / user / boolean / relation-one,
// single-value "in".
export function defaultsFromFilters(object: ObjectDef, filters: Filter[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of filters) {
    const field = object.fields.find((x) => x.id === f.field);
    if (!field) continue;
    if (f.op === "eq" && ["select", "user", "boolean", "text", "relation"].includes(field.type) && f.value !== undefined && f.value !== "") {
      if (field.type === "select") {
        const opt = field.options?.find((o) => o.id === f.value || o.label.toLowerCase() === String(f.value).toLowerCase());
        if (opt) out[field.id] = opt.id;
      } else if (field.type === "relation") {
        out[field.id] = field.relation?.cardinality === "many" ? [String(f.value)] : String(f.value);
      } else out[field.id] = f.value;
    } else if (f.op === "in" && Array.isArray(f.value) && f.value.length === 1 && (field.type === "select" || field.type === "user")) {
      out[field.id] = f.value[0];
    }
  }
  return out;
}

export interface RowQuery {
  filters: Filter[];
  sorts: Sort[];
  search: string;
}

// Filtered + sorted rows of a view (incomplete filters are ignored).
export function computeRows(records: CrmRecord[], object: ObjectDef, query: RowQuery, qctx: Omit<QueryContext, "object">): CrmRecord[] {
  const ctx: QueryContext = { ...qctx, object };
  let rows = applyFilters(records, query.filters.filter(isFilterComplete), ctx);
  const q = query.search.trim().toLowerCase();
  if (q) {
    const textFields = object.fields.filter((f) => ["text", "email", "phone", "url", "tags", "longText"].includes(f.type));
    rows = rows.filter((r) => {
      if (recordLabel(object, r).toLowerCase().includes(q)) return true;
      return textFields.some((f) => {
        const v = r.fields[f.id];
        if (Array.isArray(v)) return v.some((x) => String(x).toLowerCase().includes(q));
        return typeof v === "string" && v.toLowerCase().includes(q);
      });
    });
  }
  return applySorts(rows, query.sorts.length ? query.sorts : [{ field: "createdAt", dir: "desc" }], ctx);
}

// Fields a kanban (or table group-by) can group on.
export function groupableFields(object: ObjectDef): FieldDef[] {
  return object.fields.filter((f) => !f.hidden && (f.type === "select" || f.type === "user" || f.type === "boolean"));
}

export interface KanbanColumnDef {
  key: string; // "" = no value
  label: string;
  color: string;
  stage?: PipelineStage;
}

// Columns of a kanban: pipeline stages for a pipeline view, else the
// options of the group field (+ "No value").
export function kanbanColumns(field: FieldDef, opts: { pipeline?: Pipeline; users?: CrmUser[]; noValueLabel: string; yes?: string; no?: string }): KanbanColumnDef[] {
  if (opts.pipeline && opts.pipeline.stageField === field.id) {
    return opts.pipeline.stages.map((s) => ({ key: s.id, label: s.label, color: s.color, stage: s }));
  }
  if (field.type === "select") return [...(field.options ?? []).map((o) => ({ key: o.id, label: o.label, color: o.color })), { key: "", label: opts.noValueLabel, color: "gray" }];
  if (field.type === "boolean") return [{ key: "true", label: opts.yes ?? "Yes", color: "green" }, { key: "false", label: opts.no ?? "No", color: "gray" }];
  if (field.type === "user") return [...(opts.users ?? []).filter((u) => !u.disabled).map((u) => ({ key: u.id, label: u.name, color: "blue" })), { key: "", label: opts.noValueLabel, color: "gray" }];
  return [{ key: "", label: opts.noValueLabel, color: "gray" }];
}

export function kanbanKeyOf(record: CrmRecord, field: FieldDef): string {
  const v = getRecordValue(record, field.id);
  if (field.type === "boolean") return v ? "true" : "false";
  if (isEmptyFieldValue(field, v)) return "";
  return Array.isArray(v) ? String(v[0]) : String(v);
}

export function kanbanValueOf(field: FieldDef, key: string): unknown {
  if (field.type === "boolean") return key === "true";
  return key === "" ? null : key;
}

// The currency field summed in kanban column totals ("amount" first).
export function amountField(object: ObjectDef): FieldDef | undefined {
  return object.fields.find((f) => f.id === "amount" && (f.type === "currency" || f.type === "number")) ?? object.fields.find((f) => f.type === "currency");
}

export interface ColumnTotals {
  count: number;
  amount: number;
  weighted: number;
}

export function columnTotals(records: CrmRecord[], amount: FieldDef | undefined, stage?: PipelineStage): ColumnTotals {
  let sum = 0;
  let weighted = 0;
  for (const r of records) {
    const v = amount ? r.fields[amount.id] : undefined;
    const n = typeof v === "number" ? v : 0;
    sum += n;
    if (stage) {
      const p = stage.kind === "won" ? 100 : stage.kind === "lost" ? 0 : typeof r.fields.probability === "number" ? r.fields.probability : stage.probability;
      weighted += (n * p) / 100;
    }
  }
  return { count: records.length, amount: sum, weighted: Math.round(weighted * 100) / 100 };
}

// Applies a manual order (ids) over a sorted list: known ids first in
// that order, the rest after in their sorted order.
export function applyManualOrder(records: CrmRecord[], order: string[] | undefined): CrmRecord[] {
  if (!order?.length) return records;
  const pos = new Map(order.map((id, i) => [id, i]));
  const known = records.filter((r) => pos.has(r.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
  const rest = records.filter((r) => !pos.has(r.id));
  return [...known, ...rest];
}

// Comparable JSON of the editable parts of a view (dirty check).
export function viewSignature(v: Pick<ViewDef, "type" | "columns" | "filters" | "sorts" | "groupBy" | "pipelineId">): string {
  return JSON.stringify({ type: v.type, columns: v.columns, filters: v.filters, sorts: v.sorts, groupBy: v.groupBy ?? null, pipelineId: v.pipelineId ?? null });
}
