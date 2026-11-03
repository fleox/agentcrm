// CRM users and roles. On the local & journal backends users are plain
// records of who's who (assignees, owners) — identity is the browser /
// CLI; Firebase and git-json map their signed-in identity onto these.

import { newId } from "../core/ids";
import { USER_ROLES, type CrmUser, type UserRole } from "../core/types";
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
