import { FILTER_OPS, USER_ROLES, type UserRole } from "../../src/core/types";
import { withSession } from "../ops/session";
import type { Command } from "./types";
import { AS_OPTION, boolOpt, fieldsInput, listOpt, multiOpt, parseFilters, parseSorts, positional, requireStr, SITE_OPTION, strOpt, table, usage, YES_OPTION } from "./util";
import { recordOut } from "./records";

export const pipelinesCommand: Command = {
  name: "pipelines",
  usage: "pipelines <list|move> …",
  summary: "Pipelines and their stages (probability, open / won / lost); move a deal to a stage (updates probability; lostReason for lost stages).",
  subcommands: [
    { name: "list", usage: "pipelines list [--object <id>]", summary: "Pipelines with stages." },
    { name: "move", usage: "pipelines move <recordId> <stage id or label> [--lost-reason <text>]", summary: "Move a record to a stage.", writes: true },
  ],
  options: [SITE_OPTION, AS_OPTION, { name: "object", type: "string", description: "list: only this object's pipelines." }, { name: "lost-reason", type: "string", description: "move: why the deal was lost." }],
  async run({ io, options, positionals }) {
    const [action = "list", id, ...stage] = positionals;
    if (action === "list") {
      return withSession(io, options, {}, async ({ ctx }) => (await import("../../src/ops/pipelines")).listPipelines(ctx, strOpt(options, "object")), (ps) =>
        ps.map((p) => `${p.id} (${p.name}, ${p.object}): ${p.stages.map((s) => `${s.label} ${Math.round(s.probability * (s.probability <= 1 ? 100 : 1))}%`).join(" → ")}`).join("\n"),
      );
    }
    if (action === "move") {
      if (!id || !stage.length) usage("pipelines move needs <recordId> <stage>.");
      return withSession(io, options, { lock: true }, async ({ ctx }) => recordOut(ctx, await (await import("../../src/ops/pipelines")).moveStage(ctx, id, stage.join(" "), { lostReason: strOpt(options, "lost-reason") })));
    }
    usage(`Unknown pipelines action "${action}".`, "Use list or move.");
  },
};

export const viewsCommand: Command = {
  name: "views",
  usage: "views <list|create|delete> …",
  summary: "Saved views (table / kanban) of an object: list, create with filters / sorts / columns, delete.",
  subcommands: [
    { name: "list", usage: "views list [--object <id>]", summary: "Views visible to the CLI user." },
    { name: "create", usage: "views create --object <id> --name <n> [--type table|kanban] [--columns a,b] [--filter f:op:v]… [--sort f[:desc]] [--group-by <field>] [--shared]", summary: "Create a view.", writes: true },
    { name: "delete", usage: "views delete <id> [--yes]", summary: "Delete a view. Plan unless --yes.", writes: true, destructive: true },
  ],
  options: [
    SITE_OPTION,
    AS_OPTION,
    YES_OPTION,
    { name: "object", type: "string", description: "Object id." },
    { name: "name", type: "string", description: "View name." },
    { name: "type", type: "string", description: "table (default) or kanban." },
    { name: "columns", type: "string", description: "Column field ids, comma-separated." },
    { name: "filter", type: "string", description: "field:op:value (repeatable).", multiple: true },
    { name: "sort", type: "string", description: "field[:asc|desc] (repeatable).", multiple: true },
    { name: "group-by", type: "string", description: "kanban: select field to group by." },
    { name: "pipeline", type: "string", description: "kanban: pipeline id." },
    { name: "shared", type: "boolean", description: "Visible to every user (admin)." },
  ],
  async run({ io, options, positionals }) {
    const [action = "list", id] = positionals;
    switch (action) {
      case "list":
        return withSession(io, options, {}, async ({ ctx }) => (await import("../../src/ops/views")).listViews(ctx, strOpt(options, "object")), (vs) => table(vs as unknown as Record<string, unknown>[], ["id", "object", "name", "type", "shared"]));
      case "create": {
        const type = strOpt(options, "type") ?? "table";
        if (type !== "table" && type !== "kanban") usage("--type must be table or kanban.");
        const input = {
          object: requireStr(options, "object"),
          name: requireStr(options, "name"),
          type: type as "table" | "kanban",
          ...(listOpt(options, "columns") ? { columns: listOpt(options, "columns") } : {}),
          filters: parseFilters(multiOpt(options, "filter"), FILTER_OPS),
          sorts: parseSorts(multiOpt(options, "sort")),
          ...(strOpt(options, "group-by") ? { groupBy: strOpt(options, "group-by") } : {}),
          ...(strOpt(options, "pipeline") ? { pipelineId: strOpt(options, "pipeline") } : {}),
          shared: boolOpt(options, "shared"),
        };
        return withSession(io, options, { lock: true }, async ({ ctx }) => (await import("../../src/ops/views")).createView(ctx, input));
      }
      case "delete":
        if (!id) usage("views delete needs a view id.");
        return withSession(io, options, { lock: options.yes === true }, async ({ ctx }) => {
          const { getView, deleteView } = await import("../../src/ops/views");
          const v = getView(ctx, id);
          if (options.yes !== true) return { needsConfirmation: true as const, plan: { delete: { id: v.id, name: v.name, object: v.object, shared: v.shared } } };
          return deleteView(ctx, id);
        });
      default:
        usage(`Unknown views action "${action}".`, "Use list, create or delete.");
    }
  },
};

export const usersCommand: Command = {
  name: "users",
  usage: "users <list|add|role|disable> …",
  summary: `CRM users and roles (${USER_ROLES.join(", ")}): list, add, change role, disable / re-enable. Admin only for changes. (Firebase / git logins are created on that service.)`,
  subcommands: [
    { name: "list", usage: "users list [--all]", summary: "Users (--all includes disabled)." },
    { name: "add", usage: "users add --email <e> [--name <n>] [--role admin|member|viewer]", summary: "Add a user.", writes: true },
    { name: "role", usage: "users role <id|email> <admin|member|viewer>", summary: "Change a user's role.", writes: true },
    { name: "disable", usage: "users disable <id|email> [--enable]", summary: "Disable (or re-enable) a user.", writes: true },
  ],
  options: [SITE_OPTION, AS_OPTION, { name: "email", type: "string", description: "add: email." }, { name: "name", type: "string", description: "add: display name." }, { name: "role", type: "string", description: "add: role (default member)." }, { name: "all", type: "boolean", description: "list: include disabled users." }, { name: "enable", type: "boolean", description: "disable: re-enable instead." }],
  async run({ io, options, positionals }) {
    const [action = "list", ref, role] = positionals;
    const resolveUser = async (ctx: Parameters<typeof import("../../src/ops/users").listUsers>[0], r: string) => {
      const { listUsers } = await import("../../src/ops/users");
      const u = listUsers(ctx, { includeDisabled: true }).find((x) => x.id === r || x.email.toLowerCase() === r.toLowerCase());
      if (!u) usage(`No CRM user "${r}".`, "`agentcrm users list --all` lists them.");
      return u;
    };
    switch (action) {
      case "list":
        return withSession(io, options, {}, async ({ ctx }) => (await import("../../src/ops/users")).listUsers(ctx, { includeDisabled: boolOpt(options, "all") }), (us) => table(us as unknown as Record<string, unknown>[], ["id", "email", "name", "role", "disabled"]));
      case "add": {
        const r = (strOpt(options, "role") ?? "member") as UserRole;
        if (!USER_ROLES.includes(r)) usage(`--role must be one of ${USER_ROLES.join(", ")}.`);
        const input = { email: requireStr(options, "email"), name: strOpt(options, "name"), role: r };
        return withSession(io, options, { lock: true }, async ({ ctx }) => (await import("../../src/ops/users")).createUser(ctx, input));
      }
      case "role": {
        if (!ref || !role) usage("users role needs <id|email> <role>.");
        if (!USER_ROLES.includes(role as UserRole)) usage(`Role must be one of ${USER_ROLES.join(", ")}.`);
        return withSession(io, options, { lock: true }, async ({ ctx }) => (await import("../../src/ops/users")).setUserRole(ctx, (await resolveUser(ctx, ref)).id, role as UserRole));
      }
      case "disable": {
        const target = positional(positionals, 1, "user id or email", "users disable <id|email>");
        return withSession(io, options, { lock: true }, async ({ ctx }) => (await import("../../src/ops/users")).updateUser(ctx, (await resolveUser(ctx, target)).id, { disabled: !boolOpt(options, "enable") }));
      }
      default:
        usage(`Unknown users action "${action}".`, "Use list, add, role or disable.");
    }
  },
};

export const settingsCommand: Command = {
  name: "settings",
  usage: "settings <get|set> …",
  summary: "CRM settings (name, default currency, locale, timezone, week start, stale deal days).",
  subcommands: [
    { name: "get", usage: "settings get", summary: "Current settings." },
    { name: "set", usage: "settings set [--set key=value]… [--data <json>]", summary: "Change settings (admin).", writes: true },
  ],
  options: [SITE_OPTION, AS_OPTION, { name: "set", type: "string", description: "key=value (repeatable), e.g. --set staleDealDays=21 --set defaultCurrency=EUR.", multiple: true }, { name: "data", type: "string", description: "JSON object of settings, or @file." }],
  async run({ io, options, positionals }) {
    const [action = "get"] = positionals;
    if (action === "get") return withSession(io, options, {}, async ({ ctx }) => (await import("../../src/ops/settings")).getSettings(ctx));
    if (action === "set") {
      const patch = fieldsInput(options, "data");
      if (!Object.keys(patch).length) usage("settings set needs --set key=value or --data.");
      return withSession(io, options, { lock: true }, async ({ ctx }) => (await import("../../src/ops/settings")).updateSettings(ctx, patch));
    }
    usage(`Unknown settings action "${action}".`, "Use get or set.");
  },
};
