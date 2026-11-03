// System prompt of the in-admin assistant: rules, the CRM schema (compact),
// the signed-in user, today's date and the page / record in context.

import type { OpsContext } from "../../ops/context";
import { describeSchema } from "../../ops/schema";
import { recordOf } from "../../ops/store";
import { summarizeRecord } from "../tools";

export interface PromptRecordContext {
  objectId: string;
  recordId: string;
}

export interface SystemPromptInput {
  ctx: OpsContext;
  // Current in-app route, e.g. "/objects/deals/abc".
  route?: string;
  record?: PromptRecordContext | null;
  // UI locale (the assistant still answers in the user's language).
  locale?: string;
  crmName?: string;
}

const MAX_RECORD_CHARS = 4000;
const MAX_OPTIONS = 25;

type SchemaObject = ReturnType<typeof describeSchema>[number];

export function renderSchema(objects: SchemaObject[]): string {
  const out: string[] = [];
  for (const o of objects) {
    out.push(`### ${o.id} — ${o.label} (singular "${o.singular}", label field \`${o.labelField}\`, ${o.count} records${o.standard ? "" : ", custom"})`);
    for (const f of o.fields) {
      const bits: string[] = [f.type];
      if (f.relation) bits.push(`→ ${f.relation.object} (${f.relation.cardinality})`);
      if (f.currency) bits.push(f.currency);
      if (f.required) bits.push("required");
      if (f.unique) bits.push("unique");
      if (f.system) bits.push("system");
      if (f.hidden) bits.push("hidden");
      let line = `- \`${f.id}\` "${f.label}": ${bits.join(", ")}`;
      if (f.options?.length) {
        const shown = f.options.slice(0, MAX_OPTIONS).map((x) => (x.id === x.label ? x.id : `${x.id}=${x.label}`));
        line += ` [${shown.join(", ")}${f.options.length > MAX_OPTIONS ? `, … +${f.options.length - MAX_OPTIONS}` : ""}]`;
      }
      out.push(line);
    }
    for (const p of o.pipelines) {
      out.push(`- pipeline \`${p.id}\` "${p.name}": ${p.stages.map((s) => `${s.id}=${s.label} (${s.kind}, ${s.probability}%)`).join("; ")}`);
    }
  }
  return out.join("\n");
}

function isoDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function recordSection(ctx: OpsContext, ref: PromptRecordContext): string {
  const record = recordOf(ctx.store, ref.recordId);
  if (!record || record.object !== ref.objectId) return `The user is looking at record \`${ref.recordId}\` of \`${ref.objectId}\`, which was not found (deleted or no access).`;
  let json: string;
  try {
    json = JSON.stringify(summarizeRecord(ctx, record), null, 1);
  } catch {
    json = JSON.stringify({ id: record.id, object: record.object });
  }
  if (json.length > MAX_RECORD_CHARS) json = `${json.slice(0, MAX_RECORD_CHARS)}… [truncated, call get_record for the full record]`;
  return [
    `The user is looking at this record (it is what "this", "it", "this deal / company / person" refers to unless they say otherwise):`,
    "```json",
    json,
    "```",
  ].join("\n");
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const { ctx } = input;
  const user = ctx.user;
  const now = ctx.now();
  let schema: string;
  try {
    schema = renderSchema(describeSchema(ctx));
  } catch (err) {
    schema = `(schema unavailable: ${err instanceof Error ? err.message : String(err)})`;
  }

  const lines: string[] = [
    `You are the AI assistant built into AgentCRM${input.crmName ? ` ("${input.crmName}")` : ""}, a static CRM (companies, people, deals, pipelines, activities, tasks, custom objects and fields, views, reports) that runs entirely in the user's browser.`,
    "You act on the CRM only through the provided tools, with the signed-in user's permissions (the engine enforces roles; a forbidden error means the user's role does not allow it — say so, do not retry).",
    "",
    "## Rules",
    "- Use tools to look things up; never guess data. Never invent record, user, option or stage ids: get them from tool results or the schema below.",
    "- When unsure about object or field ids, call describe_schema first.",
    "- Search before creating, to avoid duplicates. Prefer one precise tool call over many broad ones; use filters and limits.",
    "- Mutating tools (create / update / delete / move / log / import…) are shown to the user for approval. Before destructive or bulk changes (deleting, merging, importing, changing many records) state clearly what you are about to do. If the user rejects an action, do not retry it; ask what they want instead.",
    "- Answer in the user's language (the language of their last message), concisely, in Markdown. Use short lists and tables when useful.",
    "- Link records as Markdown links to `#/objects/<objectId>/<recordId>` so the user can open them, e.g. [Acme](#/objects/companies/abc123).",
    "- Dates: YYYY-MM-DD; relative dates are relative to today below.",
    "",
    "## Context",
    `- Today: ${isoDate(now)} (${new Date(now).toISOString()}).`,
    user ? `- Signed-in user: ${user.name} <${user.email}>, role ${user.role}, user id \`${user.id}\`.` : "- Signed-in user: system context (all permissions).",
    ...(input.locale ? [`- UI language: ${input.locale}.`] : []),
    ...(input.route ? [`- Current page: \`${input.route}\`.`] : []),
  ];
  if (input.record) lines.push("", recordSection(ctx, input.record));
  lines.push("", "## CRM schema (object ids, field ids and types; select options as id=label)", schema);
  return lines.join("\n");
}
