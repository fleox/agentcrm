// AI tools for automations, lead forms and email drafting — part of the
// catalog in ./tools.ts (spread at the end of AI_TOOLS). Handlers call
// src/ops/ only.

import { normalizeEmail, recordLabel } from "../core/fields";
import type { Automation, AutomationAction, AutomationTrigger, Filter } from "../core/types";
import { FILTER_OPS } from "../core/types";
import { listActivities } from "../ops/activities";
import {
  ACTION_TYPES,
  AUTOMATION_TEMPLATES,
  TRIGGER_TYPES,
  createAutomation,
  createAutomationFromTemplate,
  listAutomationRuns,
  listAutomations,
  runScheduled,
  setAutomationEnabled,
  testAutomation,
} from "../ops/automations";
import { OpsError, type OpsContext } from "../ops/context";
import { ingestInbox, listForms, type LeadFormDoc } from "../ops/forms";
import { getRecord } from "../ops/records";
import { objectOf, recordOf, userOf } from "../ops/store";
import type { AiTool, JsonSchema } from "./tools";

function summarizeAutomation(ctx: OpsContext, a: Automation): Record<string, unknown> {
  const last = listAutomationRuns(ctx, { automationId: a.id, limit: 1 })[0];
  return {
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    object: a.object,
    trigger: a.trigger,
    conditions: a.conditions,
    actions: a.actions,
    ...(a.lastRunAt ? { lastRunAt: new Date(a.lastRunAt).toISOString() } : {}),
    ...(last ? { lastRun: { status: last.status, at: new Date(last.startedAt).toISOString(), ...(last.message ? { message: last.message } : {}) } } : {}),
  };
}

function summarizeForm(f: LeadFormDoc): Record<string, unknown> {
  return {
    id: f.id,
    name: f.name,
    object: f.object,
    fields: f.fields,
    inbox: f.inbox.kind,
    ...(f.publishedUrl ? { url: f.publishedUrl } : {}),
    ...(f.publishedAt ? { publishedAt: new Date(f.publishedAt).toISOString() } : {}),
    ...(f.lastIngestAt ? { lastIngestAt: new Date(f.lastIngestAt).toISOString() } : {}),
  };
}

const triggerSchema: JsonSchema = {
  type: "object",
  description:
    "record.created | record.updated (optional field) | field.changed (field, optional to = new value: option id or label) | stage.changed (optional to = stage id or kind won/lost/open) | schedule (everyHours) | inactivity (days without activity).",
  properties: {
    type: { type: "string", enum: TRIGGER_TYPES },
    field: { type: "string" },
    to: { description: "Value the field / stage must change to." },
    days: { type: "number" },
    everyHours: { type: "number" },
  },
  required: ["type"],
};

const actionSchema: JsonSchema = {
  type: "object",
  description:
    'One of: {type:"createTask", title, dueInDays?, assignTo?: "owner"|userId} · {type:"updateField", field, value} · {type:"addNote", body} · {type:"assignOwner", userId: userId|"roundRobin"} · {type:"webhook", url}. Texts accept {{label}}, {{<fieldId>}}, {{owner}} placeholders.',
  properties: {
    type: { type: "string", enum: ACTION_TYPES },
    title: { type: "string" },
    dueInDays: { type: "number" },
    assignTo: { type: "string" },
    field: { type: "string" },
    value: {},
    body: { type: "string" },
    userId: { type: "string" },
    url: { type: "string" },
  },
  required: ["type"],
};

const conditionSchema: JsonSchema = {
  type: "object",
  properties: { field: { type: "string" }, op: { type: "string", enum: FILTER_OPS }, value: {} },
  required: ["field", "op"],
};

export const AUTOMATION_FORM_TOOLS: AiTool[] = [
  {
    name: "list_automations",
    description: "List the automations (trigger, conditions, actions, enabled, last run) and, with includeRuns, the latest runs log. Also lists the ready-made templates.",
    inputSchema: { type: "object", properties: { includeRuns: { type: "boolean" }, limit: { type: "number", default: 20, maximum: 100 } } },
    mutating: false,
    handler: (ctx, input) => ({
      automations: listAutomations(ctx).map((a) => summarizeAutomation(ctx, a)),
      templates: AUTOMATION_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description })),
      ...(input.includeRuns
        ? {
            runs: listAutomationRuns(ctx, { limit: Math.min(100, typeof input.limit === "number" ? input.limit : 20) }).map((r) => ({
              automationId: r.automationId,
              recordId: r.recordId,
              status: r.status,
              at: new Date(r.startedAt).toISOString(),
              ...(r.message ? { message: r.message } : {}),
              actions: r.actions,
            })),
          }
        : {}),
    }),
  },
  {
    name: "create_automation",
    description:
      "Create an automation (admin only), either from a template (templateId, see list_automations) or from a full definition (name, object, trigger, conditions, actions). Use describe_schema for field ids. Set enabled false to create it paused.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", enum: AUTOMATION_TEMPLATES.map((t) => t.id) },
        name: { type: "string" },
        object: { type: "string" },
        trigger: triggerSchema,
        conditions: { type: "array", items: conditionSchema },
        actions: { type: "array", items: actionSchema },
        enabled: { type: "boolean", default: true },
      },
    },
    mutating: true,
    handler: async (ctx, input) => {
      const enabled = input.enabled === undefined ? undefined : input.enabled !== false;
      if (typeof input.templateId === "string") {
        const overrides = { ...(typeof input.name === "string" ? { name: input.name } : {}), ...(enabled !== undefined ? { enabled } : {}) };
        return summarizeAutomation(ctx, await createAutomationFromTemplate(ctx, input.templateId, overrides));
      }
      if (typeof input.object !== "string" || !input.trigger || !Array.isArray(input.actions)) throw new OpsError("validation", "Give a templateId, or name + object + trigger + actions.");
      const a = await createAutomation(ctx, {
        name: typeof input.name === "string" ? input.name : "",
        object: input.object,
        trigger: input.trigger as AutomationTrigger,
        conditions: (input.conditions as Filter[]) ?? [],
        actions: input.actions as AutomationAction[],
        ...(enabled !== undefined ? { enabled } : {}),
      });
      return summarizeAutomation(ctx, a);
    },
  },
  {
    name: "run_automations",
    description:
      "Run the scheduled automations (schedule / inactivity triggers) now, or test one automation on one record (automationId + recordId). DRY RUN unless confirm is true — show the planned actions to the user before confirming. Can also enable / disable an automation (enabled).",
    inputSchema: {
      type: "object",
      properties: {
        automationId: { type: "string" },
        recordId: { type: "string", description: "Test the automation on this record (ignores the trigger, checks conditions)." },
        enabled: { type: "boolean", description: "Only enable / disable automationId, don't run." },
        confirm: { type: "boolean", default: false },
      },
    },
    mutating: true,
    handler: async (ctx, input) => {
      const automationId = typeof input.automationId === "string" ? input.automationId : undefined;
      if (typeof input.enabled === "boolean") {
        if (!automationId) throw new OpsError("validation", "enabled needs an automationId.");
        return summarizeAutomation(ctx, await setAutomationEnabled(ctx, automationId, input.enabled));
      }
      const dryRun = input.confirm !== true;
      if (typeof input.recordId === "string") {
        if (!automationId) throw new OpsError("validation", "recordId needs an automationId.");
        const a = listAutomations(ctx).find((x) => x.id === automationId);
        if (!a) throw new OpsError("notFound", `Automation "${automationId}" not found.`);
        const res = await testAutomation(ctx, a, input.recordId, { dryRun });
        return { dryRun, matched: res.matched, failedConditions: res.failedConditions, status: res.run.status, actions: res.run.actions, message: res.run.message };
      }
      const report = await runScheduled(ctx, { dryRun, automationId, force: !!automationId });
      return {
        dryRun,
        ran: report.ran,
        skipped: report.skipped,
        errors: report.errors,
        runs: report.runs.slice(0, 50).map((r) => ({ automationId: r.automationId, recordId: r.recordId, status: r.status, actions: r.actions, ...(r.message ? { message: r.message } : {}) })),
        runsTruncated: report.runs.length > 50,
      };
    },
  },
  {
    name: "list_forms",
    description: "List the lead capture forms: object, fields, inbox kind (s3 / firebase / webhook), published URL, last ingestion.",
    inputSchema: { type: "object", properties: {} },
    mutating: false,
    handler: (ctx) => ({ forms: (listForms(ctx) as LeadFormDoc[]).map(summarizeForm) }),
  },
  {
    name: "ingest_inbox",
    description:
      "Import pending lead form submissions from the inbox(es): creates or updates records (dedupe on email), creates companies from email domains, logs a 'Form submission' note, then removes processed submissions. DRY RUN unless confirm is true.",
    inputSchema: { type: "object", properties: { formId: { type: "string" }, confirm: { type: "boolean", default: false } } },
    mutating: true,
    handler: async (ctx, input) => {
      const r = await ingestInbox(ctx, typeof input.formId === "string" ? input.formId : undefined, { dryRun: input.confirm !== true });
      return { dryRun: input.confirm !== true, ...r, results: r.results?.slice(0, 50) };
    },
  },
  {
    name: "draft_email",
    description:
      "Prepare an email draft to a person (or a company's people / a deal's contacts): returns recipients, a subject and body (yours if given, else a skeleton) plus context (record, recent activities, last email). Never sends — show the draft to the user; they send it from the record's Emails tab.",
    inputSchema: {
      type: "object",
      properties: {
        recordId: { type: "string" },
        subject: { type: "string" },
        body: { type: "string", description: "Markdown / plain text body you wrote." },
        purpose: { type: "string", description: "What the email is for (follow-up, intro, proposal…)." },
      },
      required: ["recordId"],
    },
    mutating: false,
    handler: (ctx, input) => {
      const record = getRecord(ctx, String(input.recordId));
      const object = objectOf(ctx.store, record.object);
      const recipients: { id: string; name: string; email: string }[] = [];
      const addPerson = (id: unknown) => {
        const p = typeof id === "string" ? recordOf(ctx.store, id) : undefined;
        const email = p && !p.deletedAt ? normalizeEmail(p.fields.email) : "";
        if (p && email && !recipients.some((r) => r.email === email)) recipients.push({ id: p.id, name: recordLabel(objectOf(ctx.store, "people"), p), email });
      };
      if (record.object === "people") addPerson(record.id);
      for (const v of Object.values(record.fields)) {
        for (const id of Array.isArray(v) ? v : [v]) if (typeof id === "string" && recordOf(ctx.store, id)?.object === "people") addPerson(id);
      }
      if (record.object === "companies") {
        for (const p of ctx.store.list("records")) if (p.object === "people" && !p.deletedAt && (p.fields as Record<string, unknown>).company === record.id) addPerson(p.id);
      }
      const activities = listActivities(ctx, { target: record.id, includeRelated: true, limit: 8 }).items;
      const lastEmail = activities.find((a) => a.type === "email");
      const me = ctx.user ? userOf(ctx.store, ctx.user.id) ?? ctx.user : null;
      const first = recipients[0]?.name.split(" ")[0];
      const subject = typeof input.subject === "string" && input.subject.trim() ? input.subject.trim() : typeof input.purpose === "string" ? input.purpose.trim() : `Following up — ${recordLabel(object, record)}`;
      const body =
        typeof input.body === "string" && input.body.trim()
          ? input.body
          : `Hi ${first ?? "there"},\n\n[Write the message${typeof input.purpose === "string" ? ` (${input.purpose})` : ""} here.]\n\nBest,\n${me?.name ?? ""}`;
      return {
        draft: { to: recipients.slice(0, 10), subject, body },
        sent: false,
        note: "Draft only — nothing was sent. The user can send it from the record's Emails tab (Gmail / Outlook integration).",
        context: {
          record: { id: record.id, object: record.object, label: recordLabel(object, record) },
          recentActivities: activities.map((a) => ({ type: a.type, title: a.title, at: new Date(a.createdAt).toISOString() })),
          ...(lastEmail ? { lastEmail: { title: lastEmail.title, body: lastEmail.body?.slice(0, 800), at: new Date(lastEmail.createdAt).toISOString() } } : {}),
        },
      };
    },
  },
];
