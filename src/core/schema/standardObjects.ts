// Standard objects seeded on install (companies, people, deals), the
// default "Sales" pipeline and the default views. They are ordinary
// object definitions: users can add fields, hide standard ones, rename
// labels — only `system` fields are locked (see ops/schema.ts).

import type { CrmRecord, FieldDef, ObjectDef, Pipeline, SelectOption, ViewDef } from "../types";
import { colorAt, normalizeDomain } from "../fields";

export const STANDARD_OBJECT_IDS = ["companies", "people", "deals"] as const;
export type StandardObjectId = (typeof STANDARD_OBJECT_IDS)[number];

export const DEFAULT_PIPELINE_ID = "sales";

function options(labels: Array<string | [string, string]>): SelectOption[] {
  return labels.map((l, i) => {
    const [id, label] = Array.isArray(l) ? l : [l.toLowerCase().replace(/[^a-z0-9]+/g, "-"), l];
    return { id, label, color: colorAt(i) };
  });
}

export const INDUSTRY_OPTIONS = options([
  "Software",
  "Finance",
  "Healthcare",
  "Retail",
  "Manufacturing",
  "Education",
  "Media",
  "Consulting",
  ["real-estate", "Real estate"],
  "Other",
]);

export const LIFECYCLE_OPTIONS: SelectOption[] = [
  { id: "subscriber", label: "Subscriber", color: "gray" },
  { id: "lead", label: "Lead", color: "blue" },
  { id: "mql", label: "MQL", color: "teal" },
  { id: "sql", label: "SQL", color: "indigo" },
  { id: "opportunity", label: "Opportunity", color: "orange" },
  { id: "customer", label: "Customer", color: "green" },
  { id: "evangelist", label: "Evangelist", color: "purple" },
];

export const LEAD_SOURCE_OPTIONS = options(["Website", "Referral", "Event", "Outbound", "Partner", "Ads", "Social", "Other"]);

export const DEFAULT_STAGES: Pipeline["stages"] = [
  { id: "new", label: "New", color: "gray", probability: 10, kind: "open" },
  { id: "qualified", label: "Qualified", color: "blue", probability: 25, kind: "open" },
  { id: "proposal", label: "Proposal", color: "purple", probability: 50, kind: "open" },
  { id: "negotiation", label: "Negotiation", color: "orange", probability: 75, kind: "open" },
  { id: "won", label: "Won", color: "green", probability: 100, kind: "won" },
  { id: "lost", label: "Lost", color: "red", probability: 0, kind: "lost" },
];

export function defaultPipeline(): Pipeline {
  return {
    id: DEFAULT_PIPELINE_ID,
    object: "deals",
    name: "Sales",
    stageField: "stage",
    stages: DEFAULT_STAGES.map((s) => ({ ...s })),
  };
}

const f = (def: FieldDef): FieldDef => ({ standard: true, ...def });

export function companiesObject(now: number): ObjectDef {
  return {
    id: "companies",
    labelSingular: "Company",
    labelPlural: "Companies",
    icon: "Building2",
    color: "blue",
    standard: true,
    labelField: "name",
    createdAt: now,
    updatedAt: now,
    fields: [
      f({ id: "name", label: "Name", type: "text", required: true, system: true }),
      f({ id: "domain", label: "Domain", type: "url", unique: true, description: "Main website — used to deduplicate companies." }),
      f({ id: "industry", label: "Industry", type: "select", options: INDUSTRY_OPTIONS.map((o) => ({ ...o })) }),
      f({ id: "employees", label: "Employees", type: "number" }),
      f({ id: "annualRevenue", label: "Annual revenue", type: "currency", currency: "USD" }),
      f({ id: "address", label: "Address", type: "address" }),
      f({ id: "linkedin", label: "LinkedIn", type: "url" }),
      f({ id: "phone", label: "Phone", type: "phone" }),
      f({ id: "tags", label: "Tags", type: "tags" }),
    ],
  };
}

export function peopleObject(now: number): ObjectDef {
  return {
    id: "people",
    labelSingular: "Person",
    labelPlural: "People",
    icon: "User",
    color: "purple",
    standard: true,
    labelField: "name",
    createdAt: now,
    updatedAt: now,
    fields: [
      f({ id: "firstName", label: "First name", type: "text" }),
      f({ id: "lastName", label: "Last name", type: "text" }),
      f({ id: "name", label: "Name", type: "text", system: true, description: "Full name — kept in sync with first and last name." }),
      f({ id: "email", label: "Email", type: "email", unique: true }),
      f({ id: "phone", label: "Phone", type: "phone" }),
      f({ id: "jobTitle", label: "Job title", type: "text" }),
      f({ id: "company", label: "Company", type: "relation", relation: { object: "companies", cardinality: "one", inverseField: "people" } }),
      f({ id: "city", label: "City", type: "text" }),
      f({ id: "linkedin", label: "LinkedIn", type: "url" }),
      f({ id: "lifecycleStage", label: "Lifecycle stage", type: "select", options: LIFECYCLE_OPTIONS.map((o) => ({ ...o })), defaultValue: "lead" }),
      f({ id: "leadSource", label: "Lead source", type: "select", options: LEAD_SOURCE_OPTIONS.map((o) => ({ ...o })) }),
      f({ id: "tags", label: "Tags", type: "tags" }),
    ],
  };
}

export function dealsObject(now: number, pipelines: Pipeline[] = [defaultPipeline()]): ObjectDef {
  return {
    id: "deals",
    labelSingular: "Deal",
    labelPlural: "Deals",
    icon: "Handshake",
    color: "green",
    standard: true,
    labelField: "name",
    createdAt: now,
    updatedAt: now,
    fields: [
      f({ id: "name", label: "Name", type: "text", required: true, system: true }),
      f({ id: "amount", label: "Amount", type: "currency", currency: "USD" }),
      f({ id: "stage", label: "Stage", type: "select", system: true, options: stageOptions(pipelines), defaultValue: pipelines[0]?.stages[0]?.id }),
      f({ id: "pipeline", label: "Pipeline", type: "select", system: true, options: pipelineOptions(pipelines), defaultValue: pipelines[0]?.id }),
      f({ id: "closeDate", label: "Close date", type: "date" }),
      f({ id: "probability", label: "Probability", type: "percent" }),
      f({ id: "company", label: "Company", type: "relation", relation: { object: "companies", cardinality: "one", inverseField: "deals" } }),
      f({ id: "contacts", label: "Contacts", type: "relation", relation: { object: "people", cardinality: "many", inverseField: "deals" } }),
      f({ id: "lostReason", label: "Lost reason", type: "text" }),
    ],
  };
}

// The stage select of a pipeline object mirrors the stages of every
// pipeline on it (stage ids are unique across pipelines).
export function stageOptions(pipelines: Pipeline[]): SelectOption[] {
  return pipelines.flatMap((p) => p.stages.map((s) => ({ id: s.id, label: s.label, color: s.color })));
}

export function pipelineOptions(pipelines: Pipeline[]): SelectOption[] {
  return pipelines.map((p, i) => ({ id: p.id, label: p.name, color: colorAt(i + 1) }));
}

export function standardObjects(now: number): ObjectDef[] {
  return [companiesObject(now), peopleObject(now), dealsObject(now)];
}

export function defaultViews(): ViewDef[] {
  return [
    {
      id: "companies-all",
      object: "companies",
      name: "All companies",
      type: "table",
      columns: ["name", "domain", "industry", "employees", "annualRevenue", "tags"],
      filters: [],
      sorts: [{ field: "name", dir: "asc" }],
      shared: true,
    },
    {
      id: "people-all",
      object: "people",
      name: "All people",
      type: "table",
      columns: ["name", "email", "company", "jobTitle", "lifecycleStage", "leadSource", "city"],
      filters: [],
      sorts: [{ field: "name", dir: "asc" }],
      shared: true,
    },
    {
      id: "deals-all",
      object: "deals",
      name: "All deals",
      type: "table",
      columns: ["name", "amount", "stage", "closeDate", "company", "contacts", "probability"],
      filters: [],
      sorts: [{ field: "closeDate", dir: "asc" }],
      shared: true,
    },
    {
      id: "deals-pipeline",
      object: "deals",
      name: "Pipeline",
      type: "kanban",
      columns: ["name", "amount", "company", "closeDate"],
      filters: [{ field: "pipeline", op: "eq", value: DEFAULT_PIPELINE_ID }],
      sorts: [{ field: "amount", dir: "desc" }],
      groupBy: "stage",
      pipelineId: DEFAULT_PIPELINE_ID,
      shared: true,
    },
  ];
}

// Default table view for any object (custom objects get one on creation).
export function defaultViewFor(object: ObjectDef): ViewDef {
  return {
    id: `${object.id}-all`,
    object: object.id,
    name: `All ${object.labelPlural.toLowerCase()}`,
    type: "table",
    columns: object.fields.filter((fd) => !fd.hidden).slice(0, 7).map((fd) => fd.id),
    filters: [],
    sorts: [],
    shared: true,
  };
}

// Derived-field rules of the standard objects, applied by ops/records.ts
// on create / update. `previous` is the stored record (update) or null.
export function normalizeStandardFields(
  objectId: string,
  next: Record<string, unknown>,
  previous: CrmRecord["fields"] | null,
): Record<string, unknown> {
  if (objectId === "people") {
    const out = { ...next };
    const first = str(out.firstName);
    const last = str(out.lastName);
    const name = str(out.name);
    const prevDerived = previous ? [str(previous.firstName), str(previous.lastName)].filter(Boolean).join(" ") : "";
    const partsChanged = !!previous && (str(previous.firstName) !== first || str(previous.lastName) !== last);
    if (first || last) {
      // Keep a name the user customised; follow first / last otherwise.
      if (!name || (partsChanged && name === prevDerived)) out.name = [first, last].filter(Boolean).join(" ");
    } else if (name) {
      // "Ada Lovelace" → first / last.
      const parts = name.split(/\s+/);
      out.firstName = parts[0];
      if (parts.length > 1) out.lastName = parts.slice(1).join(" ");
    }
    return out;
  }
  if (objectId === "companies") {
    const out = { ...next };
    if (!str(out.name) && str(out.domain)) {
      const d = normalizeDomain(out.domain);
      const base = d.split(".")[0] ?? "";
      if (base) out.name = base[0].toUpperCase() + base.slice(1);
    }
    return out;
  }
  return next;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
