// The AI tool catalog — declared ONCE here (CLAUDE.md rule 3). The MCP
// server (agent/mcp/), the in-admin assistant (features/assistant/) and
// `agentcrm tools list|call` all expose exactly this list. Handlers call
// src/ops/ only, so roles and validation apply to agents too.
//
// Results are JSON-able and kept compact (labels next to ids, lists
// capped) so they fit a model's context.

import { formatFieldValue, recordLabel } from "../core/fields";
import { resolveField } from "../core/query";
import type { Activity, ActivityType, CrmRecord, FieldType, Filter, Sort } from "../core/types";
import { FIELD_TYPES, FILTER_OPS, ACTIVITY_TYPES } from "../core/types";
import type { OpsContext } from "../ops/context";
import { OpsError } from "../ops/context";
import { addActivity, addNote, completeTask, createTask, listActivities, listTasks } from "../ops/activities";
import { mergeRecords } from "../ops/dedupe";
import { importCsv } from "../ops/importCsv";
import { forecast, moveStage, listPipelines } from "../ops/pipelines";
import { createRecord, deleteRecord, getRecordDetails, listRecords, queryContext, searchRecords, updateRecord } from "../ops/records";
import { REPORTS, runReport } from "../ops/reports";
import { createField, describeSchema } from "../ops/schema";
import { objectOf, userOf } from "../ops/store";
import { AUTOMATION_FORM_TOOLS } from "./automationTools";
import { CUSTOMIZE_TOOLS } from "./customizeTools";
import { FILE_TOOLS } from "./fileTools";

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: readonly unknown[];
  additionalProperties?: boolean | JsonSchema;
  default?: unknown;
  minimum?: number;
  maximum?: number;
};

export interface AiTool<I = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: JsonSchema & { type: "object" };
  // Writes data (the assistant asks for confirmation, MCP annotates it).
  mutating: boolean;
  handler(ctx: OpsContext, input: I): Promise<unknown> | unknown;
}

// ─── Shared schema fragments ────────────────────────────────────────────

const objectProp: JsonSchema = { type: "string", description: 'Object id, e.g. "companies", "people", "deals" (see describe_schema).' };
const fieldsProp: JsonSchema = {
  type: "object",
  description:
    "Field values keyed by field id (see describe_schema). Select fields take the option id or label; relation fields take record ids; dates YYYY-MM-DD; datetimes ISO 8601; multi values as arrays.",
  additionalProperties: true,
};
const filterSchema: JsonSchema = {
  type: "object",
  properties: {
    field: { type: "string", description: "Field id, or id / ownerId / createdAt / updatedAt." },
    op: { type: "string", enum: FILTER_OPS },
    value: { description: "Operand. in/notIn: array. withinDays: number (negative = past). Dates: YYYY-MM-DD, 'today', '+30d'." },
  },
  required: ["field", "op"],
};
const targetSchema: JsonSchema = { type: "string", description: "Record id the activity is attached to." };

// ─── Compact record rendering ───────────────────────────────────────────

export function summarizeRecord(ctx: OpsContext, record: CrmRecord, opts: { full?: boolean } = {}): Record<string, unknown> {
  const object = objectOf(ctx.store, record.object);
  const qctx = object ? queryContext(ctx, object) : undefined;
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record.fields)) {
    const field = object ? resolveField(object, k) : undefined;
    if (!field || !qctx) {
      values[k] = v;
      continue;
    }
    if (field.type === "relation") {
      const ids = Array.isArray(v) ? v : [v];
      values[k] = ids.map((id) => ({ id, label: qctx.recordLabel("", String(id)) ?? String(id) }));
      if (field.relation?.cardinality === "one") values[k] = (values[k] as unknown[])[0];
    } else if (field.type === "image" || field.type === "files") {
      const ids = (Array.isArray(v) ? v : [v]).map(String);
      const files = ids.map((id) => ({ id, name: (ctx.store.get("files", id) as { name?: string } | undefined)?.name ?? id }));
      values[k] = field.type === "image" ? files[0] : files;
    } else if (field.type === "select" || field.type === "multiSelect" || field.type === "user") {
      values[k] = { value: v, label: formatFieldValue(field, v, qctx) };
    } else {
      values[k] = v;
    }
  }
  return {
    id: record.id,
    object: record.object,
    label: recordLabel(object, record),
    fields: values,
    ...(record.ownerId ? { owner: { id: record.ownerId, name: userOf(ctx.store, record.ownerId)?.name } } : {}),
    ...(opts.full ? { createdAt: new Date(record.createdAt).toISOString(), updatedAt: new Date(record.updatedAt).toISOString() } : {}),
    ...(record.deletedAt ? { deleted: true } : {}),
  };
}

function summarizeActivity(a: Activity): Record<string, unknown> {
  return {
    id: a.id,
    type: a.type,
    title: a.title,
    ...(a.body ? { body: a.body.length > 600 ? `${a.body.slice(0, 600)}…` : a.body } : {}),
    targets: a.targets,
    ...(a.dueAt ? { dueAt: new Date(a.dueAt).toISOString() } : {}),
    ...(a.doneAt ? { doneAt: new Date(a.doneAt).toISOString() } : {}),
    ...(a.assigneeId ? { assigneeId: a.assigneeId } : {}),
    ...(a.attachments?.length ? { attachments: a.attachments.length } : {}),
    createdAt: new Date(a.createdAt).toISOString(),
  };
}

function str(input: Record<string, unknown>, key: string, required = true): string {
  const v = input[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  if (required) throw new OpsError("validation", `Missing "${key}".`);
  return "";
}

function num(input: Record<string, unknown>, key: string, fallback: number): number {
  const v = input[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

// ─── Catalog ────────────────────────────────────────────────────────────

export const AI_TOOLS: AiTool[] = [
  {
    name: "describe_schema",
    description: "Describe the CRM data model: objects, their fields (ids, types, select options, relations) and pipelines with stages. Call this first to learn field ids.",
    inputSchema: { type: "object", properties: { object: { ...objectProp, description: "Only this object (optional)." } } },
    mutating: false,
    handler: (ctx, input) => describeSchema(ctx, typeof input.object === "string" ? input.object : undefined),
  },
  {
    name: "search_records",
    description: "Full-text search across records (names, emails, domains, phones) and activity titles. Returns the best matches with ids.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text." },
        objects: { type: "array", items: { type: "string" }, description: "Restrict to these object ids." },
        limit: { type: "number", default: 10, maximum: 50 },
      },
      required: ["query"],
    },
    mutating: false,
    handler: (ctx, input) => searchRecords(ctx, str(input, "query"), { objects: input.objects as string[] | undefined, limit: Math.min(50, num(input, "limit", 10)) }),
  },
  {
    name: "list_records",
    description: "List records of an object with optional filters, sorts and pagination (max 100 per call).",
    inputSchema: {
      type: "object",
      properties: {
        object: objectProp,
        filters: { type: "array", items: filterSchema },
        sorts: { type: "array", items: { type: "object", properties: { field: { type: "string" }, dir: { type: "string", enum: ["asc", "desc"] } }, required: ["field", "dir"] } },
        search: { type: "string" },
        viewId: { type: "string", description: "Apply a saved view's filters and sorts." },
        offset: { type: "number", default: 0 },
        limit: { type: "number", default: 25, maximum: 100 },
      },
      required: ["object"],
    },
    mutating: false,
    handler: (ctx, input) => {
      const page = listRecords(ctx, str(input, "object"), {
        filters: input.filters as Filter[] | undefined,
        sorts: input.sorts as Sort[] | undefined,
        search: typeof input.search === "string" ? input.search : undefined,
        viewId: typeof input.viewId === "string" ? input.viewId : undefined,
        offset: num(input, "offset", 0),
        limit: Math.min(100, num(input, "limit", 25)),
      });
      return { total: page.total, offset: page.offset, hasMore: page.hasMore, records: page.items.map((r) => summarizeRecord(ctx, r)) };
    },
  },
  {
    name: "get_record",
    description: "Get one record with every field, its relations (both directions) and its latest activities.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    mutating: false,
    handler: (ctx, input) => {
      const details = getRecordDetails(ctx, str(input, "id"));
      const activities = listActivities(ctx, { target: details.record.id, limit: 10 }).items.map(summarizeActivity);
      return { ...summarizeRecord(ctx, details.record, { full: true }), relations: details.relations, related: details.inverse.filter((i) => i.records.length).map((i) => ({ object: i.object, via: i.field, records: i.records.slice(0, 25), count: i.records.length })), activities };
    },
  },
  {
    name: "create_record",
    description: "Create a record of an object. Returns the created record.",
    inputSchema: { type: "object", properties: { object: objectProp, fields: fieldsProp, ownerId: { type: "string", description: "User id owning the record (default: you)." } }, required: ["object", "fields"] },
    mutating: true,
    handler: async (ctx, input) => summarizeRecord(ctx, await createRecord(ctx, str(input, "object"), (input.fields ?? {}) as Record<string, unknown>, { ...(typeof input.ownerId === "string" ? { ownerId: input.ownerId } : {}) })),
  },
  {
    name: "update_record",
    description: "Update some fields of a record (only the given fields change; null clears a field).",
    inputSchema: { type: "object", properties: { id: { type: "string" }, fields: fieldsProp, ownerId: { type: ["string", "null"] } }, required: ["id", "fields"] },
    mutating: true,
    handler: async (ctx, input) =>
      summarizeRecord(ctx, await updateRecord(ctx, str(input, "id"), (input.fields ?? {}) as Record<string, unknown>, input.ownerId !== undefined ? { ownerId: input.ownerId as string | null } : {})),
  },
  {
    name: "delete_record",
    description: "Delete a record (soft delete: restorable until the data is compacted).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    mutating: true,
    handler: (ctx, input) => deleteRecord(ctx, str(input, "id")),
  },
  {
    name: "merge_records",
    description: "Merge duplicate records into a primary one: empty fields are filled from the duplicates, relations and activities move to the primary, duplicates are removed.",
    inputSchema: { type: "object", properties: { primaryId: { type: "string" }, duplicateIds: { type: "array", items: { type: "string" } } }, required: ["primaryId", "duplicateIds"] },
    mutating: true,
    handler: async (ctx, input) => {
      const res = await mergeRecords(ctx, str(input, "primaryId"), (input.duplicateIds as string[]) ?? []);
      return { record: summarizeRecord(ctx, res.record), merged: res.merged, movedActivities: res.movedActivities };
    },
  },
  {
    name: "add_note",
    description: "Add a note (markdown) to a record's timeline.",
    inputSchema: { type: "object", properties: { recordId: targetSchema, body: { type: "string" }, title: { type: "string" } }, required: ["recordId", "body"] },
    mutating: true,
    handler: async (ctx, input) => summarizeActivity(await addNote(ctx, str(input, "recordId"), str(input, "body"), typeof input.title === "string" ? input.title : undefined)),
  },
  {
    name: "log_activity",
    description: "Log a call, email or meeting on one or more records.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ACTIVITY_TYPES.filter((t) => t !== "task") },
        title: { type: "string" },
        body: { type: "string" },
        recordIds: { type: "array", items: { type: "string" } },
        meta: { type: "object", additionalProperties: true, description: "e.g. { durationMin } for calls, { startAt, endAt } (epoch ms) for meetings." },
      },
      required: ["type", "title", "recordIds"],
    },
    mutating: true,
    handler: async (ctx, input) => {
      const targets = ((input.recordIds as string[]) ?? []).map((id) => ({ object: "", id }));
      return summarizeActivity(await addActivity(ctx, { type: str(input, "type") as ActivityType, title: str(input, "title"), body: typeof input.body === "string" ? input.body : undefined, targets, meta: input.meta as Record<string, unknown> | undefined }));
    },
  },
  {
    name: "create_task",
    description: "Create a task, optionally attached to records, with a due date and an assignee.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        dueAt: { type: "string", description: "ISO date or datetime." },
        assigneeId: { type: "string" },
        recordIds: { type: "array", items: { type: "string" } },
      },
      required: ["title"],
    },
    mutating: true,
    handler: async (ctx, input) =>
      summarizeActivity(
        await createTask(ctx, {
          title: str(input, "title"),
          body: typeof input.body === "string" ? input.body : undefined,
          dueAt: typeof input.dueAt === "string" ? input.dueAt : undefined,
          assigneeId: typeof input.assigneeId === "string" ? input.assigneeId : undefined,
          targets: ((input.recordIds as string[]) ?? []).map((id) => ({ object: "", id })),
        }),
      ),
  },
  {
    name: "complete_task",
    description: "Mark a task as done (or reopen it with done: false).",
    inputSchema: { type: "object", properties: { id: { type: "string" }, done: { type: "boolean", default: true } }, required: ["id"] },
    mutating: true,
    handler: async (ctx, input) => summarizeActivity(await completeTask(ctx, str(input, "id"), input.done !== false)),
  },
  {
    name: "list_tasks",
    description: "List tasks: open by default, optionally for one assignee / record, overdue only, or due within N days. Sorted by due date.",
    inputSchema: {
      type: "object",
      properties: {
        assigneeId: { type: "string" },
        recordId: { type: "string" },
        status: { type: "string", enum: ["open", "done", "all"], default: "open" },
        overdue: { type: "boolean" },
        dueWithinDays: { type: "number" },
        limit: { type: "number", default: 25, maximum: 100 },
      },
    },
    mutating: false,
    handler: (ctx, input) => {
      const page = listTasks(ctx, {
        assigneeId: typeof input.assigneeId === "string" ? input.assigneeId : undefined,
        target: typeof input.recordId === "string" ? input.recordId : undefined,
        status: (input.status as "open" | "done" | "all") ?? "open",
        overdue: input.overdue === true,
        dueWithinDays: typeof input.dueWithinDays === "number" ? input.dueWithinDays : undefined,
        limit: Math.min(100, num(input, "limit", 25)),
      });
      return { total: page.total, tasks: page.items.map(summarizeActivity) };
    },
  },
  {
    name: "list_activities",
    description: "A record's timeline (notes, calls, emails, meetings, tasks), most recent first. includeRelated adds activities of linked records (e.g. a company's people and deals).",
    inputSchema: {
      type: "object",
      properties: {
        recordId: { type: "string" },
        types: { type: "array", items: { type: "string", enum: ACTIVITY_TYPES } },
        includeRelated: { type: "boolean" },
        limit: { type: "number", default: 20, maximum: 100 },
      },
    },
    mutating: false,
    handler: (ctx, input) => {
      const page = listActivities(ctx, {
        target: typeof input.recordId === "string" ? input.recordId : undefined,
        types: input.types as ActivityType[] | undefined,
        includeRelated: input.includeRelated === true,
        limit: Math.min(100, num(input, "limit", 20)),
      });
      return { total: page.total, activities: page.items.map(summarizeActivity) };
    },
  },
  {
    name: "move_deal_stage",
    description: "Move a deal (or any pipeline record) to a stage, by stage id or label. Updates probability; lostReason for lost stages.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, stage: { type: "string" }, lostReason: { type: "string" } }, required: ["id", "stage"] },
    mutating: true,
    handler: async (ctx, input) => summarizeRecord(ctx, await moveStage(ctx, str(input, "id"), str(input, "stage"), { lostReason: typeof input.lostReason === "string" ? input.lostReason : undefined })),
  },
  {
    name: "pipeline_summary",
    description: "Pipeline overview: per stage deal count, amount and weighted amount, plus open / weighted / won totals and open deals by close month.",
    inputSchema: { type: "object", properties: { pipelineId: { type: "string" }, ownerId: { type: "string" } } },
    mutating: false,
    handler: (ctx, input) => ({
      pipelines: listPipelines(ctx).map((p) => ({ id: p.id, name: p.name })),
      ...forecast(ctx, { pipelineId: typeof input.pipelineId === "string" ? input.pipelineId : undefined, ownerId: typeof input.ownerId === "string" ? input.ownerId : undefined }),
    }),
  },
  {
    name: "run_report",
    description: `Run a named report. Reports: ${Object.entries(REPORTS)
      .map(([k, v]) => `${k} (${v.description})`)
      .join("; ")}`,
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", enum: Object.keys(REPORTS) }, params: { type: "object", additionalProperties: true, description: "Report parameters, e.g. { months: 6 } or { days: 30 }." } },
      required: ["name"],
    },
    mutating: false,
    handler: (ctx, input) => runReport(ctx, str(input, "name"), (input.params ?? {}) as Record<string, unknown>),
  },
  {
    name: "create_field",
    description: "Add a custom field to an object (admin only).",
    inputSchema: {
      type: "object",
      properties: {
        object: objectProp,
        label: { type: "string" },
        type: { type: "string", enum: FIELD_TYPES },
        options: { type: "array", items: { type: "string" }, description: "Option labels for select / multiSelect." },
        relationObject: { type: "string", description: "Target object for relation fields." },
        cardinality: { type: "string", enum: ["one", "many"] },
        description: { type: "string" },
      },
      required: ["object", "label", "type"],
    },
    mutating: true,
    handler: (ctx, input) =>
      createField(ctx, str(input, "object"), {
        label: str(input, "label"),
        type: str(input, "type") as FieldType,
        options: input.options as string[] | undefined,
        description: typeof input.description === "string" ? input.description : undefined,
        ...(input.relationObject ? { relation: { object: String(input.relationObject), cardinality: input.cardinality === "many" ? "many" : "one" } } : {}),
      }),
  },
  {
    name: "import_csv",
    description:
      "Import CSV text into an object. Columns are mapped to fields automatically (or via mapping {header: fieldId}); duplicates (people by email, companies by domain) are updated. Runs as a DRY RUN unless confirm is true — show the report to the user before confirming.",
    inputSchema: {
      type: "object",
      properties: {
        object: objectProp,
        csv: { type: "string" },
        mapping: { type: "object", additionalProperties: { type: "string" } },
        onDuplicate: { type: "string", enum: ["update", "skip", "create"], default: "update" },
        confirm: { type: "boolean", default: false },
      },
      required: ["object", "csv"],
    },
    mutating: true,
    handler: async (ctx, input) => {
      const report = await importCsv(ctx, {
        object: str(input, "object"),
        csv: String(input.csv ?? ""),
        mapping: input.mapping as Record<string, string> | undefined,
        onDuplicate: (input.onDuplicate as "update" | "skip" | "create") ?? "update",
        dryRun: input.confirm !== true,
      });
      return { ...report, rows: report.rows.slice(0, 50), rowsTruncated: report.rows.length > 50 };
    },
  },
  // Automations, lead forms, email drafts (src/ai/automationTools.ts).
  ...AUTOMATION_FORM_TOOLS,
  // Modules, appearance, extensions (src/ai/customizeTools.ts).
  ...CUSTOMIZE_TOOLS,
  // Files metadata (src/ai/fileTools.ts).
  ...FILE_TOOLS,
];

// ─── Dynamic catalog (extension modules) ────────────────────────────────
// AI_TOOLS is the built-in catalog; extension modules add theirs with
// registerAiTool (src/extensions/). Every front door lists listAiTools().

const extraTools = new Map<string, AiTool>();
const toolListeners = new Set<() => void>();
const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;

export function registerAiTool(tool: AiTool): () => void {
  if (!tool || typeof tool.name !== "string" || !TOOL_NAME_RE.test(tool.name)) throw new Error(`Invalid AI tool name "${String(tool?.name)}" (snake_case, ≤ 64 chars).`);
  if (typeof tool.handler !== "function") throw new Error(`AI tool "${tool.name}" needs a handler.`);
  if (!tool.inputSchema || tool.inputSchema.type !== "object") throw new Error(`AI tool "${tool.name}" needs an object inputSchema.`);
  if (AI_TOOLS.some((t) => t.name === tool.name) || extraTools.has(tool.name)) throw new Error(`AI tool "${tool.name}" already exists.`);
  extraTools.set(tool.name, { ...tool, mutating: tool.mutating !== false });
  for (const l of [...toolListeners]) l();
  return () => {
    if (extraTools.delete(tool.name)) for (const l of [...toolListeners]) l();
  };
}

// Built-in tools followed by the tools of loaded extension modules.
export function listAiTools(): AiTool[] {
  return extraTools.size ? [...AI_TOOLS, ...extraTools.values()] : AI_TOOLS;
}

export function subscribeAiTools(listener: () => void): () => void {
  toolListeners.add(listener);
  return () => toolListeners.delete(listener);
}

export function findTool(name: string): AiTool | undefined {
  return AI_TOOLS.find((t) => t.name === name) ?? extraTools.get(name);
}

function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// Checks (and lightly coerces) a value against a tool schema fragment: types,
// enums, required keys, array items and nested objects. Models send numeric
// strings ("5") and "true" / "false" often enough that those are coerced;
// anything else of the wrong shape is a validation error naming the path, so
// the model (or the CLI user) can correct itself instead of hitting an
// internal error deep in an op. null on an optional key is left to the handler
// (several tools document null as "clear").
export function checkToolInput(schema: JsonSchema, value: unknown, path: string): unknown {
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  let v = value;
  if (types.length && v !== null && v !== undefined) {
    const actual = jsonTypeOf(v);
    const accepts = (t: string) => t === actual || (t === "integer" && actual === "number" && Number.isInteger(v));
    if (!types.some(accepts)) {
      if ((types.includes("number") || types.includes("integer")) && typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) v = Number(v);
      else if (types.includes("boolean") && (v === "true" || v === "false")) v = v === "true";
      else throw new OpsError("validation", `${path} must be ${types.map((t) => (t === "array" || t === "object" || t === "integer" ? `an ${t}` : `a ${t}`)).join(" or ")}, got ${actual === "array" || actual === "object" ? `an ${actual}` : `${actual} ${JSON.stringify(v)}`.slice(0, 80)}.`);
    }
  }
  if (v === null || v === undefined) return v;
  if (schema.enum && !schema.enum.includes(v)) {
    throw new OpsError("validation", `${path} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}, got ${JSON.stringify(v).slice(0, 80)}.`);
  }
  if (Array.isArray(v) && schema.items) {
    const items = schema.items;
    return v.map((item, i) => checkToolInput(items, item, `${path}[${i}]`));
  }
  if (jsonTypeOf(v) === "object" && (schema.properties || schema.required)) {
    const obj = { ...(v as Record<string, unknown>) };
    for (const key of schema.required ?? []) {
      if (obj[key] === undefined || obj[key] === null) throw new OpsError("validation", `${path}: missing required "${key}".`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (obj[key] !== undefined) obj[key] = checkToolInput(sub, obj[key], `${path}.${key}`);
    }
    return obj;
  }
  return v;
}

// Runs a tool by name after checking the input against its JSON schema
// (required keys, types, enums — see checkToolInput).
export async function callTool(ctx: OpsContext, name: string, input: unknown): Promise<unknown> {
  const tool = findTool(name);
  if (!tool) throw new OpsError("notFound", `Unknown tool "${name}". Tools: ${listAiTools().map((t) => t.name).join(", ")}.`);
  if (input !== undefined && input !== null && jsonTypeOf(input) !== "object") throw new OpsError("validation", `${name}: the input must be a JSON object, got ${jsonTypeOf(input) === "array" ? "an array" : `a ${jsonTypeOf(input)}`}.`);
  const raw = (input ?? {}) as Record<string, unknown>;
  for (const key of tool.inputSchema.required ?? []) {
    if (raw[key] === undefined || raw[key] === null) throw new OpsError("validation", `${name}: missing required "${key}".`);
  }
  const args = checkToolInput({ ...tool.inputSchema, required: [] }, raw, name) as Record<string, unknown>;
  return tool.handler(ctx, args);
}
