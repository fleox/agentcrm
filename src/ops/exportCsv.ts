// Exports: one object as CSV (human-readable values, relations as labels)
// and the whole dataset as JSON (backup / backend migration), plus the
// JSON restore.

import Papa from "papaparse";
import { formatFieldValue, formatAddress } from "../core/fields";
import { applyFilters, applySorts, getRecordValue, resolveField } from "../core/query";
import type { AddressValue, Filter, Sort } from "../core/types";
import { COLLECTIONS, type CollectionName, type DocMutation, type StoredDoc } from "../data/types";
import { assertCan, OpsError, type OpsContext } from "./context";
import { queryContext } from "./records";
import { recordsOf, requireObject, userOf } from "./store";

export interface ExportCsvOptions {
  viewId?: string;
  filters?: Filter[];
  sorts?: Sort[];
  // Field ids (default: every field). "id", "ownerId", "createdAt", "updatedAt" allowed.
  fields?: string[];
  // Add an "ID" column first (default true — re-import updates by id).
  includeId?: boolean;
  // "labels" (default): option labels, related record labels, formatted
  // numbers. "raw": stored values (ids, ISO dates, plain numbers).
  values?: "labels" | "raw";
  includeDeleted?: boolean;
}

export function exportCsv(ctx: OpsContext, objectId: string, opts: ExportCsvOptions = {}): string {
  assertCan(ctx, "export");
  const object = requireObject(ctx.store, objectId);
  let filters = opts.filters ?? [];
  let sorts = opts.sorts ?? [];
  if (opts.viewId) {
    const view = ctx.store.get("views", opts.viewId) as unknown as { filters: Filter[]; sorts: Sort[]; columns: string[] } | undefined;
    if (!view) throw new OpsError("notFound", `View "${opts.viewId}" not found.`);
    filters = [...view.filters, ...filters];
    if (!sorts.length) sorts = view.sorts;
  }
  const qctx = queryContext(ctx, object);
  const records = applySorts(applyFilters(recordsOf(ctx.store, objectId, { includeDeleted: opts.includeDeleted }), filters, qctx), sorts, qctx);
  const fieldIds = opts.fields ?? object.fields.map((f) => f.id);
  const columns = [...(opts.includeId !== false ? ["id"] : []), ...fieldIds.filter((f) => f !== "id")];
  const raw = opts.values === "raw";
  const header = columns.map((c) => (c === "id" ? "ID" : resolveField(object, c)?.label ?? c));
  const rows = records.map((r) =>
    columns.map((c) => {
      const field = resolveField(object, c);
      const value = getRecordValue(r, c);
      if (value === undefined || value === null) return "";
      if (raw) {
        if (field?.type === "address") return formatAddress(value as AddressValue);
        return Array.isArray(value) ? value.join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value);
      }
      if (!field) return String(value);
      if (field.type === "datetime" && typeof value === "number") return new Date(value).toISOString();
      if (field.type === "date" || field.type === "number" || field.type === "currency" || field.type === "percent") return String(value);
      if (c === "ownerId" || c === "createdBy" || c === "updatedBy") return userOf(ctx.store, String(value))?.email ?? String(value);
      return formatFieldValue(field, value, qctx);
    }),
  );
  return Papa.unparse({ fields: header, data: rows }, { newline: "\n" });
}

export interface JsonExport {
  format: "agentcrm-export";
  version: 1;
  exportedAt: string;
  collections: Partial<Record<CollectionName, StoredDoc[]>>;
}

export function exportJson(ctx: OpsContext, opts: { collections?: CollectionName[] } = {}): JsonExport {
  assertCan(ctx, "export");
  const wanted = opts.collections ?? COLLECTIONS.filter((c) => c !== "automationRuns");
  return {
    format: "agentcrm-export",
    version: 1,
    exportedAt: new Date(ctx.now()).toISOString(),
    collections: Object.fromEntries(wanted.map((c) => [c, ctx.store.list(c)])),
  };
}

export interface ImportJsonPlan {
  mode: "merge" | "replace";
  // Per collection present in the export: documents added, overwritten
  // (same id already in this CRM) and deleted (replace mode only).
  collections: Partial<Record<CollectionName, { added: number; overwritten: number; deleted: number }>>;
  added: number;
  overwritten: number;
  deleted: number;
  // The export's CRM name when it differs from this CRM's.
  sourceName?: string;
  warnings: string[];
}

// What importJson would change, without writing (the restore plan).
export function planImportJson(ctx: OpsContext, data: JsonExport, opts: { mode?: "merge" | "replace" } = {}): ImportJsonPlan {
  assertCan(ctx, "settings.write");
  if (data?.format !== "agentcrm-export") throw new OpsError("validation", "Not an AgentCRM JSON export.");
  const mode = opts.mode ?? "merge";
  const plan: ImportJsonPlan = { mode, collections: {}, added: 0, overwritten: 0, deleted: 0, warnings: [] };
  for (const c of COLLECTIONS) {
    const docs = data.collections[c];
    if (!docs) continue;
    const ids = new Set(docs.filter((d) => d && typeof d.id === "string").map((d) => d.id));
    let added = 0;
    let overwritten = 0;
    for (const id of ids) (ctx.store.get(c, id) ? overwritten++ : added++);
    const deleted = mode === "replace" ? ctx.store.list(c).filter((d) => !ids.has(d.id)).length : 0;
    plan.collections[c] = { added, overwritten, deleted };
    plan.added += added;
    plan.overwritten += overwritten;
    plan.deleted += deleted;
  }
  const here = ctx.store.get("settings", "general") as { name?: string } | undefined;
  const there = (data.collections.settings ?? []).find((d) => d.id === "general") as { name?: string } | undefined;
  if (here?.name && there?.name && here.name !== there.name) {
    plan.sourceName = there.name;
    plan.warnings.push(`This backup comes from another CRM ("${there.name}"): its settings, users and schema replace the ones with the same ids here (this CRM becomes "${there.name}").`);
  }
  const users = (data.collections.users ?? []) as unknown as { id: string; email?: string }[];
  const replacedUsers = users.filter((u) => {
    const cur = ctx.store.get("users", u.id) as { email?: string } | undefined;
    return cur?.email && u.email && cur.email.toLowerCase() !== u.email.toLowerCase();
  });
  if (replacedUsers.length) {
    plan.warnings.push(`${replacedUsers.length} user(s) of this CRM are replaced by different people with the same id: ${replacedUsers.map((u) => `${String((ctx.store.get("users", u.id) as { email?: string }).email)} → ${String(u.email)}`).join(", ")}.`);
  }
  return plan;
}

// Restores an export into the store. "merge" (default) upserts every
// document; "replace" also deletes documents absent from the export.
export async function importJson(ctx: OpsContext, data: JsonExport, opts: { mode?: "merge" | "replace" } = {}): Promise<{ written: number; deleted: number }> {
  assertCan(ctx, "settings.write");
  if (data?.format !== "agentcrm-export") throw new OpsError("validation", "Not an AgentCRM JSON export.");
  const mutations: DocMutation[] = [];
  let deleted = 0;
  for (const c of COLLECTIONS) {
    const docs = data.collections[c];
    if (!docs) continue;
    const ids = new Set<string>();
    for (const doc of docs) {
      if (!doc || typeof doc.id !== "string") continue;
      ids.add(doc.id);
      mutations.push({ op: "set", collection: c, doc });
    }
    if (opts.mode === "replace") {
      for (const existing of ctx.store.list(c)) {
        if (!ids.has(existing.id)) {
          mutations.push({ op: "delete", collection: c, id: existing.id });
          deleted++;
        }
      }
    }
  }
  await ctx.store.write(mutations, { message: "Restore JSON export" });
  return { written: mutations.length - deleted, deleted };
}
