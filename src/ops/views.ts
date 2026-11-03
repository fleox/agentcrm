// Saved views (table / kanban) per object. Shared views are managed by
// admins; members create their own (shared: false, ownerId = them).

import { newId } from "../core/ids";
import { FILTER_OPS, type Filter, type Sort, type ViewDef } from "../core/types";
import { can, assertCan, OpsError, type OpsContext } from "./context";
import { listRecords, type ListRecordsOptions } from "./records";
import { asDoc, pipelinesOf, requireObject, thaw, viewsOf } from "./store";

export function listViews(ctx: OpsContext, objectId?: string): ViewDef[] {
  assertCan(ctx, "views.read");
  const uid = ctx.user?.id;
  return viewsOf(ctx.store, objectId).filter((v) => v.shared || !v.ownerId || v.ownerId === uid || ctx.user === null);
}

export function getView(ctx: OpsContext, id: string): ViewDef {
  assertCan(ctx, "views.read");
  const v = ctx.store.get("views", id) as unknown as ViewDef | undefined;
  if (!v) throw new OpsError("notFound", `View "${id}" not found.`);
  return v;
}

function assertCanWrite(ctx: OpsContext, view: Pick<ViewDef, "shared" | "ownerId">): void {
  if (view.shared) return assertCan(ctx, "views.writeShared");
  assertCan(ctx, "views.writeOwn");
  if (ctx.user && view.ownerId && view.ownerId !== ctx.user.id && !can(ctx.user, "views.writeShared")) {
    throw new OpsError("forbidden", "This view belongs to another user.");
  }
}

function validateView(ctx: OpsContext, v: ViewDef): void {
  const object = requireObject(ctx.store, v.object);
  if (!v.name.trim()) throw new OpsError("validation", "A view needs a name.");
  if (v.type !== "table" && v.type !== "kanban") throw new OpsError("validation", `Unknown view type "${v.type}".`);
  for (const f of v.filters) if (!FILTER_OPS.includes(f.op)) throw new OpsError("validation", `Unknown filter operator "${f.op}".`);
  for (const s of v.sorts) if (s.dir !== "asc" && s.dir !== "desc") throw new OpsError("validation", `Sort direction must be asc or desc.`);
  if (v.type === "kanban") {
    const group = object.fields.find((f) => f.id === v.groupBy);
    if (!group || !["select", "user", "boolean"].includes(group.type)) throw new OpsError("validation", "A kanban view groups by a select, user or checkbox field.");
    if (v.pipelineId && !pipelinesOf(ctx.store, v.object).some((p) => p.id === v.pipelineId)) throw new OpsError("validation", `Unknown pipeline "${v.pipelineId}".`);
  }
}

export interface ViewInput {
  object: string;
  name: string;
  type?: ViewDef["type"];
  columns?: string[];
  filters?: Filter[];
  sorts?: Sort[];
  groupBy?: string;
  pipelineId?: string;
  shared?: boolean;
}

export async function createView(ctx: OpsContext, input: ViewInput): Promise<ViewDef> {
  const object = requireObject(ctx.store, input.object);
  const view: ViewDef = {
    id: newId(ctx.now()),
    object: object.id,
    name: input.name?.trim() ?? "",
    type: input.type ?? "table",
    columns: input.columns ?? object.fields.filter((f) => !f.hidden).slice(0, 6).map((f) => f.id),
    filters: input.filters ?? [],
    sorts: input.sorts ?? [],
    ...(input.groupBy ? { groupBy: input.groupBy } : {}),
    ...(input.pipelineId ? { pipelineId: input.pipelineId } : {}),
    shared: !!input.shared,
    ...(!input.shared && ctx.user ? { ownerId: ctx.user.id } : {}),
  };
  assertCanWrite(ctx, view);
  validateView(ctx, view);
  await ctx.store.write([{ op: "set", collection: "views", doc: asDoc(view) }], { message: `Create view ${view.name}` });
  return getView(ctx, view.id);
}

export async function updateView(ctx: OpsContext, id: string, patch: Partial<Omit<ViewInput, "object">>): Promise<ViewDef> {
  const before = getView(ctx, id);
  assertCanWrite(ctx, before);
  const next: ViewDef = { ...thaw(before), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as ViewDef;
  if (patch.shared !== undefined && patch.shared !== before.shared) assertCan(ctx, "views.writeShared");
  if (next.shared) delete next.ownerId;
  else if (!next.ownerId && ctx.user) next.ownerId = ctx.user.id;
  validateView(ctx, next);
  await ctx.store.write([{ op: "set", collection: "views", doc: asDoc(next) }], { message: `Update view ${next.name}` });
  return getView(ctx, id);
}

export async function duplicateView(ctx: OpsContext, id: string, name?: string): Promise<ViewDef> {
  const v = getView(ctx, id);
  return createView(ctx, { ...thaw(v), name: name ?? `${v.name} (copy)`, shared: false });
}

export async function deleteView(ctx: OpsContext, id: string): Promise<{ id: string }> {
  const v = getView(ctx, id);
  assertCanWrite(ctx, v);
  if (viewsOf(ctx.store, v.object).length <= 1) throw new OpsError("invalid", "An object keeps at least one view.");
  await ctx.store.write([{ op: "delete", collection: "views", id }], { message: `Delete view ${v.name}` });
  return { id };
}

// Records of a view (its filters + sorts, plus extra options).
export function runView(ctx: OpsContext, id: string, opts: Omit<ListRecordsOptions, "viewId"> = {}) {
  const v = getView(ctx, id);
  return listRecords(ctx, v.object, { ...opts, viewId: id });
}
