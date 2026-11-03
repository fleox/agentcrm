import { ACTIVITY_TYPES, type Activity, type ActivityType } from "../../src/core/types";
import type { OpsContext } from "../../src/ops/context";
import { withSession } from "../ops/session";
import type { Command } from "./types";
import { ATTACH_OPTION, readLocalFile, uploadLocalFiles } from "./files";
import { AS_OPTION, boolOpt, jsonObjectOpt, listOpt, multiOpt, numOpt, positional, readTextValue, requireStr, SITE_OPTION, strOpt, table, usage } from "./util";

function activityOut(a: Activity) {
  return {
    id: a.id,
    type: a.type,
    title: a.title,
    ...(a.body ? { body: a.body } : {}),
    targets: a.targets,
    ...(a.dueAt ? { dueAt: new Date(a.dueAt).toISOString() } : {}),
    ...(a.doneAt ? { doneAt: new Date(a.doneAt).toISOString() } : {}),
    ...(a.assigneeId ? { assigneeId: a.assigneeId } : {}),
    ...(a.meta ? { meta: a.meta } : {}),
    ...(a.attachments?.length ? { attachments: a.attachments } : {}),
    createdAt: new Date(a.createdAt).toISOString(),
  };
}

const targets = (ids: string[]) => ids.map((id) => ({ object: "", id }));

function body(options: Record<string, unknown>): string | undefined {
  const v = options.body;
  return typeof v === "string" ? readTextValue(v, "body") : undefined;
}

// Assignee by id or email.
async function userRef(ctx: OpsContext, ref: string | undefined): Promise<string | undefined> {
  if (!ref) return undefined;
  const { usersOf } = await import("../../src/ops/store");
  const u = usersOf(ctx.store).find((x) => x.id === ref || x.email.toLowerCase() === ref.toLowerCase());
  if (!u) usage(`No CRM user "${ref}".`, "`agentcrm users list` lists them.");
  return u.id;
}

// --attach <path> (repeatable): checked before the session opens,
// uploaded inside it, then attached to the new activity.
function attachPaths(options: Record<string, unknown>): string[] {
  const v = options.attach;
  const paths = Array.isArray(v) ? (v as string[]) : typeof v === "string" ? [v] : [];
  for (const p of paths) readLocalFile(p);
  return paths;
}

async function attachments(ctx: OpsContext, paths: string[]): Promise<string[] | undefined> {
  if (!paths.length) return undefined;
  return (await uploadLocalFiles(ctx, paths)).map((f) => f.id);
}

const RECORD_OPT = { name: "record", type: "string" as const, description: "Record id the activity is attached to (repeatable).", multiple: true };

export const activitiesCommand: Command = {
  name: "activities",
  usage: "activities <add|list|done> …",
  summary: "Timeline entries: log calls, emails, meetings and notes on records; list a record's timeline (optionally with its related records' activities).",
  subcommands: [
    { name: "add", usage: `activities add --type <${ACTIVITY_TYPES.join("|")}> --title <t> [--body <md|@file>] --record <id>… [--meta <json>] [--due <date>] [--assignee <user>] [--attach <path>]…`, summary: "Log an activity (with attachments).", writes: true },
    { name: "list", usage: "activities list [--record <id>] [--type <t>]… [--related] [--limit n]", summary: "Timeline, most recent first." },
    { name: "done", usage: "activities done <id> [--undo]", summary: "Mark a task done (or reopen).", writes: true },
  ],
  options: [
    SITE_OPTION,
    AS_OPTION,
    { name: "type", type: "string", description: `Activity type: ${ACTIVITY_TYPES.join(", ")} (list: repeatable filter).`, multiple: true },
    { name: "title", type: "string", description: "Title / subject." },
    { name: "body", type: "string", description: "Markdown body, or @file." },
    RECORD_OPT,
    { name: "meta", type: "string", description: "JSON metadata, e.g. {\"durationMin\":20} or {\"startAt\":…,\"endAt\":…}." },
    { name: "due", type: "string", description: "Due date (tasks): ISO date / datetime." },
    { name: "assignee", type: "string", description: "Assignee user id or email." },
    { name: "related", type: "boolean", description: "list: include activities of linked records." },
    { name: "limit", type: "string", description: "Max items (default 50)." },
    { name: "undo", type: "boolean", description: "done: reopen the task." },
    ATTACH_OPTION,
  ],
  async run({ io, options, positionals }) {
    const [action, id] = positionals;
    switch (action) {
      case "add": {
        const files = attachPaths(options);
        const type = requireStr(options, "type") as ActivityType;
        if (!ACTIVITY_TYPES.includes(type)) usage(`Unknown activity type "${type}".`, `Types: ${ACTIVITY_TYPES.join(", ")}.`);
        const title = requireStr(options, "title");
        const recs = multiOpt(options, "record");
        if (!recs.length && type !== "task") usage("activities add needs --record <id> (repeatable).");
        return withSession(io, options, { lock: true }, async ({ ctx }) => {
          const { addActivity } = await import("../../src/ops/activities");
          return activityOut(
            await addActivity(ctx, {
              type,
              title,
              body: body(options),
              targets: targets(recs),
              meta: jsonObjectOpt(options, "meta"),
              ...(strOpt(options, "due") ? { dueAt: strOpt(options, "due") } : {}),
              ...(strOpt(options, "assignee") ? { assigneeId: await userRef(ctx, strOpt(options, "assignee")) } : {}),
              attachments: await attachments(ctx, files),
            }),
          );
        });
      }
      case "list":
        return withSession(io, options, {}, async ({ ctx }) => {
          const { listActivities } = await import("../../src/ops/activities");
          const types = listOpt(options, "type") as ActivityType[] | undefined;
          const page = listActivities(ctx, { target: multiOpt(options, "record")[0], types, includeRelated: boolOpt(options, "related"), limit: Math.min(500, numOpt(options, "limit") ?? 50) });
          return { total: page.total, activities: page.items.map(activityOut) };
        }, (r) => `${r.total} activit${r.total === 1 ? "y" : "ies"}\n${table(r.activities, ["id", "type", "title", "createdAt"])}`);
      case "done": {
        if (!id) usage("activities done needs an id.");
        return withSession(io, options, { lock: true }, async ({ ctx }) => activityOut(await (await import("../../src/ops/activities")).completeTask(ctx, id, !boolOpt(options, "undo"))));
      }
      default:
        usage(`Unknown activities action "${action ?? ""}".`, "Use add, list or done.");
    }
  },
};

export const notesCommand: Command = {
  name: "notes",
  usage: "notes add <recordId> --body <markdown|@file> [--title <t>] [--attach <path>]…",
  summary: "Add a note (Markdown, optional attachments) to a record's timeline.",
  subcommands: [{ name: "add", usage: "notes add <recordId> --body <markdown|@file> [--title <t>] [--attach <path>]…", summary: "Add a note.", writes: true }],
  options: [SITE_OPTION, AS_OPTION, { name: "body", type: "string", description: "Markdown, or @file." }, { name: "title", type: "string", description: "Title (default: first line)." }, ATTACH_OPTION],
  async run({ io, options, positionals }) {
    const [action, recordId] = positionals;
    if (action !== "add") usage(`Unknown notes action "${action ?? ""}".`, "Use: notes add <recordId> --body …");
    const id = positional(positionals, 1, "record id", "notes add <recordId> --body …");
    void recordId;
    const text = body(options);
    if (!text?.trim()) usage("notes add needs --body.");
    const files = attachPaths(options);
    return withSession(io, options, { lock: true }, async ({ ctx }) => {
      const ops = await import("../../src/ops/activities");
      const { recordOf } = await import("../../src/ops/store");
      const r = recordOf(ctx.store, id);
      if (!files.length || !r) return activityOut(await ops.addNote(ctx, id, text, strOpt(options, "title")));
      return activityOut(await ops.addActivity(ctx, { type: "note", title: strOpt(options, "title") ?? "", body: text, targets: [{ object: r.object, id: r.id }], attachments: await attachments(ctx, files) }));
    });
  },
};

export const tasksCommand: Command = {
  name: "tasks",
  usage: "tasks <list|add|done|reassign> …",
  summary: "Tasks: list (open by default; by assignee, record, overdue, due soon), add with due date and assignee, mark done, reassign.",
  subcommands: [
    { name: "list", usage: "tasks list [--assignee <user|me>] [--record <id>] [--status open|done|all] [--overdue] [--due-within <days>] [--limit n]", summary: "Tasks sorted by due date." },
    { name: "add", usage: "tasks add --title <t> [--due <date>] [--assignee <user|me>] [--record <id>]… [--body <md>] [--attach <path>]…", summary: "Create a task.", writes: true },
    { name: "done", usage: "tasks done <id> [--undo]", summary: "Complete (or reopen) a task.", writes: true },
    { name: "reassign", usage: "tasks reassign <id> --assignee <user>", summary: "Change the assignee.", writes: true },
  ],
  options: [
    SITE_OPTION,
    AS_OPTION,
    { name: "title", type: "string", description: "Task title." },
    { name: "body", type: "string", description: "Details (Markdown or @file)." },
    { name: "due", type: "string", description: "Due date / datetime (ISO)." },
    { name: "assignee", type: "string", description: "User id or email; \"me\" = the CLI user." },
    RECORD_OPT,
    { name: "status", type: "string", description: "list: open (default), done or all." },
    { name: "overdue", type: "boolean", description: "list: only overdue." },
    { name: "due-within", type: "string", description: "list: due within N days." },
    { name: "limit", type: "string", description: "Max items (default 50)." },
    { name: "undo", type: "boolean", description: "done: reopen." },
    ATTACH_OPTION,
  ],
  async run({ io, options, positionals }) {
    const [action, id] = positionals;
    const assignee = async (ctx: OpsContext) => {
      const a = strOpt(options, "assignee");
      if (a === "me") return ctx.user?.id;
      return userRef(ctx, a);
    };
    switch (action) {
      case "list":
        return withSession(io, options, {}, async ({ ctx }) => {
          const { listTasks } = await import("../../src/ops/activities");
          const status = (strOpt(options, "status") ?? "open") as "open" | "done" | "all";
          if (!["open", "done", "all"].includes(status)) usage("--status must be open, done or all.");
          const page = listTasks(ctx, { assigneeId: await assignee(ctx), target: multiOpt(options, "record")[0], status, overdue: boolOpt(options, "overdue"), dueWithinDays: numOpt(options, "due-within"), limit: Math.min(500, numOpt(options, "limit") ?? 50) });
          return { total: page.total, tasks: page.items.map(activityOut) };
        }, (r) => `${r.total} task(s)\n${table(r.tasks, ["id", "title", "dueAt", "assigneeId"])}`);
      case "add": {
        const title = requireStr(options, "title");
        const files = attachPaths(options);
        return withSession(io, options, { lock: true }, async ({ ctx }) => {
          const { addActivity } = await import("../../src/ops/activities");
          return activityOut(await addActivity(ctx, { type: "task", title, body: body(options), dueAt: strOpt(options, "due"), assigneeId: (await assignee(ctx)) ?? ctx.user?.id, targets: targets(multiOpt(options, "record")), attachments: await attachments(ctx, files) }));
        });
      }
      case "done":
        if (!id) usage("tasks done needs a task id.");
        return withSession(io, options, { lock: true }, async ({ ctx }) => activityOut(await (await import("../../src/ops/activities")).completeTask(ctx, id, !boolOpt(options, "undo"))));
      case "reassign":
        if (!id) usage("tasks reassign needs a task id.");
        requireStr(options, "assignee");
        return withSession(io, options, { lock: true }, async ({ ctx }) => activityOut(await (await import("../../src/ops/activities")).updateActivity(ctx, id, { assigneeId: (await assignee(ctx)) ?? null })));
      default:
        usage(`Unknown tasks action "${action ?? ""}".`, "Use list, add, done or reassign.");
    }
  },
};
