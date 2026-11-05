// Pure domain types of AgentCRM (see CLAUDE.md "Data model"). Metadata
// driven like Twenty: every business entity is a record of an object;
// standard objects (companies, people, deals) are pre-seeded object
// definitions. No React, no DOM, no backend here.

export type FieldType =
  | "text"
  | "longText"
  | "number"
  | "currency"
  | "percent"
  | "date"
  | "datetime"
  | "boolean"
  | "select"
  | "multiSelect"
  | "email"
  | "phone"
  | "url"
  | "relation"
  | "user"
  | "rating"
  | "address"
  | "tags"
  // Single file id (FileMeta in the `files` collection), shown as an
  // avatar / logo (ObjectDef.imageField).
  | "image"
  // File ids (string[]).
  | "files";

export const FIELD_TYPES: readonly FieldType[] = [
  "text",
  "longText",
  "number",
  "currency",
  "percent",
  "date",
  "datetime",
  "boolean",
  "select",
  "multiSelect",
  "email",
  "phone",
  "url",
  "relation",
  "user",
  "rating",
  "address",
  "tags",
  "image",
  "files",
];

export interface SelectOption {
  id: string;
  label: string;
  color: string;
}

export interface RelationDef {
  object: string;
  cardinality: "one" | "many";
  // Field id on the target object that is the inverse of this one (for
  // display only — inverse lists are computed, never stored).
  inverseField?: string;
}

export interface FieldDef {
  id: string;
  label: string;
  type: FieldType;
  description?: string;
  required?: boolean;
  unique?: boolean;
  // Part of a standard object definition (can be hidden, not deleted).
  standard?: boolean;
  // Managed by the system (never editable / deletable / retyped).
  system?: boolean;
  hidden?: boolean;
  options?: SelectOption[];
  // ISO 4217 code for "currency" fields (default "USD").
  currency?: string;
  relation?: RelationDef;
  defaultValue?: unknown;
  // Makes the value a link to another object's list, filtered on the
  // records whose relation `field` points at this record (e.g. a market's
  // operator count → the operators present on that market).
  drilldown?: DrilldownDef;
  // The value rolls up a field of child records (an operator's status on
  // each of its markets). The stored value covers every child; a list
  // filtered on `scope` recomputes it from the children in that scope.
  rollup?: RollupDef;
}

export interface DrilldownDef {
  object: string;
  // Relation field of `object` that targets this field's object.
  field: string;
}

export interface RollupDef {
  // Child object and its relation to this field's object.
  object: string;
  via: string;
  // Child field whose values are collected.
  field: string;
  // Narrowing: a relation of this object (`field`, e.g. "markets") and the
  // child's relation to the same target (`via`, e.g. "market"). A list
  // filtered on `field` only rolls up the children whose `via` matches.
  scope?: { field: string; via: string };
  // Children counted (e.g. archived ≠ true).
  where?: Filter[];
}

export interface ObjectDef {
  id: string; // slug, e.g. "companies"
  labelSingular: string;
  labelPlural: string;
  // lucide-react icon name ("Building2", "User", "Handshake"…).
  icon: string;
  color: string;
  standard: boolean;
  // Field id used as the record's display label.
  labelField: string;
  fields: FieldDef[];
  // Hidden from navigation / pickers (data kept). Objects owned by a
  // disabled module are hidden too (src/core/modules.ts `objects`).
  hidden?: boolean;
  // Field id (type "image") used as the record's avatar / logo everywhere
  // (header, table, kanban, chips, search). Initials when empty.
  imageField?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FieldUpdate {
  by: string;
  at: number;
}

export interface CrmRecord {
  id: string;
  object: string;
  fields: Record<string, unknown>;
  ownerId?: string;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  updatedBy?: string;
  // Who last wrote each field, and when (every write by a known actor stamps
  // the fields it changed). `updatedBy` alone names the last writer of the
  // whole record: a later write to another field would hide who changed this one.
  fieldUpdates?: Record<string, FieldUpdate>;
  // Soft delete (restorable). Physical purge: ops/compact.ts.
  deletedAt?: number;
}

export type ActivityType = "note" | "task" | "call" | "email" | "meeting";

export const ACTIVITY_TYPES: readonly ActivityType[] = ["note", "task", "call", "email", "meeting"];

export interface ActivityTarget {
  object: string;
  id: string;
}

export interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  body?: string; // markdown
  targets: ActivityTarget[];
  dueAt?: number;
  doneAt?: number;
  assigneeId?: string;
  // Email headers, call duration, meeting start/end, external ids…
  meta?: Record<string, unknown>;
  // Attached file ids (FileMeta in the `files` collection).
  attachments?: string[];
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  deletedAt?: number;
}

// ─── Files (images & attachments) ───────────────────────────────────────

// What a file is attached to: a record (directly, its image / files
// fields) or an activity (note, task, call, email, meeting).
export interface FileTarget {
  kind: "record" | "activity";
  // Object id of a record target.
  object?: string;
  id: string;
}

// `files/<id>` document. The bytes live in the backend's FileStore
// (src/data/files/): encrypted next to the journal, IndexedDB, git repo,
// Firebase Storage… Metadata only here.
export interface FileMeta {
  id: string;
  name: string;
  mime: string;
  // Bytes of the stored (possibly resized) file.
  size: number;
  width?: number;
  height?: number;
  // Blob id of a small preview (images: 320 px WebP).
  thumbId?: string;
  // Hex SHA-256 of the stored bytes.
  sha256: string;
  createdAt: number;
  updatedAt?: number;
  createdBy?: string;
  targets: FileTarget[];
  // Soft delete: the blob is purged by `compact`.
  deletedAt?: number;
}

export type StageKind = "open" | "won" | "lost";

export interface PipelineStage {
  id: string;
  label: string;
  color: string;
  // 0–100.
  probability: number;
  kind: StageKind;
}

export interface Pipeline {
  id: string;
  object: string; // "deals"
  name: string;
  // Select field of `object` whose options mirror the stages.
  stageField: string;
  stages: PipelineStage[];
}

export type FilterOp =
  | "eq"
  | "neq"
  | "contains"
  | "notContains"
  | "empty"
  | "notEmpty"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "notIn"
  | "before"
  | "after"
  | "withinDays";

export const FILTER_OPS: readonly FilterOp[] = [
  "eq",
  "neq",
  "contains",
  "notContains",
  "empty",
  "notEmpty",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "notIn",
  "before",
  "after",
  "withinDays",
];

export interface Filter {
  // A field id of the object, or a record property: "id", "ownerId",
  // "createdAt", "updatedAt", "createdBy".
  field: string;
  op: FilterOp;
  value?: unknown;
}

export interface Sort {
  field: string;
  dir: "asc" | "desc";
}

export interface ViewDef {
  id: string;
  object: string;
  name: string;
  type: "table" | "kanban";
  columns: string[];
  filters: Filter[];
  sorts: Sort[];
  groupBy?: string;
  pipelineId?: string;
  shared: boolean;
  ownerId?: string;
}

export type UserRole = "admin" | "member" | "viewer";

export const USER_ROLES: readonly UserRole[] = ["admin", "member", "viewer"];

export interface CrmUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
  disabled?: boolean;
}

export type AutomationTriggerType = "record.created" | "record.updated" | "field.changed" | "stage.changed" | "schedule" | "inactivity";

export interface AutomationTrigger {
  type: AutomationTriggerType;
  field?: string;
  to?: unknown;
  days?: number;
  everyHours?: number;
}

export type AutomationAction =
  | { type: "createTask"; title: string; dueInDays?: number; assignTo?: "owner" | string }
  | { type: "updateField"; field: string; value: unknown }
  | { type: "addNote"; body: string }
  | { type: "assignOwner"; userId: string | "roundRobin" }
  | { type: "webhook"; url: string }
  // Action contributed by an extension module (registerAutomationAction):
  // `action` = its namespaced id ("sales-goals.notifyGoalReached").
  | { type: "extension"; action: string; params?: Record<string, unknown> };

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  object: string;
  trigger: AutomationTrigger;
  conditions: Filter[];
  actions: AutomationAction[];
  lastRunAt?: number;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  recordId?: string;
  startedAt: number;
  finishedAt?: number;
  status: "ok" | "error" | "skipped";
  message?: string;
  actions?: { type: AutomationAction["type"]; ok: boolean; message?: string }[];
}

export interface LeadFormField {
  field: string;
  label: string;
  required: boolean;
}

export interface LeadForm {
  id: string;
  name: string;
  object: string;
  fields: LeadFormField[];
  inbox: { kind: "s3" | "firebase" | "webhook"; settings: Record<string, string> };
  successMessage: string;
  publishedPath?: string;
}

// `settings/general` document.
export interface CrmSettings {
  id: "general";
  name: string;
  defaultCurrency: string;
  // BCP-47 locale for number / date formatting ("en-US", "fr-FR").
  locale: string;
  timezone?: string;
  // Week start for calendars: 0 = Sunday, 1 = Monday.
  weekStartsOn?: 0 | 1;
  // Days without activity after which an open deal counts as stale.
  staleDealDays: number;
  // Identity used by the local & journal backends (no login).
  ownerUserId?: string;
  // Upload limit per file in MB (default 25).
  maxUploadMb?: number;
  createdAt?: number;
  updatedAt?: number;
}

// Address field value.
export interface AddressValue {
  street?: string;
  city?: string;
  postalCode?: string;
  region?: string;
  country?: string;
}

export const SYSTEM_RECORD_PROPS = ["id", "ownerId", "createdAt", "updatedAt", "createdBy", "updatedBy"] as const;
export type SystemRecordProp = (typeof SYSTEM_RECORD_PROPS)[number];
