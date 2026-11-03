// Data model: objects and fields CRUD, select options, type changes with
// data migration. Rules:
//   - `system` fields can't be deleted, retyped or have their id changed;
//   - `standard` fields can't be deleted (hide them instead);
//   - standard objects can't be deleted;
//   - stage / pipeline select options are owned by ops/pipelines.ts.

import { camelId } from "../shared/lib/utils";
import { canConvertType, colorAt, convertValue, isEmptyFieldValue } from "../core/fields";
import { slugId } from "../core/ids";
import { defaultViewFor } from "../core/schema/standardObjects";
import { FIELD_TYPES, type FieldDef, type FieldType, type ObjectDef, type SelectOption } from "../core/types";
import type { DocMutation } from "../data/types";
import { assertCan, OpsError, type OpsContext } from "./context";
import { hardDeleteMutations } from "./records";
import { asDoc, objectsOf, pipelinesOf, recordsOf, requireObject, thaw, viewsOf } from "./store";

export function listObjects(ctx: OpsContext): ObjectDef[] {
  assertCan(ctx, "records.read");
  return objectsOf(ctx.store);
}

export function getObject(ctx: OpsContext, id: string): ObjectDef {
  assertCan(ctx, "records.read");
  return requireObject(ctx.store, id);
}

// Compact, model-friendly description of the schema (AI tools, CLI).
export function describeSchema(ctx: OpsContext, objectId?: string) {
  assertCan(ctx, "records.read");
  const objects = objectId ? [requireObject(ctx.store, objectId)] : objectsOf(ctx.store);
  return objects.map((o) => ({
    id: o.id,
    label: o.labelPlural,
    singular: o.labelSingular,
    labelField: o.labelField,
    ...(o.imageField ? { imageField: o.imageField } : {}),
    standard: o.standard,
    count: recordsOf(ctx.store, o.id).length,
    fields: o.fields.map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      ...(f.required ? { required: true } : {}),
      ...(f.unique ? { unique: true } : {}),
      ...(f.system ? { system: true } : {}),
      ...(f.hidden ? { hidden: true } : {}),
      ...(f.options ? { options: f.options.map((x) => ({ id: x.id, label: x.label })) } : {}),
      ...(f.relation ? { relation: f.relation } : {}),
      ...(f.currency ? { currency: f.currency } : {}),
    })),
    pipelines: pipelinesOf(ctx.store, o.id).map((p) => ({ id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, label: s.label, kind: s.kind, probability: s.probability })) })),
  }));
}

function saveObject(ctx: OpsContext, object: ObjectDef): DocMutation {
  return { op: "set", collection: "objects", doc: asDoc({ ...object, updatedAt: ctx.now() }) };
}

export interface ObjectInput {
  id?: string;
  labelSingular: string;
  labelPlural: string;
  icon?: string;
  color?: string;
  fields?: FieldInput[];
}

export async function createObject(ctx: OpsContext, input: ObjectInput): Promise<ObjectDef> {
  assertCan(ctx, "schema.write");
  const singular = input.labelSingular?.trim();
  const plural = input.labelPlural?.trim() || (singular ? `${singular}s` : "");
  if (!singular) throw new OpsError("validation", "An object needs a name.");
  const taken = objectsOf(ctx.store).map((o) => o.id);
  const id = input.id ? input.id : slugId(plural, taken);
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(id)) throw new OpsError("validation", `Invalid object id "${id}" (lower-case letters, digits, dashes).`);
  if (taken.includes(id)) throw new OpsError("conflict", `Object "${id}" already exists.`);
  const now = ctx.now();
  let object: ObjectDef = {
    id,
    labelSingular: singular,
    labelPlural: plural,
    icon: input.icon ?? "Box",
    color: input.color ?? colorAt(taken.length + 3),
    standard: false,
    labelField: "name",
    fields: [{ id: "name", label: "Name", type: "text", required: true, system: true }],
    createdAt: now,
    updatedAt: now,
  };
  for (const f of input.fields ?? []) object = { ...object, fields: [...object.fields, buildField(ctx, object, f)] };
  const view = defaultViewFor(object);
  await ctx.store.write(
    [
      { op: "set", collection: "objects", doc: asDoc(object) },
      ...(ctx.store.get("views", view.id) ? [] : [{ op: "set" as const, collection: "views" as const, doc: asDoc(view) }]),
    ],
    { message: `Create object ${plural}` },
  );
  return requireObject(ctx.store, id);
}

export async function updateObject(
  ctx: OpsContext,
  id: string,
  patch: Partial<Pick<ObjectDef, "labelSingular" | "labelPlural" | "icon" | "color" | "labelField">> & { imageField?: string | null },
): Promise<ObjectDef> {
  assertCan(ctx, "schema.write");
  const object = thaw(requireObject(ctx.store, id));
  if (patch.labelSingular !== undefined) object.labelSingular = patch.labelSingular.trim() || object.labelSingular;
  if (patch.labelPlural !== undefined) object.labelPlural = patch.labelPlural.trim() || object.labelPlural;
  if (patch.icon !== undefined) object.icon = patch.icon;
  if (patch.color !== undefined) object.color = patch.color;
  if (patch.labelField !== undefined) {
    const f = object.fields.find((x) => x.id === patch.labelField);
    if (!f || !["text", "email", "url", "phone"].includes(f.type)) throw new OpsError("validation", `"${patch.labelField}" can't be the label field (needs a text field).`);
    object.labelField = patch.labelField;
  }
  if (patch.imageField !== undefined) {
    if (patch.imageField === null || patch.imageField === "") delete object.imageField;
    else {
      const f = object.fields.find((x) => x.id === patch.imageField);
      if (!f || f.type !== "image") throw new OpsError("validation", `"${patch.imageField}" can't be the image field (needs an image field).`);
      object.imageField = patch.imageField;
    }
  }
  await ctx.store.write([saveObject(ctx, object)], { message: `Update object ${object.labelPlural}` });
  return requireObject(ctx.store, id);
}

// Deletes a custom object, all its records (hard), its views, and every
// relation field of other objects pointing at it.
export async function deleteObject(ctx: OpsContext, id: string): Promise<{ id: string; records: number }> {
  assertCan(ctx, "schema.write");
  const object = requireObject(ctx.store, id);
  if (object.standard) throw new OpsError("invalid", `${object.labelPlural} is a standard object and can't be deleted.`);
  if (pipelinesOf(ctx.store, id).length) throw new OpsError("invalid", `Delete the pipelines of ${object.labelPlural} first.`);
  const records = recordsOf(ctx.store, id, { includeDeleted: true });
  const mutations: DocMutation[] = [{ op: "delete", collection: "objects", id }, ...hardDeleteMutations(ctx, records.map((r) => r.id))];
  for (const v of viewsOf(ctx.store, id)) mutations.push({ op: "delete", collection: "views", id: v.id });
  for (const other of objectsOf(ctx.store)) {
    if (other.id === id) continue;
    const kept = other.fields.filter((f) => !(f.type === "relation" && f.relation?.object === id));
    if (kept.length !== other.fields.length) {
      mutations.push(saveObject(ctx, { ...other, fields: kept }));
      for (const f of other.fields.filter((x) => !kept.includes(x))) mutations.push(...clearFieldValues(ctx, other.id, f.id));
    }
  }
  await ctx.store.write(dedupeMutations(mutations), { message: `Delete object ${object.labelPlural}` });
  return { id, records: records.length };
}

// Later mutations on the same doc win; deletes absorb patches.
function dedupeMutations(mutations: DocMutation[]): DocMutation[] {
  const deleted = new Set(mutations.filter((m) => m.op === "delete").map((m) => `${m.collection}/${m.id}`));
  return mutations.filter((m) => m.op === "delete" || !deleted.has(`${m.collection}/${m.op === "set" ? m.doc.id : m.id}`));
}

// ─── Fields ─────────────────────────────────────────────────────────────

export interface FieldInput {
  id?: string;
  label: string;
  type: FieldType;
  description?: string;
  required?: boolean;
  unique?: boolean;
  hidden?: boolean;
  // Labels or full options.
  options?: Array<string | Partial<SelectOption>>;
  currency?: string;
  relation?: FieldDef["relation"];
  defaultValue?: unknown;
}

function buildOptions(input: Array<string | Partial<SelectOption>> | undefined, existing: SelectOption[] = []): SelectOption[] {
  const out: SelectOption[] = [];
  (input ?? []).forEach((o, i) => {
    const label = (typeof o === "string" ? o : o.label ?? "").trim();
    if (!label) return;
    const wanted = typeof o === "string" ? undefined : o.id;
    const prev = existing.find((e) => e.id === wanted) ?? existing.find((e) => e.label.toLowerCase() === label.toLowerCase());
    const id = prev?.id ?? (wanted && !out.some((x) => x.id === wanted) ? wanted : slugId(label, out.map((x) => x.id)));
    out.push({ id, label, color: (typeof o === "string" ? undefined : o.color) ?? prev?.color ?? colorAt(i) });
  });
  return out;
}

function buildField(ctx: OpsContext, object: ObjectDef, input: FieldInput): FieldDef {
  const label = input.label?.trim();
  if (!label) throw new OpsError("validation", "A field needs a label.");
  if (!FIELD_TYPES.includes(input.type)) throw new OpsError("validation", `Unknown field type "${input.type}". Types: ${FIELD_TYPES.join(", ")}.`);
  const taken = new Set(object.fields.map((f) => f.id));
  let id = input.id ?? camelId(label);
  if (!id) id = "field";
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(id)) throw new OpsError("validation", `Invalid field id "${id}".`);
  if (input.id && taken.has(id)) throw new OpsError("conflict", `Field "${id}" already exists on ${object.labelPlural}.`);
  if (["id", "object", "ownerId", "createdAt", "updatedAt", "createdBy", "updatedBy", "deletedAt"].includes(id)) id = `${id}Field`;
  for (let i = 2; taken.has(id); i++) id = `${camelId(label) || "field"}${i}`;
  const field: FieldDef = { id, label, type: input.type };
  if (input.description) field.description = input.description;
  if (input.required) field.required = true;
  if (input.unique) field.unique = true;
  if (input.hidden) field.hidden = true;
  if (input.type === "select" || input.type === "multiSelect") field.options = buildOptions(input.options);
  if (input.type === "currency") field.currency = (input.currency ?? "USD").toUpperCase();
  if (input.type === "relation") {
    const rel = input.relation;
    if (!rel?.object) throw new OpsError("validation", "A relation field needs a target object.");
    requireObject(ctx.store, rel.object);
    field.relation = { object: rel.object, cardinality: rel.cardinality === "many" ? "many" : "one", ...(rel.inverseField ? { inverseField: rel.inverseField } : {}) };
  }
  if (input.defaultValue !== undefined) field.defaultValue = input.defaultValue;
  return field;
}

export async function createField(ctx: OpsContext, objectId: string, input: FieldInput): Promise<FieldDef> {
  assertCan(ctx, "schema.write");
  const object = requireObject(ctx.store, objectId);
  const field = buildField(ctx, object, input);
  // The first image field of an object becomes its record avatar.
  const imageField = object.imageField ?? (field.type === "image" ? field.id : undefined);
  const mutations: DocMutation[] = [saveObject(ctx, { ...object, ...(imageField ? { imageField } : {}), fields: [...object.fields, field] })];
  // A new visible field becomes a column of the object's default table view
  // while it has room (same 7-column rule as defaultViewFor): a custom object
  // created with only its Name field shows the fields added next.
  const defaultView = viewsOf(ctx.store, objectId).find((v) => v.id === defaultViewFor(object).id);
  if (defaultView && defaultView.type === "table" && !field.hidden && field.type !== "image" && !defaultView.columns.includes(field.id) && defaultView.columns.length < DEFAULT_VIEW_MAX_COLUMNS) {
    mutations.push({ op: "patch", collection: "views", id: defaultView.id, fields: { columns: [...defaultView.columns, field.id] } });
  }
  await ctx.store.write(mutations, { message: `Add field ${field.label}` });
  return field;
}

const DEFAULT_VIEW_MAX_COLUMNS = 7;

function requireField(object: ObjectDef, fieldId: string): FieldDef {
  const f = object.fields.find((x) => x.id === fieldId);
  if (!f) throw new OpsError("notFound", `Field "${fieldId}" not found on ${object.labelPlural}.`);
  return f;
}

function isPipelineManaged(ctx: OpsContext, objectId: string, fieldId: string): boolean {
  const pipelines = pipelinesOf(ctx.store, objectId);
  return pipelines.some((p) => p.stageField === fieldId) || (fieldId === "pipeline" && pipelines.length > 0);
}

export interface FieldPatch {
  label?: string;
  description?: string;
  required?: boolean;
  unique?: boolean;
  hidden?: boolean;
  options?: Array<string | Partial<SelectOption>>;
  currency?: string;
  defaultValue?: unknown;
  type?: FieldType;
}

export interface FieldUpdateResult {
  field: FieldDef;
  // Type change migration report.
  converted?: number;
  cleared?: number;
}

export async function updateField(ctx: OpsContext, objectId: string, fieldId: string, patch: FieldPatch): Promise<FieldUpdateResult> {
  assertCan(ctx, "schema.write");
  const object = requireObject(ctx.store, objectId);
  const before = requireField(object, fieldId);
  let field: FieldDef = thaw(before);
  if (patch.label !== undefined) {
    if (!patch.label.trim()) throw new OpsError("validation", "A field needs a label.");
    field.label = patch.label.trim();
  }
  if (patch.description !== undefined) field.description = patch.description || undefined;
  if (patch.required !== undefined) field.required = patch.required || undefined;
  if (patch.unique !== undefined) field.unique = patch.unique || undefined;
  if (patch.hidden !== undefined) {
    if (patch.hidden && fieldId === object.labelField) throw new OpsError("invalid", "The label field can't be hidden.");
    field.hidden = patch.hidden || undefined;
  }
  if (patch.currency !== undefined) field.currency = patch.currency.toUpperCase();
  if (patch.defaultValue !== undefined) field.defaultValue = patch.defaultValue;

  const mutations: DocMutation[] = [];
  let converted: number | undefined;
  let cleared: number | undefined;

  if (patch.type !== undefined && patch.type !== before.type) {
    if (before.system || isPipelineManaged(ctx, objectId, fieldId)) throw new OpsError("invalid", `${before.label} is a system field: its type can't change.`);
    if (!FIELD_TYPES.includes(patch.type)) throw new OpsError("validation", `Unknown field type "${patch.type}".`);
    if (!canConvertType(before.type, patch.type)) throw new OpsError("invalid", `Can't convert ${before.type} to ${patch.type}.`);
    field = { ...field, type: patch.type };
    if (patch.type === "select" || patch.type === "multiSelect") {
      // Build options from the existing distinct values when none given.
      if (!patch.options && !field.options?.length) {
        const values = new Set<string>();
        for (const r of recordsOf(ctx.store, objectId, { includeDeleted: true })) {
          const v = r.fields[fieldId];
          for (const x of Array.isArray(v) ? v : [v]) if (x !== undefined && x !== null && String(x).trim()) values.add(before.type === "select" || before.type === "multiSelect" ? before.options?.find((o) => o.id === x)?.label ?? String(x) : String(x).trim());
        }
        field.options = buildOptions([...values].slice(0, 200));
      }
    } else {
      delete field.options;
    }
    if (patch.type === "currency") field.currency = field.currency ?? "USD";
    if (patch.type !== "relation") delete field.relation;
    converted = 0;
    cleared = 0;
    const migrateTo: FieldDef = patch.options ? { ...field, options: buildOptions(patch.options, field.options) } : field;
    for (const r of recordsOf(ctx.store, objectId, { includeDeleted: true })) {
      const v = r.fields[fieldId];
      if (isEmptyFieldValue(before, v)) continue;
      const next = convertValue(before, migrateTo, v);
      if (next === undefined) cleared++;
      else converted++;
      mutations.push({ op: "patch", collection: "records", id: r.id, fields: { [`fields.${fieldId}`]: next } });
    }
  }

  if (patch.options !== undefined) {
    if (isPipelineManaged(ctx, objectId, fieldId)) throw new OpsError("invalid", `${before.label} options mirror the pipelines — edit the pipeline stages instead.`);
    if (field.type !== "select" && field.type !== "multiSelect") throw new OpsError("invalid", `${field.label} has no options.`);
    const nextOptions = buildOptions(patch.options, before.options);
    const kept = new Set(nextOptions.map((o) => o.id));
    // Values of removed options are cleared.
    if (before.type === field.type) {
      for (const r of recordsOf(ctx.store, objectId, { includeDeleted: true })) {
        const v = r.fields[fieldId];
        if (field.type === "select" && typeof v === "string" && !kept.has(v)) mutations.push({ op: "patch", collection: "records", id: r.id, fields: { [`fields.${fieldId}`]: undefined } });
        if (field.type === "multiSelect" && Array.isArray(v) && v.some((x) => !kept.has(x))) {
          const rest = v.filter((x) => kept.has(x));
          mutations.push({ op: "patch", collection: "records", id: r.id, fields: { [`fields.${fieldId}`]: rest.length ? rest : undefined } });
        }
      }
    }
    field.options = nextOptions;
  }

  const fields = object.fields.map((f) => (f.id === fieldId ? field : f));
  const nextObject: ObjectDef = { ...object, fields };
  // The record image must stay an image field.
  if (object.imageField === fieldId && field.type !== "image") delete nextObject.imageField;
  mutations.unshift(saveObject(ctx, nextObject));
  await ctx.store.write(mutations, { message: `Update field ${field.label}` });
  return { field: requireField(requireObject(ctx.store, objectId), fieldId), ...(converted !== undefined ? { converted, cleared } : {}) };
}

export function changeFieldType(ctx: OpsContext, objectId: string, fieldId: string, type: FieldType, options?: FieldPatch["options"]): Promise<FieldUpdateResult> {
  return updateField(ctx, objectId, fieldId, { type, ...(options ? { options } : {}) });
}

function clearFieldValues(ctx: OpsContext, objectId: string, fieldId: string): DocMutation[] {
  return recordsOf(ctx.store, objectId, { includeDeleted: true })
    .filter((r) => r.fields[fieldId] !== undefined)
    .map((r) => ({ op: "patch" as const, collection: "records" as const, id: r.id, fields: { [`fields.${fieldId}`]: undefined } }));
}

export async function deleteField(ctx: OpsContext, objectId: string, fieldId: string): Promise<{ id: string; cleared: number }> {
  assertCan(ctx, "schema.write");
  const object = requireObject(ctx.store, objectId);
  const field = requireField(object, fieldId);
  if (field.system) throw new OpsError("invalid", `${field.label} is a system field and can't be deleted.`);
  if (field.standard) throw new OpsError("invalid", `${field.label} is a standard field: hide it instead of deleting it.`);
  if (fieldId === object.labelField) throw new OpsError("invalid", "The label field can't be deleted.");
  if (isPipelineManaged(ctx, objectId, fieldId)) throw new OpsError("invalid", `${field.label} holds pipeline stages.`);
  const clears = clearFieldValues(ctx, objectId, fieldId);
  const rest: ObjectDef = { ...object, fields: object.fields.filter((f) => f.id !== fieldId) };
  if (rest.imageField === fieldId) delete rest.imageField;
  const mutations: DocMutation[] = [saveObject(ctx, rest), ...clears];
  for (const v of viewsOf(ctx.store, objectId)) {
    const usesField = v.columns.includes(fieldId) || v.filters.some((f) => f.field === fieldId) || v.sorts.some((s) => s.field === fieldId) || v.groupBy === fieldId;
    if (!usesField) continue;
    mutations.push({
      op: "patch",
      collection: "views",
      id: v.id,
      fields: {
        columns: v.columns.filter((c) => c !== fieldId),
        filters: v.filters.filter((f) => f.field !== fieldId),
        sorts: v.sorts.filter((s) => s.field !== fieldId),
        groupBy: v.groupBy === fieldId ? undefined : v.groupBy,
      },
    });
  }
  await ctx.store.write(mutations, { message: `Delete field ${field.label}` });
  return { id: fieldId, cleared: clears.length };
}

// Reorders fields (ids not listed keep their relative order at the end).
export async function reorderFields(ctx: OpsContext, objectId: string, order: string[]): Promise<ObjectDef> {
  assertCan(ctx, "schema.write");
  const object = requireObject(ctx.store, objectId);
  const pos = new Map(order.map((id, i) => [id, i]));
  const fields = [...object.fields].sort((a, b) => (pos.get(a.id) ?? 1e6 + object.fields.indexOf(a)) - (pos.get(b.id) ?? 1e6 + object.fields.indexOf(b)));
  await ctx.store.write([saveObject(ctx, { ...object, fields })], { message: "Reorder fields" });
  return requireObject(ctx.store, objectId);
}

// ─── Options ────────────────────────────────────────────────────────────

export async function addOption(ctx: OpsContext, objectId: string, fieldId: string, option: { label: string; color?: string; id?: string }): Promise<SelectOption> {
  const field = requireField(requireObject(ctx.store, objectId), fieldId);
  const res = await updateField(ctx, objectId, fieldId, { options: [...(field.options ?? []), option] });
  return res.field.options![res.field.options!.length - 1];
}

export async function updateOption(ctx: OpsContext, objectId: string, fieldId: string, optionId: string, patch: { label?: string; color?: string }): Promise<SelectOption> {
  const field = requireField(requireObject(ctx.store, objectId), fieldId);
  if (!field.options?.some((o) => o.id === optionId)) throw new OpsError("notFound", `Option "${optionId}" not found on ${field.label}.`);
  const res = await updateField(ctx, objectId, fieldId, { options: field.options.map((o) => (o.id === optionId ? { ...o, ...patch } : o)) });
  return res.field.options!.find((o) => o.id === optionId)!;
}

// Removes an option; records using it move to `replaceWith` (or are cleared).
export async function removeOption(ctx: OpsContext, objectId: string, fieldId: string, optionId: string, opts: { replaceWith?: string } = {}): Promise<{ moved: number }> {
  assertCan(ctx, "schema.write");
  const object = requireObject(ctx.store, objectId);
  const field = requireField(object, fieldId);
  if (isPipelineManaged(ctx, objectId, fieldId)) throw new OpsError("invalid", `${field.label} options mirror the pipelines — edit the pipeline stages instead.`);
  if (!field.options?.some((o) => o.id === optionId)) throw new OpsError("notFound", `Option "${optionId}" not found on ${field.label}.`);
  if (opts.replaceWith && !field.options.some((o) => o.id === opts.replaceWith && o.id !== optionId)) throw new OpsError("validation", `Unknown replacement option "${opts.replaceWith}".`);
  const mutations: DocMutation[] = [saveObject(ctx, { ...object, fields: object.fields.map((f) => (f.id === fieldId ? { ...f, options: f.options!.filter((o) => o.id !== optionId) } : f)) })];
  let moved = 0;
  for (const r of recordsOf(ctx.store, objectId, { includeDeleted: true })) {
    const v = r.fields[fieldId];
    if (field.type === "select" && v === optionId) {
      moved++;
      mutations.push({ op: "patch", collection: "records", id: r.id, fields: { [`fields.${fieldId}`]: opts.replaceWith } });
    } else if (field.type === "multiSelect" && Array.isArray(v) && v.includes(optionId)) {
      moved++;
      const next = [...new Set(v.map((x) => (x === optionId ? opts.replaceWith : x)).filter(Boolean))];
      mutations.push({ op: "patch", collection: "records", id: r.id, fields: { [`fields.${fieldId}`]: next.length ? next : undefined } });
    }
  }
  await ctx.store.write(mutations, { message: `Remove option from ${field.label}` });
  return { moved };
}
