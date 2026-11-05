// CRM users and roles. On the local & journal backends users are plain
// records of who's who (assignees, owners) — identity is the browser /
// CLI; Firebase and git-json map their signed-in identity onto these.

import { newId } from "../core/ids";
import { USER_ROLES, type CrmUser, type UserPrefs, type UserRole, type ViewPrefs } from "../core/types";
import { normalizeEmail } from "../core/fields";
import { assertCan, OpsError, type OpsContext } from "./context";
import { asDoc, userOf, usersOf } from "./store";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function listUsers(ctx: OpsContext, opts: { includeDisabled?: boolean } = {}): CrmUser[] {
  assertCan(ctx, "users.read");
  return usersOf(ctx.store)
    .filter((u) => opts.includeDisabled !== false || !u.disabled)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getUser(ctx: OpsContext, id: string): CrmUser {
  assertCan(ctx, "users.read");
  const u = userOf(ctx.store, id);
  if (!u) throw new OpsError("notFound", `User "${id}" not found.`);
  return u;
}

export function findUserByEmail(ctx: OpsContext, email: string): CrmUser | undefined {
  const e = normalizeEmail(email);
  return usersOf(ctx.store).find((u) => normalizeEmail(u.email) === e);
}

export interface UserInput {
  id?: string;
  email: string;
  name?: string;
  role?: UserRole;
  avatarUrl?: string;
}

function activeAdmins(ctx: OpsContext): CrmUser[] {
  return usersOf(ctx.store).filter((u) => u.role === "admin" && !u.disabled);
}

export async function createUser(ctx: OpsContext, input: UserInput): Promise<CrmUser> {
  assertCan(ctx, "users.write");
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email)) throw new OpsError("validation", `"${input.email}" is not a valid email address.`);
  if (findUserByEmail(ctx, email)) throw new OpsError("conflict", `A user with email ${email} already exists.`);
  const role = input.role ?? "member";
  if (!USER_ROLES.includes(role)) throw new OpsError("validation", `Unknown role "${role}".`);
  const id = input.id ?? newId(ctx.now());
  if (userOf(ctx.store, id)) throw new OpsError("conflict", `User "${id}" already exists.`);
  const user: CrmUser = { id, email, name: input.name?.trim() || email.split("@")[0], role, ...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}) };
  await ctx.store.write([{ op: "set", collection: "users", doc: asDoc(user) }], { message: `Add user ${email}` });
  return getUser(ctx, id);
}

export async function updateUser(ctx: OpsContext, id: string, patch: Partial<Omit<CrmUser, "id">>): Promise<CrmUser> {
  const before = getUser(ctx, id);
  const self = ctx.user?.id === id;
  const adminOnly = patch.role !== undefined || patch.disabled !== undefined || patch.email !== undefined;
  // Anyone may edit their own name / avatar.
  if (!self || adminOnly) assertCan(ctx, "users.write");
  const fields: Record<string, unknown> = {};
  if (patch.name !== undefined) fields.name = patch.name.trim() || before.name;
  if (patch.avatarUrl !== undefined) fields.avatarUrl = patch.avatarUrl || undefined;
  if (patch.email !== undefined) {
    const email = normalizeEmail(patch.email);
    if (!EMAIL_RE.test(email)) throw new OpsError("validation", `"${patch.email}" is not a valid email address.`);
    const other = findUserByEmail(ctx, email);
    if (other && other.id !== id) throw new OpsError("conflict", `A user with email ${email} already exists.`);
    fields.email = email;
  }
  if (patch.role !== undefined) {
    if (!USER_ROLES.includes(patch.role)) throw new OpsError("validation", `Unknown role "${patch.role}".`);
    fields.role = patch.role;
  }
  if (patch.disabled !== undefined) fields.disabled = patch.disabled || undefined;
  const losesAdmin = before.role === "admin" && !before.disabled && ((fields.role && fields.role !== "admin") || fields.disabled);
  if (losesAdmin && activeAdmins(ctx).length <= 1) throw new OpsError("invalid", "The CRM needs at least one active admin.");
  await ctx.store.write([{ op: "patch", collection: "users", id, fields }], { message: `Update user ${before.email}` });
  return getUser(ctx, id);
}

// Size cap of a user's prefs (one Firestore document holds 1 MiB): the
// oldest view layouts are dropped beyond it.
export const PREFS_MAX_BYTES = 64 * 1024;
const PREF_KEY = /^[A-Za-z0-9_-]{1,120}$/;

export interface UserPrefsPatch {
  // A view's layout; null removes it.
  views?: Record<string, ViewPrefs | null>;
  // Last view opened per object.
  lastView?: Record<string, { id: string; at: number }>;
}

// The signed-in user's own interface preferences (any role: they only
// change how the CRM looks to them). Merged per view / per object.
export async function setUserPrefs(ctx: OpsContext, patch: UserPrefsPatch): Promise<UserPrefs> {
  const id = ctx.user?.id;
  const before = id ? userOf(ctx.store, id) : undefined;
  if (!id || !before) throw new OpsError("notFound", "Preferences are kept for CRM users only.");
  const fields: Record<string, unknown> = {};
  const next: UserPrefs = { views: { ...(before.prefs?.views ?? {}) }, lastView: { ...(before.prefs?.lastView ?? {}) } };
  for (const [viewId, value] of Object.entries(patch.views ?? {})) {
    if (!PREF_KEY.test(viewId)) throw new OpsError("validation", `Invalid view id "${viewId}".`);
    if (value && typeof value.at !== "number") throw new OpsError("validation", "A view layout needs `at`.");
    fields[`prefs.views.${viewId}`] = value ?? undefined;
    if (value) next.views![viewId] = value;
    else delete next.views![viewId];
  }
  for (const [objectId, value] of Object.entries(patch.lastView ?? {})) {
    if (!PREF_KEY.test(objectId) || !PREF_KEY.test(value?.id ?? "")) throw new OpsError("validation", `Invalid last view for "${objectId}".`);
    fields[`prefs.lastView.${objectId}`] = value;
    next.lastView![objectId] = value;
  }
  // Over the cap: drop the least recently changed view layouts.
  const byAge = Object.entries(next.views!).sort((a, b) => a[1].at - b[1].at);
  while (JSON.stringify(next).length > PREFS_MAX_BYTES && byAge.length) {
    const [oldest] = byAge.shift()!;
    delete next.views![oldest];
    fields[`prefs.views.${oldest}`] = undefined;
  }
  if (!Object.keys(fields).length) return before.prefs ?? {};
  if (!before.prefs) {
    // Dot paths need the parent object on every backend: create it whole.
    for (const k of Object.keys(fields)) delete fields[k];
    fields.prefs = next;
  }
  await ctx.store.write([{ op: "patch", collection: "users", id, fields }], { message: `Update ${before.email}'s preferences` });
  return next;
}

export function setUserRole(ctx: OpsContext, id: string, role: UserRole): Promise<CrmUser> {
  return updateUser(ctx, id, { role });
}

export async function deleteUser(ctx: OpsContext, id: string, opts: { reassignTo?: string } = {}): Promise<{ id: string; reassigned: number }> {
  assertCan(ctx, "users.write");
  const user = getUser(ctx, id);
  if (user.role === "admin" && !user.disabled && activeAdmins(ctx).length <= 1) throw new OpsError("invalid", "The CRM needs at least one active admin.");
  if (opts.reassignTo) getUser(ctx, opts.reassignTo);
  const mutations: import("../data/types").DocMutation[] = [{ op: "delete", collection: "users", id }];
  let reassigned = 0;
  for (const r of ctx.store.list("records")) {
    if (r.ownerId === id) {
      reassigned++;
      mutations.push({ op: "patch", collection: "records", id: r.id, fields: { ownerId: opts.reassignTo } });
    }
  }
  for (const a of ctx.store.list("activities")) {
    if (a.assigneeId === id) mutations.push({ op: "patch", collection: "activities", id: a.id, fields: { assigneeId: opts.reassignTo } });
  }
  await ctx.store.write(mutations, { message: `Remove user ${user.email}` });
  return { id, reassigned };
}
