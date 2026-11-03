// OpsContext: what every op receives first. Roles are enforced here
// (assertCan) — the UI hides what a role can't do, but the rule lives in
// the engine so the CLI, MCP and the assistant obey it too.

import { plugins as defaultPlugins, type CrmActionName, type CrmActionPayloads, type PluginRegistry } from "../core/pluginRegistry";
import type { CrmUser, UserRole } from "../core/types";
import type { DataStore } from "../data/types";

export interface OpsContext {
  store: DataStore;
  // The acting user. `null` = system context (seed, CLI maintenance
  // scripts, automations engine): every permission granted.
  user: CrmUser | null;
  now(): number;
  log?: (msg: string) => void;
  // Plugin registry ops emit actions on (default: the process-wide one).
  plugins?: PluginRegistry;
  // Nesting depth of automation-triggered writes (the engine stops
  // re-triggering past a limit to avoid loops).
  depth?: number;
}

export type OpsAction =
  | "records.read"
  | "records.write"
  | "records.delete"
  | "activities.read"
  | "activities.write"
  | "views.read"
  | "views.writeOwn"
  | "views.writeShared"
  | "schema.write"
  | "pipelines.write"
  | "settings.read"
  | "settings.write"
  | "users.read"
  | "users.write"
  | "automations.write"
  | "automations.run"
  | "forms.write"
  | "import"
  | "export"
  | "reports.read"
  | "compact";

const READ: OpsAction[] = ["records.read", "activities.read", "views.read", "settings.read", "users.read", "reports.read"];
const MEMBER: OpsAction[] = [...READ, "records.write", "records.delete", "activities.write", "views.writeOwn", "import", "export", "automations.run"];
const ADMIN: OpsAction[] = [
  ...MEMBER,
  "views.writeShared",
  "schema.write",
  "pipelines.write",
  "settings.write",
  "users.write",
  "automations.write",
  "forms.write",
  "compact",
];

export const PERMISSIONS: Record<UserRole, ReadonlySet<OpsAction>> = {
  admin: new Set(ADMIN),
  member: new Set(MEMBER),
  viewer: new Set(READ),
};

export type OpsErrorCode = "forbidden" | "notFound" | "validation" | "conflict" | "invalid";

export class OpsError extends Error {
  constructor(
    readonly code: OpsErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "OpsError";
  }
}

export function can(user: CrmUser | null, action: OpsAction): boolean {
  if (user === null) return true;
  if (user.disabled) return false;
  return PERMISSIONS[user.role]?.has(action) ?? false;
}

export function assertCan(ctx: Pick<OpsContext, "user">, action: OpsAction): void {
  if (!can(ctx.user, action)) {
    const who = ctx.user ? `${ctx.user.email || ctx.user.name} (${ctx.user.disabled ? "disabled" : ctx.user.role})` : "anonymous";
    throw new OpsError("forbidden", `Not allowed: ${who} can't ${action.replace(".", " ")}.`);
  }
}

export function createOpsContext(store: DataStore, user: CrmUser | null, opts: Partial<Omit<OpsContext, "store" | "user">> = {}): OpsContext {
  return { store, user, now: opts.now ?? Date.now, log: opts.log, plugins: opts.plugins, depth: opts.depth };
}

// Emits a typed CRM action on the context's registry. Awaited, but a
// failing subscriber never fails the op (the registry isolates errors).
export async function emit<K extends CrmActionName>(ctx: OpsContext, name: K, payload: CrmActionPayloads[K]): Promise<void> {
  await (ctx.plugins ?? defaultPlugins).doAction(name, ctx, payload);
}

export function actorId(ctx: OpsContext): string | undefined {
  return ctx.user?.id;
}
