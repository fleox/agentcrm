// Schema as code: brings the data model in line with a JSON description
// (objects + fields, pipelines, views), so a team keeps its CRM model in a
// repository and re-applies it after any change. Additive and idempotent:
// it creates what is missing and updates what differs, never deletes, never
// changes a field type (reported as a conflict) and never removes a select
// option (existing values point at option ids). Fields the CRM has but the
// description doesn't are reported, not touched.

import type { FieldDef, Filter, Sort, StageKind, ViewDef } from "../core/types";
import { assertCan, OpsError, type OpsContext } from "./context";
import { createPipeline, listPipelines, updatePipeline, type StageInput } from "./pipelines";
import { createField, createObject, listObjects, updateField, updateObject, type FieldInput, type FieldPatch } from "./schema";
import { createView, listViews, updateView } from "./views";

export interface ObjectSpec {
  id: string;
  labelSingular: string;
  labelPlural: string;
  icon?: string;
  color?: string;
  labelField?: string;
  // Field shown as the record avatar: an image field, or a URL field.
  imageField?: string;
  fields?: Array<FieldInput & { id: string }>;
}

export interface PipelineSpec {
  id: string;
  name: string;
  object: string;
  stageField?: string;
  stages: Array<StageInput & { id: string }>;
}

export interface ViewSpec {
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

export interface SchemaSpec {
  objects?: ObjectSpec[];
  pipelines?: PipelineSpec[];
  views?: ViewSpec[];
}

export interface SchemaChange {
  kind: "object" | "field" | "pipeline" | "view";
  action: "create" | "update";
  target: string;
  changes?: string[];
}

export interface SchemaApplyReport {
  changes: SchemaChange[];
  // Field type differences: never applied (`fields update --type` migrates values).
  conflicts: string[];
  // Custom fields in the CRM that the description doesn't list.
  extraFields: string[];
}

// Key order is not significant (Firestore returns map keys in its own order).
function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]));
  return v ?? null;
}
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

export function parseSchemaSpec(raw: unknown): SchemaSpec {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new OpsError("validation", "A schema is a JSON object with objects, pipelines and / or views.");
  const spec = raw as SchemaSpec;
  for (const o of spec.objects ?? []) {
    if (!o.id || !o.labelSingular || !o.labelPlural) throw new OpsError("validation", `Every object needs id, labelSingular and labelPlural (got ${JSON.stringify(o.id ?? o)}).`);
    for (const f of o.fields ?? []) if (!f.id || !f.label || !f.type) throw new OpsError("validation", `Every field of ${o.id} needs id, label and type.`);
  }
  for (const p of spec.pipelines ?? []) {
    if (!p.id || !p.name || !p.object || !p.stages?.length) throw new OpsError("validation", `Every pipeline needs id, name, object and stages (got ${JSON.stringify(p.id ?? p)}).`);
    for (const s of p.stages) if (!s.id || !s.label) throw new OpsError("validation", `Every stage of pipeline ${p.id} needs id and label.`);
  }
  for (const v of spec.views ?? []) if (!v.object || !v.name) throw new OpsError("validation", "Every view needs object and name.");
  return spec;
}

// Options to add: the spec's labels missing from the field (by label, case-insensitive).
function missingOptions(field: FieldDef, wanted: FieldInput["options"]): string[] {
  const have = new Set((field.options ?? []).map((o) => o.label.toLowerCase()));
  return (wanted ?? []).map((o) => (typeof o === "string" ? o : o.label ?? "")).filter((l) => l && !have.has(l.toLowerCase()));
}

function withoutDrilldown<F extends FieldInput>(f: F): Omit<F, "drilldown"> {
  const { drilldown: _drilldown, ...rest } = f;
  return rest;
}

function fieldPatch(field: FieldDef, spec: FieldInput): { patch: FieldPatch; changes: string[] } {
  const patch: FieldPatch = {};
  const changes: string[] = [];
  if (spec.label !== field.label) (patch.label = spec.label), changes.push("label");
  if (spec.description !== undefined && spec.description !== field.description) (patch.description = spec.description), changes.push("description");
  for (const k of ["required", "unique", "hidden"] as const) {
    if (spec[k] !== undefined && !!spec[k] !== !!field[k]) (patch[k] = spec[k]), changes.push(k);
  }
  if (spec.currency !== undefined && spec.currency !== field.currency) (patch.currency = spec.currency), changes.push("currency");
  const add = missingOptions(field, spec.options);
  if (add.length) {
    patch.options = [...(field.options ?? []), ...add];
    changes.push(`options +${add.join(", +")}`);
  }
  return { patch, changes };
}

export async function applySchema(ctx: OpsContext, spec: SchemaSpec): Promise<SchemaApplyReport> {
  assertCan(ctx, "schema.write");
  const report: SchemaApplyReport = { changes: [], conflicts: [], extraFields: [] };

  for (const o of spec.objects ?? []) {
    let current = listObjects(ctx).find((x) => x.id === o.id);
    const fields = o.fields ?? [];
    if (!current) {
      // Relation fields may point at objects created later in the same spec:
      // they are added in the field pass below.
      // `name` comes with every custom object (system field): patched below.
      const plain = fields.filter((f) => f.type !== "relation" && f.id !== "name").map(withoutDrilldown);
      current = await createObject(ctx, { id: o.id, labelSingular: o.labelSingular, labelPlural: o.labelPlural, icon: o.icon, color: o.color, fields: plain });
      report.changes.push({ kind: "object", action: "create", target: o.id, changes: plain.map((f) => f.id) });
    } else {
      const patch: Parameters<typeof updateObject>[2] = {};
      const changes: string[] = [];
      if (o.labelSingular !== current.labelSingular) (patch.labelSingular = o.labelSingular), changes.push("labelSingular");
      if (o.labelPlural !== current.labelPlural) (patch.labelPlural = o.labelPlural), changes.push("labelPlural");
      if (o.icon && o.icon !== current.icon) (patch.icon = o.icon), changes.push("icon");
      if (o.color && o.color !== current.color) (patch.color = o.color), changes.push("color");
      if (changes.length) {
        current = await updateObject(ctx, o.id, patch);
        report.changes.push({ kind: "object", action: "update", target: o.id, changes });
      }
    }
  }

  // Fields (second pass: every object of the spec exists now).
  for (const o of spec.objects ?? []) {
    for (const f of o.fields ?? []) {
      const current = listObjects(ctx).find((x) => x.id === o.id)!;
      const field = current.fields.find((x) => x.id === f.id);
      if (!field) {
        await createField(ctx, o.id, withoutDrilldown(f));
        report.changes.push({ kind: "field", action: "create", target: `${o.id}.${f.id}`, changes: [f.type] });
        continue;
      }
      if (field.type !== f.type) {
        report.conflicts.push(`${o.id}.${f.id}: type is ${field.type} in the CRM, ${f.type} in the schema (not changed)`);
        continue;
      }
      const { patch, changes } = fieldPatch(field, f);
      if (changes.length) {
        await updateField(ctx, o.id, f.id, patch);
        report.changes.push({ kind: "field", action: "update", target: `${o.id}.${f.id}`, changes });
      }
    }
    const current = listObjects(ctx).find((x) => x.id === o.id)!;
    if (o.labelField && o.labelField !== current.labelField) {
      await updateObject(ctx, o.id, { labelField: o.labelField });
      report.changes.push({ kind: "object", action: "update", target: o.id, changes: ["labelField"] });
    }
    if (o.imageField && o.imageField !== listObjects(ctx).find((x) => x.id === o.id)!.imageField) {
      await updateObject(ctx, o.id, { imageField: o.imageField });
      report.changes.push({ kind: "object", action: "update", target: o.id, changes: ["imageField"] });
    }
    const listed = new Set((o.fields ?? []).map((f) => f.id));
    for (const f of current.fields) if (!f.standard && !f.system && !listed.has(f.id)) report.extraFields.push(`${o.id}.${f.id}`);
  }

  // Drilldowns last: they point at relation fields of other objects, which
  // the field pass may only just have created.
  for (const o of spec.objects ?? []) {
    for (const f of o.fields ?? []) {
      if (f.drilldown === undefined) continue;
      const field = listObjects(ctx).find((x) => x.id === o.id)?.fields.find((x) => x.id === f.id);
      if (!field || field.type !== f.type || same(f.drilldown, field.drilldown)) continue;
      await updateField(ctx, o.id, f.id, { drilldown: f.drilldown });
      report.changes.push({ kind: "field", action: "update", target: `${o.id}.${f.id}`, changes: ["drilldown"] });
    }
  }

  for (const p of spec.pipelines ?? []) {
    const current = listPipelines(ctx).find((x) => x.id === p.id);
    const stages = p.stages.map((s) => ({ ...s, kind: (s.kind ?? "open") as StageKind }));
    // Stage ids are unique across pipelines (one shared select field): a
    // taken id would be renamed (`-2`) and re-added on every apply.
    const taken = new Map(listPipelines(ctx).filter((x) => x.id !== p.id).flatMap((x) => x.stages.map((s) => [s.id, x.id] as const)));
    const clash = stages.filter((s) => taken.has(s.id));
    if (clash.length) {
      report.conflicts.push(`pipeline ${p.id}: stage id(s) ${clash.map((s) => `${s.id} (used by ${taken.get(s.id)})`).join(", ")} — stage ids are unique across pipelines, rename them (not applied)`);
      continue;
    }
    if (!current) {
      await createPipeline(ctx, { id: p.id, name: p.name, object: p.object, stageField: p.stageField, stages });
      report.changes.push({ kind: "pipeline", action: "create", target: p.id, changes: stages.map((s) => s.id) });
      continue;
    }
    const changes: string[] = [];
    if (p.name !== current.name) changes.push("name");
    const now = current.stages.map((s) => ({ id: s.id, label: s.label, kind: s.kind, probability: s.probability }));
    const want = stages.map((s, i) => ({ id: s.id, label: s.label, kind: s.kind, probability: s.probability ?? current.stages.find((c) => c.id === s.id)?.probability ?? now[i]?.probability }));
    // Stages are only added or edited here: one the CRM has and the schema
    // doesn't is kept (removing it would move records).
    const kept = current.stages.filter((s) => !stages.some((w) => w.id === s.id));
    if (!same(now.filter((s) => stages.some((w) => w.id === s.id)), want)) changes.push("stages");
    if (changes.length) {
      await updatePipeline(ctx, p.id, { name: p.name, stages: [...stages.map((s, i) => ({ ...s, probability: want[i].probability })), ...kept] });
      report.changes.push({ kind: "pipeline", action: "update", target: p.id, changes });
    }
  }

  for (const v of spec.views ?? []) {
    const current = listViews(ctx, v.object).find((x) => x.name === v.name);
    if (!current) {
      await createView(ctx, { ...v });
      report.changes.push({ kind: "view", action: "create", target: `${v.object}: ${v.name}` });
      continue;
    }
    const changes: string[] = [];
    const patch: Partial<Omit<ViewSpec, "object">> = {};
    for (const k of ["type", "columns", "filters", "sorts", "groupBy", "pipelineId", "shared"] as const) {
      if (v[k] !== undefined && !same(v[k], current[k])) {
        (patch as Record<string, unknown>)[k] = v[k];
        changes.push(k);
      }
    }
    if (changes.length) {
      await updateView(ctx, current.id, patch);
      report.changes.push({ kind: "view", action: "update", target: `${v.object}: ${v.name}`, changes });
    }
  }
  return report;
}
