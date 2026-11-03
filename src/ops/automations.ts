// Automations engine.
//
// Contract:
//   - installAutomations(registry?) subscribes to the CRM plugin actions
//     (record.created / record.updated / stage.changed) and runs matching
//     enabled automations in-process (event triggers);
//   - runAutomationEvent(ctx, event) runs the automations matching one event;
//   - runScheduled(ctx) evaluates "schedule" and "inactivity" triggers
//     (called by `agentcrm automations run` from a cron / GitHub Action,
//     and periodically by the admin while open — one leader tab);
//   - every run is logged in the `automationRuns` collection.
// Guard against loops with ctx.depth (writes made by an automation carry
// depth + 1; stop past MAX_AUTOMATION_DEPTH).
//
// Triggers:
//   record.created   a record of `object` is created
//   record.updated   any change (or, with `field`, a change of that field)
//   field.changed    `field` changed (optionally: its new value matches `to`,
//                    compared like a filter `eq` — option id or label)
//   stage.changed    pipeline stage changed (optional `to`: a stage id, or a
//                    stage kind "won" / "lost" / "open")
//   schedule         every `everyHours` hours, for each matching record
//   inactivity       records without activity (nor update) for `days` days —
//                    fires once per idle period (run key = last activity time)
// Conditions are core/query filters evaluated on the record.
//
// Actions run with system permissions (user null) and depth + 1:
//   createTask   { title, dueInDays?, assignTo?: "owner" | userId } (default owner)
//   updateField  { field, value }   string values are templates
//   addNote      { body }           template
//   assignOwner  { userId | "roundRobin" } round robin over active admins /
//                members; the cursor is persisted on the automation doc
//   webhook      { url }            POST JSON, best effort (10 s timeout)
// Templates: {{label}}, {{<fieldId>}}, {{owner}} … (see automations/template.ts).

import { normalizeEmail } from "../core/fields";
import { newId } from "../core/ids";
import { plugins as defaultPlugins, type CrmActionName, type CrmActionPayloads, type PluginRegistry } from "../core/pluginRegistry";
import { matchesFilter, resolveField } from "../core/query";
import { AUTOMATION_TEMPLATES, findAutomationTemplate, type AutomationInput } from "./automations/templates";
import { renderTemplate } from "./automations/template";
import { FILTER_OPS, type Automation, type AutomationAction, type AutomationRun, type AutomationTriggerType, type CrmRecord, type CrmUser, type Filter, type ObjectDef } from "../core/types";
import type { DocMutation } from "../data/types";
import { addNote, createTask, lastActivityAt } from "./activities";
import { assertCan, OpsError, type OpsContext } from "./context";
import { pipelineOfRecord } from "./pipelines";
import { queryContext, setRecordOwner, updateRecord } from "./records";
import { summarizeForWebhook } from "./automations/webhook";
import { asDoc, automationRunsOf, automationsOf, objectOf, recordOf, recordsOf, requireObject, requireRecord, thaw, userOf, usersOf } from "./store";

export { AUTOMATION_TEMPLATES, findAutomationTemplate, type AutomationInput, type AutomationTemplate } from "./automations/templates";
export { renderTemplate, templatePlaceholders } from "./automations/template";

export const MAX_AUTOMATION_DEPTH = 3;
// Runs kept in the log (oldest pruned by runScheduled / pruneAutomationRuns).
export const MAX_AUTOMATION_RUNS = 1000;
const DAY = 86_400_000;
const HOUR = 3_600_000;

export const EVENT_TRIGGERS: readonly AutomationTriggerType[] = ["record.created", "record.updated", "field.changed", "stage.changed"];
export const SCHEDULED_TRIGGERS: readonly AutomationTriggerType[] = ["schedule", "inactivity"];
export const TRIGGER_TYPES: readonly AutomationTriggerType[] = [...EVENT_TRIGGERS, ...SCHEDULED_TRIGGERS];
export const ACTION_TYPES: readonly AutomationAction["type"][] = ["createTask", "updateField", "addNote", "assignOwner", "webhook"];

export type AutomationEvent = {
  [K in CrmActionName]: { type: K; payload: CrmActionPayloads[K] };
}[CrmActionName];

export interface AutomationRunReport {
  ran: number;
  skipped: number;
  errors: number;
  runs: AutomationRun[];
}

// Stored run doc: AutomationRun + bookkeeping.
export interface AutomationRunDoc extends AutomationRun {
  // Idempotency key (scheduled runs): a run with the same key never repeats.
  key?: string;
  trigger?: AutomationTriggerType;
  dryRun?: boolean;
}

// Automation doc + engine state.
interface AutomationDoc extends Automation {
  roundRobinCursor?: number;
  createdAt?: number;
  updatedAt?: number;
}

type ActionResult = NonNullable<AutomationRun["actions"]>[number];

// ─── Webhook transport (injectable for tests / CLI) ─────────────────────

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;
let webhookFetch: FetchLike | null = null;

export function setAutomationFetch(fn: FetchLike | null): void {
  webhookFetch = fn;
}

// ─── Reads ──────────────────────────────────────────────────────────────

export function listAutomations(ctx: OpsContext): Automation[] {
  return ctx.store.list("automations") as unknown as Automation[];
}

export function getAutomation(ctx: OpsContext, id: string): Automation {
  const a = ctx.store.get("automations", id) as unknown as Automation | undefined;
  if (!a) throw new OpsError("notFound", `Automation "${id}" not found.`);
  return a;
}

export function listAutomationRuns(ctx: OpsContext, opts: { automationId?: string; recordId?: string; status?: AutomationRun["status"]; limit?: number } = {}): AutomationRunDoc[] {
  let runs = automationRunsOf(ctx.store) as AutomationRunDoc[];
  if (opts.automationId) runs = runs.filter((r) => r.automationId === opts.automationId);
  if (opts.recordId) runs = runs.filter((r) => r.recordId === opts.recordId);
  if (opts.status) runs = runs.filter((r) => r.status === opts.status);
  runs = [...runs].sort((a, b) => b.startedAt - a.startedAt || (a.id < b.id ? 1 : -1));
  return opts.limit ? runs.slice(0, opts.limit) : runs;
}

// ─── Validation & CRUD ──────────────────────────────────────────────────

function fieldExists(object: ObjectDef, id: string): boolean {
  return !!resolveField(object, id);
}

// Normalises and validates an automation definition. Throws OpsError
// "validation" listing every problem.
export function validateAutomation(ctx: OpsContext, input: AutomationInput): AutomationInput {
  const errors: string[] = [];
  const name = (input.name ?? "").trim();
  if (!name) errors.push("A name is required.");
  const object = objectOf(ctx.store, input.object);
  if (!object) errors.push(`Unknown object "${input.object}".`);
  const trigger = { ...(input.trigger ?? { type: "record.created" }) };
  if (!TRIGGER_TYPES.includes(trigger.type)) errors.push(`Unknown trigger "${String(trigger.type)}". Triggers: ${TRIGGER_TYPES.join(", ")}.`);
  if (trigger.type === "field.changed" && !trigger.field) errors.push("A field.changed trigger needs a field.");
  if (trigger.field && object && !fieldExists(object, trigger.field)) errors.push(`Trigger field "${trigger.field}" doesn't exist on ${object.labelPlural}.`);
  if (trigger.type === "inactivity" && !(typeof trigger.days === "number" && trigger.days >= 1)) errors.push("An inactivity trigger needs days ≥ 1.");
  if (trigger.type === "schedule" && !(typeof trigger.everyHours === "number" && trigger.everyHours >= 1)) errors.push("A schedule trigger needs everyHours ≥ 1.");
  if (trigger.type === "stage.changed" && object && !ctx.store.list("pipelines").some((p) => p.object === object.id)) errors.push(`${object.labelPlural} have no pipeline.`);
  const conditions: Filter[] = [];
  for (const c of input.conditions ?? []) {
    if (!c || typeof c.field !== "string") {
      errors.push("Invalid condition.");
      continue;
    }
    if (!FILTER_OPS.includes(c.op)) errors.push(`Unknown condition operator "${String(c.op)}".`);
    if (object && !fieldExists(object, c.field)) errors.push(`Condition field "${c.field}" doesn't exist on ${object.labelPlural}.`);
    conditions.push({ field: c.field, op: c.op, ...(c.value !== undefined ? { value: c.value } : {}) });
  }
  const actions: AutomationAction[] = [];
  if (!input.actions?.length) errors.push("Add at least one action.");
  for (const [i, a] of (input.actions ?? []).entries()) {
    const n = `Action ${i + 1}`;
    switch (a?.type) {
      case "createTask":
        if (!a.title?.trim()) errors.push(`${n}: a task title is required.`);
        if (a.dueInDays !== undefined && !(typeof a.dueInDays === "number" && a.dueInDays >= 0)) errors.push(`${n}: dueInDays must be ≥ 0.`);
        if (a.assignTo && a.assignTo !== "owner" && !userOf(ctx.store, a.assignTo)) errors.push(`${n}: unknown user "${a.assignTo}".`);
        actions.push({ type: "createTask", title: a.title?.trim() ?? "", ...(a.dueInDays !== undefined ? { dueInDays: a.dueInDays } : {}), ...(a.assignTo ? { assignTo: a.assignTo } : {}) });
        break;
      case "updateField":
        if (!a.field) errors.push(`${n}: pick a field.`);
        else if (object && !object.fields.some((f) => f.id === a.field)) errors.push(`${n}: field "${a.field}" doesn't exist on ${object.labelPlural}.`);
        actions.push({ type: "updateField", field: a.field, value: a.value });
        break;
      case "addNote":
        if (!a.body?.trim()) errors.push(`${n}: the note is empty.`);
        actions.push({ type: "addNote", body: a.body ?? "" });
        break;
      case "assignOwner":
        if (!a.userId) errors.push(`${n}: pick a user or round robin.`);
        else if (a.userId !== "roundRobin" && !userOf(ctx.store, a.userId)) errors.push(`${n}: unknown user "${a.userId}".`);
        actions.push({ type: "assignOwner", userId: a.userId });
        break;
      case "webhook":
        if (!/^https?:\/\/\S+$/i.test(a.url ?? "")) errors.push(`${n}: the webhook URL must start with https:// (or http://).`);
        actions.push({ type: "webhook", url: (a.url ?? "").trim() });
        break;
      default:
        errors.push(`${n}: unknown action "${String((a as { type?: unknown })?.type)}". Actions: ${ACTION_TYPES.join(", ")}.`);
    }
  }
  if (errors.length) throw new OpsError("validation", errors.join(" "), errors);
  return { name, enabled: input.enabled ?? true, object: input.object, trigger, conditions, actions };
}

export async function createAutomation(ctx: OpsContext, input: AutomationInput, opts: { id?: string } = {}): Promise<Automation> {
  assertCan(ctx, "automations.write");
  const valid = validateAutomation(ctx, input);
  const now = ctx.now();
  const id = opts.id ?? newId(now);
  if (ctx.store.get("automations", id)) throw new OpsError("conflict", `Automation "${id}" already exists.`);
  const doc: AutomationDoc = { id, name: valid.name, enabled: valid.enabled ?? true, object: valid.object, trigger: valid.trigger, conditions: valid.conditions ?? [], actions: valid.actions, createdAt: now, updatedAt: now };
  await ctx.store.write([{ op: "set", collection: "automations", doc: asDoc(doc) }], { message: `Create automation ${valid.name}` });
  return getAutomation(ctx, id);
}

export async function updateAutomation(ctx: OpsContext, id: string, patch: Partial<AutomationInput>): Promise<Automation> {
  assertCan(ctx, "automations.write");
  const current = thaw(getAutomation(ctx, id)) as AutomationDoc;
  const valid = validateAutomation(ctx, {
    name: patch.name ?? current.name,
    enabled: patch.enabled ?? current.enabled,
    object: patch.object ?? current.object,
    trigger: patch.trigger ?? current.trigger,
    conditions: patch.conditions ?? current.conditions,
    actions: patch.actions ?? current.actions,
  });
  const next: AutomationDoc = { ...current, ...valid, enabled: valid.enabled ?? true, conditions: valid.conditions ?? [], updatedAt: ctx.now() };
  await ctx.store.write([{ op: "set", collection: "automations", doc: asDoc(next) }], { message: `Update automation ${valid.name}` });
  return getAutomation(ctx, id);
}

export async function setAutomationEnabled(ctx: OpsContext, id: string, enabled: boolean): Promise<Automation> {
  assertCan(ctx, "automations.write");
  getAutomation(ctx, id);
  await ctx.store.write([{ op: "patch", collection: "automations", id, fields: { enabled, updatedAt: ctx.now() } }], { message: `${enabled ? "Enable" : "Disable"} automation` });
  return getAutomation(ctx, id);
}

// Deletes the automation (and, by default, its run log).
export async function deleteAutomation(ctx: OpsContext, id: string, opts: { keepRuns?: boolean } = {}): Promise<{ id: string; deletedRuns: number }> {
  assertCan(ctx, "automations.write");
  getAutomation(ctx, id);
  const runs = opts.keepRuns ? [] : automationRunsOf(ctx.store).filter((r) => r.automationId === id);
  await ctx.store.write(
    [{ op: "delete", collection: "automations", id }, ...runs.map((r): DocMutation => ({ op: "delete", collection: "automationRuns", id: r.id }))],
    { message: "Delete automation" },
  );
  return { id, deletedRuns: runs.length };
}

export async function duplicateAutomation(ctx: OpsContext, id: string): Promise<Automation> {
  const a = getAutomation(ctx, id);
  return createAutomation(ctx, { name: `${a.name} (copy)`, enabled: false, object: a.object, trigger: thaw(a.trigger), conditions: thaw(a.conditions), actions: thaw(a.actions) });
}

export async function createAutomationFromTemplate(ctx: OpsContext, templateId: string, overrides: Partial<AutomationInput> = {}): Promise<Automation> {
  const template = findAutomationTemplate(templateId);
  if (!template) throw new OpsError("notFound", `Unknown automation template "${templateId}". Templates: ${AUTOMATION_TEMPLATES.map((t) => t.id).join(", ")}.`);
  return createAutomation(ctx, { ...template.build(), ...overrides });
}

export async function clearAutomationRuns(ctx: OpsContext, opts: { automationId?: string } = {}): Promise<{ deleted: number }> {
  assertCan(ctx, "automations.write");
  const runs = automationRunsOf(ctx.store).filter((r) => !opts.automationId || r.automationId === opts.automationId);
  if (runs.length) await ctx.store.write(runs.map((r) => ({ op: "delete" as const, collection: "automationRuns" as const, id: r.id })), { message: "Clear automation runs" });
  return { deleted: runs.length };
}

// Keeps the newest `keep` runs.
export async function pruneAutomationRuns(ctx: OpsContext, keep = MAX_AUTOMATION_RUNS): Promise<{ deleted: number }> {
  const runs = listAutomationRuns(ctx);
  const doomed = runs.slice(keep);
  if (doomed.length) await ctx.store.write(doomed.map((r) => ({ op: "delete" as const, collection: "automationRuns" as const, id: r.id })), { message: "Prune automation runs" });
  return { deleted: doomed.length };
}

// ─── Matching ───────────────────────────────────────────────────────────

function conditionsMatch(ctx: OpsContext, automation: Automation, record: CrmRecord, object: ObjectDef): boolean {
  if (!automation.conditions?.length) return true;
  const qctx = queryContext(ctx, object);
  return automation.conditions.every((f) => matchesFilter(record, f, qctx));
}

function stageMatches(ctx: OpsContext, record: CrmRecord, to: unknown, stageId: string): boolean {
  if (to === undefined || to === null || to === "") return true;
  const wanted = String(to).toLowerCase();
  if (stageId.toLowerCase() === wanted) return true;
  const pipeline = pipelineOfRecord(ctx, record);
  const stage = pipeline?.stages.find((s) => s.id === stageId);
  return !!stage && (stage.kind === wanted || stage.label.toLowerCase() === wanted);
}

// Does `automation`'s trigger fire for this event? (conditions aside)
export function triggerMatches(ctx: OpsContext, automation: Automation, event: AutomationEvent): boolean {
  const t = automation.trigger;
  const record = "record" in event.payload ? event.payload.record : undefined;
  if (!record || record.object !== automation.object) return false;
  switch (event.type) {
    case "record.created":
      return t.type === "record.created";
    case "record.updated": {
      const changed = event.payload.changed;
      if (t.type === "record.updated") return !t.field || changed.includes(t.field);
      if (t.type !== "field.changed" || !t.field || !changed.includes(t.field)) return false;
      if (t.to === undefined || t.to === null || t.to === "") return true;
      const object = objectOf(ctx.store, record.object);
      return !!object && matchesFilter(record, { field: t.field, op: "eq", value: t.to }, queryContext(ctx, object));
    }
    case "stage.changed":
      return t.type === "stage.changed" && stageMatches(ctx, record, t.to, event.payload.to);
    default:
      return false;
  }
}

// ─── Actions ────────────────────────────────────────────────────────────

function eligibleOwners(ctx: OpsContext): CrmUser[] {
  return usersOf(ctx.store)
    .filter((u) => !u.disabled && u.role !== "viewer")
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

interface ActionPlan {
  action: AutomationAction;
  describe: string;
}

function describeAction(ctx: OpsContext, action: AutomationAction, record: CrmRecord, object: ObjectDef): string {
  switch (action.type) {
    case "createTask": {
      const assignee = action.assignTo && action.assignTo !== "owner" ? action.assignTo : record.ownerId;
      return `Create task "${renderTemplate(ctx, action.title, record, object)}"${action.dueInDays !== undefined ? ` due in ${action.dueInDays} day(s)` : ""}${assignee ? ` for ${userOf(ctx.store, assignee)?.name ?? assignee}` : ""}`;
    }
    case "updateField":
      return `Set ${resolveField(object, action.field)?.label ?? action.field} to ${JSON.stringify(typeof action.value === "string" ? renderTemplate(ctx, action.value, record, object) : action.value ?? null)}`;
    case "addNote":
      return `Add note "${renderTemplate(ctx, action.body, record, object).slice(0, 120)}"`;
    case "assignOwner":
      return action.userId === "roundRobin" ? "Assign owner (round robin)" : `Assign owner ${userOf(ctx.store, action.userId)?.name ?? action.userId}`;
    case "webhook":
      return `POST to ${action.url}`;
  }
}

async function postWebhook(url: string, body: unknown): Promise<void> {
  const fetchImpl: FetchLike | undefined = webhookFetch ?? (typeof fetch === "function" ? (fetch as unknown as FetchLike) : undefined);
  if (!fetchImpl) throw new Error("fetch is not available in this environment.");
  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), 10_000) : undefined;
  try {
    // text/plain keeps the request "simple" (no CORS preflight) — most
    // webhook receivers parse the JSON body regardless.
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body), signal: controller?.signal });
    if (!res.ok && res.status !== 0) throw new Error(`Webhook answered HTTP ${res.status}.`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function executeAction(
  ctx: OpsContext,
  actx: OpsContext,
  automation: Automation,
  action: AutomationAction,
  recordId: string,
  object: ObjectDef,
  trigger: string,
): Promise<string> {
  // Re-read: a previous action may have changed the record (owner…).
  const record = requireRecord(ctx.store, recordId);
  switch (action.type) {
    case "createTask": {
      const assigneeId = action.assignTo && action.assignTo !== "owner" ? action.assignTo : record.ownerId;
      const task = await createTask(actx, {
        title: renderTemplate(ctx, action.title, record, object),
        dueAt: action.dueInDays !== undefined ? ctx.now() + action.dueInDays * DAY : undefined,
        assigneeId: assigneeId && userOf(ctx.store, assigneeId) ? assigneeId : undefined,
        targets: [{ object: record.object, id: record.id }],
      });
      return `Task ${task.id} created`;
    }
    case "updateField": {
      const value = typeof action.value === "string" ? renderTemplate(ctx, action.value, record, object) : action.value;
      await updateRecord(actx, record.id, { [action.field]: value ?? null });
      return `${action.field} updated`;
    }
    case "addNote": {
      const note = await addNote(actx, { object: record.object, id: record.id }, renderTemplate(ctx, action.body, record, object), automation.name);
      return `Note ${note.id} added`;
    }
    case "assignOwner": {
      let userId = action.userId;
      if (userId === "roundRobin") {
        const pool = eligibleOwners(ctx);
        if (!pool.length) throw new Error("No active admin or member to assign.");
        const doc = ctx.store.get("automations", automation.id) as unknown as AutomationDoc | undefined;
        const cursor = doc?.roundRobinCursor ?? 0;
        userId = pool[cursor % pool.length].id;
        await ctx.store.write([{ op: "patch", collection: "automations", id: automation.id, fields: { roundRobinCursor: (cursor + 1) % pool.length } }], { message: "Automation round robin" });
      }
      await setRecordOwner(actx, record.id, userId);
      return `Owner set to ${userOf(ctx.store, userId)?.name ?? userId}`;
    }
    case "webhook": {
      await postWebhook(action.url, {
        automation: { id: automation.id, name: automation.name },
        trigger,
        firedAt: new Date(ctx.now()).toISOString(),
        record: summarizeForWebhook(ctx, record, object),
      });
      return `POST ${action.url} ok`;
    }
  }
}

interface RunInput {
  automation: Automation;
  record: CrmRecord;
  object: ObjectDef;
  trigger: AutomationTriggerType | string;
  key?: string;
  dryRun?: boolean;
}

// Runs (or simulates) one automation on one record and logs the run.
async function runOne(ctx: OpsContext, input: RunInput): Promise<AutomationRunDoc> {
  const { automation, record, object, dryRun } = input;
  const startedAt = ctx.now();
  const run: AutomationRunDoc = {
    id: newId(startedAt),
    automationId: automation.id,
    recordId: record.id,
    startedAt,
    status: "ok",
    trigger: automation.trigger.type,
    ...(input.key ? { key: input.key } : {}),
    ...(dryRun ? { dryRun: true } : {}),
  };
  const results: ActionResult[] = [];
  if (dryRun) {
    const plans: ActionPlan[] = automation.actions.map((a) => ({ action: a, describe: describeAction(ctx, a, record, object) }));
    run.actions = plans.map((p) => ({ type: p.action.type, ok: true, message: p.describe }));
    run.finishedAt = ctx.now();
    run.message = "Dry run — nothing was written.";
    return run;
  }
  const actx: OpsContext = { ...ctx, user: null, depth: (ctx.depth ?? 0) + 1 };
  for (const action of automation.actions) {
    try {
      const message = await executeAction(ctx, actx, automation, action, record.id, object, String(input.trigger));
      results.push({ type: action.type, ok: true, message });
    } catch (err) {
      results.push({ type: action.type, ok: false, message: (err as Error).message ?? String(err) });
      // A failing webhook doesn't stop the other actions; a failing write
      // (record gone, validation…) neither — every action is independent.
    }
  }
  run.actions = results;
  run.finishedAt = ctx.now();
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    run.status = "error";
    run.message = failed.map((f) => `${f.type}: ${f.message}`).join(" · ");
  }
  await ctx.store.write(
    [
      { op: "set", collection: "automationRuns", doc: asDoc(run) },
      { op: "patch", collection: "automations", id: automation.id, fields: { lastRunAt: run.finishedAt } },
    ],
    { message: `Automation run: ${automation.name}` },
  );
  ctx.log?.(`automation "${automation.name}" on ${record.id}: ${run.status}`);
  return run;
}

async function logSkipped(ctx: OpsContext, automation: Automation, recordId: string | undefined, message: string): Promise<AutomationRunDoc> {
  const now = ctx.now();
  const run: AutomationRunDoc = { id: newId(now), automationId: automation.id, ...(recordId ? { recordId } : {}), startedAt: now, finishedAt: now, status: "skipped", message, trigger: automation.trigger.type };
  await ctx.store.write([{ op: "set", collection: "automationRuns", doc: asDoc(run) }], { message: `Automation skipped: ${automation.name}` });
  return run;
}

function tally(runs: AutomationRun[]): AutomationRunReport {
  return {
    ran: runs.filter((r) => r.status === "ok").length,
    skipped: runs.filter((r) => r.status === "skipped").length,
    errors: runs.filter((r) => r.status === "error").length,
    runs,
  };
}

// ─── Event triggers ─────────────────────────────────────────────────────

export async function runAutomationEvent(ctx: OpsContext, event: AutomationEvent): Promise<AutomationRunReport> {
  const record = "record" in event.payload ? event.payload.record : undefined;
  if (!record || record.deletedAt) return tally([]);
  const candidates = automationsOf(ctx.store).filter((a) => a.enabled && EVENT_TRIGGERS.includes(a.trigger.type) && triggerMatches(ctx, a, event));
  if (!candidates.length) return tally([]);
  const object = objectOf(ctx.store, record.object);
  if (!object) return tally([]);
  const runs: AutomationRun[] = [];
  const depth = ctx.depth ?? 0;
  for (const automation of candidates) {
    if (depth >= MAX_AUTOMATION_DEPTH) {
      runs.push(await logSkipped(ctx, automation, record.id, `Loop protection: nested automation depth ${depth} reached the limit (${MAX_AUTOMATION_DEPTH}).`));
      continue;
    }
    const current = recordOf(ctx.store, record.id);
    if (!current || current.deletedAt) continue;
    if (!conditionsMatch(ctx, automation, current, object)) continue;
    runs.push(await runOne(ctx, { automation, record: current, object, trigger: event.type }));
  }
  return tally(runs);
}

// Subscribes the engine to a plugin registry. Returns an uninstall function.
export function installAutomations(registry: PluginRegistry = defaultPlugins): () => void {
  const types: ("record.created" | "record.updated" | "stage.changed")[] = ["record.created", "record.updated", "stage.changed"];
  const offs = types.map((type) =>
    registry.addAction(type, async (ctx, payload) => {
      // The registry passes the OpsContext the op ran with.
      await runAutomationEvent(ctx as OpsContext, { type, payload } as AutomationEvent);
    }, 50),
  );
  return () => offs.forEach((off) => off());
}

// ─── Scheduled triggers ─────────────────────────────────────────────────

export interface ScheduledOptions {
  dryRun?: boolean;
  automationId?: string;
  // Ignore the `everyHours` spacing of schedule triggers (manual "Run now").
  force?: boolean;
}

// The time inactivity counts from: last activity or last update.
export function lastTouchedAt(ctx: OpsContext, record: CrmRecord): number {
  return Math.max(lastActivityAt(ctx, record.id) ?? 0, record.updatedAt, record.createdAt);
}

export async function runScheduled(ctx: OpsContext, opts: ScheduledOptions = {}): Promise<AutomationRunReport> {
  assertCan(ctx, "automations.run");
  const now = ctx.now();
  const automations = automationsOf(ctx.store).filter(
    (a) => SCHEDULED_TRIGGERS.includes(a.trigger.type) && (opts.automationId ? a.id === opts.automationId : a.enabled),
  );
  if (opts.automationId && !automations.length) {
    const a = getAutomation(ctx, opts.automationId);
    throw new OpsError("invalid", `Automation "${a.name}" has a ${a.trigger.type} trigger — only schedule / inactivity automations run on a schedule.`);
  }
  const knownKeys = new Set((automationRunsOf(ctx.store) as AutomationRunDoc[]).map((r) => r.key).filter((k): k is string => !!k));
  const runs: AutomationRun[] = [];
  for (const automation of automations) {
    const object = objectOf(ctx.store, automation.object);
    if (!object) continue;
    const t = automation.trigger;
    let slotKey: string | null = null;
    if (t.type === "schedule") {
      const every = Math.max(1, t.everyHours ?? 24) * HOUR;
      if (!opts.force && automation.lastRunAt && now - automation.lastRunAt < every) continue;
      slotKey = `${automation.id}:schedule:${Math.floor(now / every)}`;
    }
    const sysCtx: OpsContext = { ...ctx, depth: ctx.depth ?? 0 };
    let matched = 0;
    for (const record of recordsOf(ctx.store, object.id)) {
      let key: string;
      if (t.type === "inactivity") {
        const since = lastTouchedAt(ctx, record);
        if (now - since < (t.days ?? 14) * DAY) continue;
        key = `${automation.id}:inactivity:${record.id}:${since}`;
      } else {
        key = `${slotKey}:${record.id}${opts.force ? `:${now}` : ""}`;
      }
      if (knownKeys.has(key)) continue;
      if (!conditionsMatch(ctx, automation, record, object)) continue;
      matched++;
      const run = await runOne(sysCtx, { automation, record, object, trigger: t.type, key, dryRun: opts.dryRun });
      knownKeys.add(key);
      runs.push(run);
    }
    // A schedule with no matching record still counts as run (spacing).
    if (t.type === "schedule" && !matched && !opts.dryRun) {
      await ctx.store.write([{ op: "patch", collection: "automations", id: automation.id, fields: { lastRunAt: now } }], { message: "Automation schedule tick" });
    }
  }
  if (!opts.dryRun && automationRunsOf(ctx.store).length > MAX_AUTOMATION_RUNS) await pruneAutomationRuns(ctx);
  return tally(runs);
}

// ─── Manual runs ────────────────────────────────────────────────────────

// Runs (dryRun: simulates) one automation on one record, ignoring its
// trigger — the editor's "Test on a record". Conditions are evaluated:
// when they don't match, the run is reported as skipped (not logged).
export async function testAutomation(
  ctx: OpsContext,
  automation: Automation | (AutomationInput & { id?: string }),
  recordId: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ matched: boolean; run: AutomationRunDoc; failedConditions: Filter[] }> {
  assertCan(ctx, "automations.run");
  const dryRun = opts.dryRun !== false;
  if (!dryRun) assertCan(ctx, "records.write");
  const record = requireRecord(ctx.store, recordId);
  const object = requireObject(ctx.store, record.object);
  const def: Automation = {
    id: automation.id ?? "test",
    name: automation.name || "Test",
    enabled: true,
    object: automation.object,
    trigger: automation.trigger,
    conditions: automation.conditions ?? [],
    actions: automation.actions,
  };
  if (def.object !== record.object) throw new OpsError("validation", `This automation applies to ${def.object}; the record is a ${object.labelSingular}.`);
  const qctx = queryContext(ctx, object);
  const failedConditions = def.conditions.filter((f) => !matchesFilter(record, f, qctx));
  if (failedConditions.length) {
    const now = ctx.now();
    return {
      matched: false,
      failedConditions,
      run: { id: "test", automationId: def.id, recordId, startedAt: now, finishedAt: now, status: "skipped", message: "Conditions don't match this record.", dryRun },
    };
  }
  const run = await runOne(ctx, { automation: def, record, object, trigger: "manual", dryRun });
  return { matched: true, run, failedConditions: [] };
}

// Re-exported for tools / UI that need to know the matching records of
// a scheduled automation without running it.
export function scheduledCandidates(ctx: OpsContext, automationId: string): CrmRecord[] {
  const a = getAutomation(ctx, automationId);
  const object = objectOf(ctx.store, a.object);
  if (!object) return [];
  return recordsOf(ctx.store, object.id).filter((r) => {
    if (a.trigger.type === "inactivity" && ctx.now() - lastTouchedAt(ctx, r) < (a.trigger.days ?? 14) * DAY) return false;
    return conditionsMatch(ctx, a, r, object);
  });
}

// Emails of the users an automation may assign — exposed for the editor.
export function automationAssignees(ctx: OpsContext): { id: string; name: string; email: string }[] {
  return eligibleOwners(ctx).map((u) => ({ id: u.id, name: u.name, email: normalizeEmail(u.email) }));
}
