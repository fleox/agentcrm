// Public typings of `@agent-crm/runtime` — the API AgentCRM extensions
// (external modules & themes) import. Self-contained: only depends on
// `react` and `lucide-react` types. Map the specifier to this file in your
// tsconfig (`"paths": { "@agent-crm/runtime": ["…/agentcrm-runtime.d.ts"] }`)
// and externalise it (plus react, react/jsx-runtime, react-dom,
// react-dom/client, react-i18next, lucide-react) in your bundler.
//
// Kept identical to the runtime object by src/extensions/runtime.test.ts
// (value exports) and its compile-time checks (signatures).
// API version: see `apiVersion` (src/extensions/api.ts).

import type { ComponentType, ForwardRefExoticComponent, ReactNode, RefAttributes, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, HTMLAttributes, ThHTMLAttributes, TdHTMLAttributes, AnchorHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

// ─── Domain ──────────────────────────────────────────────────────────────

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
  | "image"
  | "files";

export interface SelectOption {
  id: string;
  label: string;
  color: string;
}

export interface RelationDef {
  object: string;
  cardinality: "one" | "many";
  inverseField?: string;
}

export interface FieldDef {
  id: string;
  label: string;
  type: FieldType;
  description?: string;
  required?: boolean;
  unique?: boolean;
  standard?: boolean;
  system?: boolean;
  hidden?: boolean;
  options?: SelectOption[];
  currency?: string;
  relation?: RelationDef;
  defaultValue?: unknown;
  // The value links to `drilldown.object`'s list filtered on the records
  // whose relation `drilldown.field` points at this record.
  drilldown?: DrilldownDef;
  // The value rolls up a field of child records (stored value: every child;
  // a list filtered on `rollup.scope.field` recomputes it for that scope).
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
  // A relation of this object (`field`) and the child's relation to the same target (`via`).
  scope?: { field: string; via: string };
  // Children counted.
  where?: Filter[];
}

export interface ObjectDef {
  id: string;
  labelSingular: string;
  labelPlural: string;
  icon: string;
  color: string;
  standard: boolean;
  labelField: string;
  fields: FieldDef[];
  hidden?: boolean;
  imageField?: string;
  createdAt: number;
  updatedAt: number;
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
  // Who last wrote each field, and when (user id, epoch ms).
  fieldUpdates?: Record<string, FieldUpdate>;
  deletedAt?: number;
}

export interface FieldUpdate {
  by: string;
  at: number;
}

export type ActivityType = "note" | "task" | "call" | "email" | "meeting";

export interface ActivityTarget {
  object: string;
  id: string;
}

export interface Activity {
  id: string;
  type: ActivityType;
  title: string;
  body?: string;
  targets: ActivityTarget[];
  dueAt?: number;
  doneAt?: number;
  assigneeId?: string;
  meta?: Record<string, unknown>;
  attachments?: string[];
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  deletedAt?: number;
}

export type StageKind = "open" | "won" | "lost";

export interface PipelineStage {
  id: string;
  label: string;
  color: string;
  probability: number;
  kind: StageKind;
}

export interface Pipeline {
  id: string;
  object: string;
  name: string;
  stageField: string;
  stages: PipelineStage[];
}

export type FilterOp = "eq" | "neq" | "contains" | "notContains" | "empty" | "notEmpty" | "gt" | "gte" | "lt" | "lte" | "in" | "notIn" | "before" | "after" | "withinDays";

export interface Filter {
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

export interface CrmUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
  disabled?: boolean;
  // Per-user interface preferences (written by the user only).
  prefs?: UserPrefs;
}

// One user's own layout of a view (missing key = the view's own value; `at`
// = epoch ms of the last change, newest copy wins between devices).
export interface ViewPrefs {
  type?: ViewDef["type"];
  columns?: string[];
  filters?: Filter[];
  sorts?: Sort[];
  groupBy?: string | null;
  pipelineId?: string | null;
  widths?: Record<string, number>;
  at: number;
}

export interface UserPrefs {
  views?: Record<string, ViewPrefs>;
  // Last view opened per object.
  lastView?: Record<string, { id: string; at: number }>;
}

export interface CrmSettings {
  id: "general";
  name: string;
  defaultCurrency: string;
  locale: string;
  timezone?: string;
  weekStartsOn?: 0 | 1;
  staleDealDays: number;
  ownerUserId?: string;
  maxUploadMb?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

// ─── Data store & ops context ────────────────────────────────────────────

export type CollectionName = "objects" | "records" | "activities" | "pipelines" | "views" | "automations" | "forms" | "users" | "settings" | "config" | "automationRuns" | "extensions" | "files";

export interface StoredDoc {
  id: string;
  [key: string]: unknown;
}

export type DocMutation =
  | { op: "set"; collection: CollectionName; doc: StoredDoc }
  | { op: "patch"; collection: CollectionName; id: string; fields: Record<string, unknown> }
  | { op: "delete"; collection: CollectionName; id: string };

// The parts of the DataStore extensions may use (reads; write through ops).
export interface DataStore {
  readonly kind: "local" | "journal" | "git-json" | "firebase" | "memory";
  list(collection: CollectionName): StoredDoc[];
  get(collection: CollectionName, id: string): StoredDoc | undefined;
  write(mutations: DocMutation[], opts?: { message?: string }): Promise<void>;
  subscribe(listener: (changed: Set<CollectionName>) => void): () => void;
}

// Passed first to every op (useOps() in components, `ctx` in AI tool and
// automation action handlers). `user: null` = system context.
export interface OpsContext {
  store: DataStore;
  user: CrmUser | null;
  now(): number;
  log?: (msg: string) => void;
  depth?: number;
}

export interface ListRecordsOptions {
  filters?: Filter[];
  sorts?: Sort[];
  search?: string;
  viewId?: string;
  ownerId?: string;
  offset?: number;
  limit?: number;
  includeDeleted?: boolean;
  onlyDeleted?: boolean;
}

export interface WriteRecordOptions {
  unknownFields?: "error" | "drop";
  dayFirst?: boolean;
  silent?: boolean;
  message?: string;
}

export interface ListActivitiesOptions {
  target?: ActivityTarget | string;
  includeRelated?: boolean;
  type?: ActivityType;
  types?: ActivityType[];
  assigneeId?: string;
  status?: "open" | "done" | "all";
  dueBefore?: number;
  dueAfter?: number;
  since?: number;
  offset?: number;
  limit?: number;
}

export interface TaskInput {
  title: string;
  body?: string;
  dueAt?: number | string | null;
  assigneeId?: string | null;
  targets?: ActivityTarget[];
}

export interface ForecastStage {
  stageId: string;
  label: string;
  kind: StageKind;
  probability: number;
  count: number;
  amount: number;
  weighted: number;
}

export interface Forecast {
  pipelineId: string;
  currency?: string;
  openCount: number;
  openAmount: number;
  weightedAmount: number;
  wonAmount: number;
  lostAmount: number;
  byStage: ForecastStage[];
  byMonth: { month: string; count: number; amount: number; weighted: number }[];
}

export interface ModuleInfo {
  id: string;
  source: "builtin" | "extension";
  name: string;
  description: string;
  nameKey?: string;
  descriptionKey?: string;
  icon: string;
  category: ModuleCategory;
  required: boolean;
  enabled: boolean;
  dependsOn: string[];
  dependents: string[];
  missingDependencies: string[];
  objects: string[];
  settingsSection?: string;
  version?: string;
  incompatible?: boolean;
}

// The business engine (src/ops/). The most used ops are typed below; the
// object holds every op of the admin (see docs / src/ops/index.ts).
export interface RuntimeOps {
  listRecords(ctx: OpsContext, objectId: string, opts?: ListRecordsOptions): Page<CrmRecord>;
  getRecord(ctx: OpsContext, id: string, opts?: { includeDeleted?: boolean }): CrmRecord;
  createRecord(ctx: OpsContext, objectId: string, input: Record<string, unknown>, opts?: WriteRecordOptions & { id?: string; ownerId?: string | null }): Promise<CrmRecord>;
  updateRecord(ctx: OpsContext, id: string, input: Record<string, unknown>, opts?: WriteRecordOptions & { ownerId?: string | null }): Promise<CrmRecord>;
  deleteRecord(ctx: OpsContext, id: string, opts?: { hard?: boolean; silent?: boolean }): Promise<{ id: string; hard: boolean }>;
  listActivities(ctx: OpsContext, opts?: ListActivitiesOptions): Page<Activity>;
  addNote(ctx: OpsContext, target: ActivityTarget | string, body: string, title?: string): Promise<Activity>;
  createTask(ctx: OpsContext, input: TaskInput): Promise<Activity>;
  completeTask(ctx: OpsContext, id: string, done?: boolean): Promise<Activity>;
  listPipelines(ctx: OpsContext, object?: string): Pipeline[];
  pipelineOfRecord(ctx: OpsContext, record: CrmRecord): Pipeline | undefined;
  moveStage(ctx: OpsContext, recordId: string, stage: string, opts?: { lostReason?: string }): Promise<CrmRecord>;
  forecast(ctx: OpsContext, opts?: { pipelineId?: string; from?: number | string; to?: number | string; ownerId?: string }): Forecast;
  listObjects(ctx: OpsContext): ObjectDef[];
  getSettings(ctx: OpsContext): CrmSettings;
  listUsers(ctx: OpsContext, opts?: { includeDisabled?: boolean }): CrmUser[];
  listModules(ctx: OpsContext): ModuleInfo[];
  getModuleConfig<T = unknown>(ctx: OpsContext, id: string): T | undefined;
  setModuleConfig<T = unknown>(ctx: OpsContext, id: string, value: T | null): Promise<T | undefined>;
  getAppearance(ctx: OpsContext): Appearance;
  // Schema as code (admins): additive, idempotent, atomic.
  parseSchemaSpec(raw: unknown): SchemaSpec;
  applySchema(ctx: OpsContext, spec: SchemaSpec): Promise<SchemaApplyReport>;
  // Mirror an external source into one object (members): one write, diff-only, no automation fires.
  syncRecords(ctx: OpsContext, spec: SyncSpec): Promise<SyncReport>;
  [op: string]: unknown;
}

// ─── Schema as code (ops.applySchema) ───────────────────────────────────

export interface FieldSpec {
  id: string;
  label: string;
  type: FieldType;
  description?: string;
  required?: boolean;
  unique?: boolean;
  hidden?: boolean;
  // Labels, or options ({ label, color } recolours an existing option).
  options?: Array<string | Partial<SelectOption>>;
  currency?: string;
  relation?: RelationDef;
  defaultValue?: unknown;
  drilldown?: DrilldownDef;
  rollup?: RollupDef;
}

export interface ObjectSpec {
  id: string;
  labelSingular: string;
  labelPlural: string;
  icon?: string;
  color?: string;
  labelField?: string;
  imageField?: string;
  fields?: FieldSpec[];
}

export interface StageSpec {
  id: string;
  label: string;
  color?: string;
  probability?: number;
  kind?: StageKind;
}

export interface PipelineSpec {
  id: string;
  name: string;
  object: string;
  stageField?: string;
  stages: StageSpec[];
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
  // Field type differences (never applied).
  conflicts: string[];
  // Custom fields the spec doesn't list (left alone).
  extraFields: string[];
}

// ─── Records sync (ops.syncRecords) ─────────────────────────────────────

export interface SyncRow {
  key: string;
  // Field ids → values; a relation may reference mirrored records by key: { "$key": "12" } / { "$key": ["12", "13"] }.
  fields: Record<string, unknown>;
}

export interface SyncSpec {
  object: string;
  key: string;
  rows: SyncRow[];
  archiveField?: string;
  refKey?: string;
}

export interface SyncReport {
  object: string;
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
  archived: number;
  unresolved: number;
  // References with no matching record: that relation was left unchanged on that row.
  unresolvedRefs: Array<{ key: string; field: string; refs: string[] }>;
  errors: Array<{ key: string; message: string }>;
  samples: { created: string[]; updated: Array<{ key: string; fields: string[] }>; archived: string[] };
}

// ─── Customisation ───────────────────────────────────────────────────────

export type ModuleCategory = "core" | "sales" | "productivity" | "automation" | "integrations" | "ai" | "customisation";

export interface Appearance {
  preset: string;
  accent: string;
  neutral: "zinc" | "slate" | "stone" | "gray" | "neutral";
  radius: "none" | "sm" | "md" | "lg" | "xl";
  density: "compact" | "comfortable";
  font: string;
  sidebar: "default" | "dark" | "accent";
  defaultMode: "system" | "light" | "dark";
  contrast: "normal" | "high";
  buttons: "neutral" | "accent";
  logo?: string;
  favicon?: string;
  customCss?: string;
  themeId?: string;
}

export interface ThemeDefinition {
  id: string;
  apiVersion: string;
  name: string;
  description?: string;
  appearance: Partial<Appearance>;
  css?: string;
}

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: readonly unknown[];
  additionalProperties?: boolean | JsonSchema;
  default?: unknown;
  minimum?: number;
  maximum?: number;
};

// An AI tool (MCP, in-admin assistant, `agentcrm tools`). Name: snake_case,
// unique — prefix it with your module.
export interface AiTool<I = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: JsonSchema & { type: "object" };
  mutating: boolean;
  handler(ctx: OpsContext, input: I): Promise<unknown> | unknown;
}

export interface AutomationActionParam {
  id: string;
  label: string;
  type: "text" | "longText" | "number" | "boolean" | "select";
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  template?: boolean;
}

export type AutomationTriggerType = "record.created" | "record.updated" | "field.changed" | "stage.changed" | "schedule" | "inactivity";

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  object: string;
  trigger: { type: AutomationTriggerType; field?: string; to?: unknown; days?: number; everyHours?: number };
  conditions: Filter[];
  actions: ({ type: string } & Record<string, unknown>)[];
  lastRunAt?: number;
}

export interface AutomationActionRunInput {
  params: Record<string, unknown>;
  record: CrmRecord;
  object: ObjectDef;
  automation: Automation;
  trigger: string;
}

// An automation action ("<moduleId>.<action>") shown in the automation
// editor next to the built-in ones.
export interface AutomationActionDef {
  id: string;
  label: string;
  description?: string;
  params?: AutomationActionParam[];
  objects?: string[];
  describe?(input: Pick<AutomationActionRunInput, "params" | "record" | "object">): string;
  validate?(params: Record<string, unknown>, object: ObjectDef): string[];
  run(ctx: OpsContext, input: AutomationActionRunInput): Promise<string | void> | string | void;
}

// CRM actions emitted by the engine (addAction / ModuleApi.addAction).
export interface CrmActionPayloads {
  "record.created": { record: CrmRecord };
  "record.updated": { record: CrmRecord; before: CrmRecord; changed: string[] };
  "record.deleted": { record: CrmRecord; hard: boolean };
  "record.restored": { record: CrmRecord };
  "stage.changed": { record: CrmRecord; pipelineId: string; from: string | null; to: string };
  "activity.created": { activity: Activity };
  "activity.updated": { activity: Activity; before: Activity };
  "activity.completed": { activity: Activity };
}

export type CrmActionName = keyof CrmActionPayloads;

export interface OpsContextLike {
  user: { id: string; role: string } | null;
  now(): number;
}

export type CrmActionHandler<K extends CrmActionName> = (ctx: OpsContextLike, payload: CrmActionPayloads[K]) => void | Promise<void>;

// ─── Feature (routes, nav, slots) ────────────────────────────────────────

export type NamespaceBundles = { en: Record<string, unknown>; fr?: Record<string, unknown> };

export interface FeatureRoute {
  path: string;
  element: ReactNode;
  roles?: UserRole[];
}

export type NavSection = "main" | "workspace" | "bottom";

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  to: string;
  section?: NavSection;
  order?: number;
  roles?: UserRole[];
  useBadge?: () => number | null;
}

export interface RecordSlotProps {
  record: CrmRecord;
  object: ObjectDef;
}

export interface RecordDetailTab {
  id: string;
  label: string;
  icon?: LucideIcon;
  order?: number;
  component: ComponentType<RecordSlotProps>;
  when?: (object: ObjectDef) => boolean;
}

export interface RecordDetailPanel {
  id: string;
  order?: number;
  component: ComponentType<RecordSlotProps>;
  when?: (object: ObjectDef) => boolean;
}

export interface RecordAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  order?: number;
  component?: ComponentType<RecordSlotProps>;
  onSelect?: (props: RecordSlotProps) => void;
  when?: (object: ObjectDef) => boolean;
}

export interface SettingsSection {
  id: string;
  label: string;
  icon?: LucideIcon;
  order?: number;
  roles?: UserRole[];
  component: ComponentType;
  group?: "workspace" | "data" | "extra";
}

export interface DashboardWidget {
  id: string;
  order?: number;
  span?: 4 | 6 | 8 | 12;
  component: ComponentType;
}

export interface FeatureSlots {
  topBar?: ComponentType[];
  recordDetailTabs?: RecordDetailTab[];
  recordDetailPanels?: RecordDetailPanel[];
  recordActions?: RecordAction[];
  globalOverlays?: ComponentType[];
  settingsSections?: SettingsSection[];
  dashboardWidgets?: DashboardWidget[];
  loginScreen?: ComponentType<{ onSignedIn(): void }>;
}

export interface FeatureEnv {
  user: CrmUser;
}

// What a module contributes (i18n namespace = the module id → t("<id>:key")).
export interface ModuleFeature {
  routes?: FeatureRoute[];
  unconfiguredRoutes?: FeatureRoute[];
  navItems?: NavItem[];
  i18n?: NamespaceBundles;
  slots?: FeatureSlots;
  onStart?: (env: FeatureEnv) => void | (() => void);
}

export interface ModuleApi {
  readonly moduleId: string;
  addAction<K extends CrmActionName>(hook: K, fn: CrmActionHandler<K>, priority?: number): () => void;
  addAction(hook: string, fn: (...args: never[]) => void | Promise<void>, priority?: number): () => void;
  addFilter<T = unknown>(hook: string, fn: (value: T, ...args: unknown[]) => T | Promise<T>, priority?: number): () => void;
  registerAiTool(tool: AiTool): () => void;
  registerAutomationAction(def: AutomationActionDef): () => void;
  onDispose(fn: () => void): void;
}

// Default export of a module bundle.
export interface ModuleDefinition {
  id: string;
  apiVersion: string;
  feature?: ModuleFeature;
  register?(api: ModuleApi): void | (() => void);
  aiTools?: AiTool[];
  automationActions?: AutomationActionDef[];
  settingsPage?: ComponentType;
}

export type ExtensionKind = "module" | "theme";

// manifest.json of an extension ZIP.
export interface ExtensionManifest {
  id: string;
  kind: ExtensionKind;
  name: string;
  version: string;
  apiVersion: string;
  description: string;
  author?: string;
  homepage?: string;
  entry: "bundle.js";
  style?: "style.css";
  icon?: string;
  category?: ModuleCategory;
  dependsOn?: string[];
}

// ─── UI kit props ────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "xs" | "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  loading?: boolean;
  trailing?: ReactNode;
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
  active?: boolean;
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
  invalid?: boolean;
}

export interface SelectOptionItem {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options: SelectOptionItem[];
  placeholder?: string;
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
  indeterminate?: boolean;
}

export interface SwitchProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label?: ReactNode;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  id?: string;
}

export interface ModalProps {
  open: boolean;
  onClose(): void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  dismissible?: boolean;
  className?: string;
}

export interface DrawerProps {
  open: boolean;
  onClose(): void;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
  side?: "right" | "left";
  actions?: ReactNode;
}

export interface TabItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
}

export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect?(): void;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  separator?: boolean;
  checked?: boolean;
}

export interface FieldValueProps {
  field: FieldDef;
  value: unknown;
  compact?: boolean;
  className?: string;
  emptyText?: string;
  // The record shown: lets a drilldown field link to its filtered list.
  recordId?: string;
}

export interface FieldInputProps {
  field: FieldDef;
  value: unknown;
  onChange(value: unknown): void;
  onCommit?(value: unknown): void;
  onCancel?(): void;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
}

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  danger?: boolean;
}

export interface FormatContext {
  locale?: string;
  currency?: string;
  recordLabel?: (object: string, id: string) => string | undefined;
  userName?: (id: string) => string | undefined;
}

export type CoerceResult = { ok: true; value: unknown } | { ok: false; code: string; message: string };

export interface ToastApi {
  info(message: string, durationMs?: number): unknown;
  success(message: string, durationMs?: number): unknown;
  warn(message: string, durationMs?: number): unknown;
  error(message: string, durationMs?: number): unknown;
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
  | "compact"
  | "modules.write"
  | "appearance.write"
  | "extensions.write";

export interface CrmContextValue {
  store: DataStore;
  user: CrmUser;
  ops: OpsContext;
  can(action: OpsAction): boolean;
}

export type DateLike = Date | string | number | null | undefined;

export interface I18nInstance {
  readonly language: string;
  t: (...args: any[]) => any;
  changeLanguage: (...args: any[]) => any;
}

export interface AppPaths {
  dashboard(): string;
  objectList(objectId: string, viewId?: string): string;
  record(objectId: string, recordId: string): string;
  tasks(): string;
  automations(): string;
  forms(): string;
  reports(): string;
  settings(section?: string): string;
}

export interface NavigateFunction {
  (to: string | { pathname?: string; search?: string; hash?: string }, opts?: { replace?: boolean; state?: unknown }): void;
  (delta: number): void;
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string | { pathname?: string; search?: string; hash?: string };
  replace?: boolean;
  state?: unknown;
}

type FC<P> = (props: P) => ReactNode;

export type ClassDictionary = Record<string, any>;
export type ClassArray = ClassValue[];
export type ClassValue = ClassArray | ClassDictionary | string | number | bigint | null | boolean | undefined;

// ─── Values ──────────────────────────────────────────────────────────────

export declare const apiVersion: string;
export declare const minApiVersion: string;
export declare function defineModule(def: ModuleDefinition): ModuleDefinition;
export declare function defineTheme(def: ThemeDefinition): ThemeDefinition;
export declare const ops: RuntimeOps;

export declare function useCrm(): CrmContextValue;
export declare function useOps(): OpsContext;
export declare function useCan(action: OpsAction): boolean;
export declare function useCurrentUser(): CrmUser;
export declare function useCollection<T = StoredDoc>(c: CollectionName): T[];
export declare function useObjects(opts?: { includeHidden?: boolean }): ObjectDef[];
export declare function useObject(id: string | undefined): ObjectDef | undefined;
export declare function useRecords(objectId: string | undefined, opts?: { includeDeleted?: boolean }): CrmRecord[];
export declare function useRecord(id: string | undefined): CrmRecord | undefined;
export declare function useActivities(target?: string | { id: string } | null, opts?: { includeDeleted?: boolean }): Activity[];
export declare function usePipelines(objectId?: string): Pipeline[];
export declare function useViews(objectId: string | undefined): ViewDef[];
export declare function useUsers(opts?: { includeDisabled?: boolean }): CrmUser[];
export declare function useSettings(): CrmSettings;
export declare function useModuleConfig<T = unknown>(id: string): T | undefined;
export declare function useModuleEnabled(id: string): boolean;
export declare function useAppearance(): Appearance;

export declare function useNavigate(): NavigateFunction;
export declare function useParams(): Readonly<Record<string, string | undefined>>;
export declare function useSearchParams(): [URLSearchParams, (next: URLSearchParams | Record<string, string>, opts?: { replace?: boolean }) => void];
export declare function useLocation(): { pathname: string; search: string; hash: string; state: unknown; key: string };
export declare const Link: FC<LinkProps>;
export declare const NavLink: FC<Omit<LinkProps, "className"> & { end?: boolean; className?: string | ((s: { isActive: boolean; isPending: boolean }) => string | undefined) }>;
export declare const paths: AppPaths;
export declare function recordHref(objectId: string, recordId: string): string;

export declare function addAction<K extends CrmActionName>(hook: K, fn: CrmActionHandler<K>, priority?: number): () => void;
export declare function addAction(hook: string, fn: (...args: never[]) => void | Promise<void>, priority?: number): () => void;
export declare function removeAction(hook: string, fn: (...args: never[]) => void | Promise<void>): void;
export declare function addFilter<T = unknown>(hook: string, fn: (value: T, ...args: unknown[]) => T | Promise<T>, priority?: number): () => void;
export declare function removeFilter<T = unknown>(hook: string, fn: (value: T, ...args: unknown[]) => T | Promise<T>): void;
export declare function doAction(hook: string, ...args: unknown[]): Promise<void>;
export declare function applyFilters<T>(hook: string, value: T, ...args: unknown[]): Promise<T>;
export declare function registerAiTool(tool: AiTool): () => void;
export declare function registerAutomationAction(def: AutomationActionDef): () => void;

export declare const Button: ForwardRefExoticComponent<ButtonProps & RefAttributes<HTMLButtonElement>>;
export declare const IconButton: ForwardRefExoticComponent<IconButtonProps & RefAttributes<HTMLButtonElement>>;
export declare const Input: ForwardRefExoticComponent<InputProps & RefAttributes<HTMLInputElement>>;
export declare const Textarea: ForwardRefExoticComponent<TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean } & RefAttributes<HTMLTextAreaElement>>;
export declare const Select: ForwardRefExoticComponent<SelectProps & RefAttributes<HTMLSelectElement>>;
export declare const Label: FC<{ children: ReactNode; htmlFor?: string; className?: string; hint?: ReactNode }>;
export declare const FormField: FC<{ label?: ReactNode; htmlFor?: string; error?: ReactNode; help?: ReactNode; children: ReactNode; className?: string }>;
export declare const Checkbox: ForwardRefExoticComponent<CheckboxProps & RefAttributes<HTMLInputElement>>;
export declare const Switch: FC<SwitchProps>;
export declare const Modal: FC<ModalProps>;
export declare const Drawer: FC<DrawerProps>;
export declare const Card: FC<{ title?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; padded?: boolean } & Omit<HTMLAttributes<HTMLDivElement>, "title">>;
export declare const Badge: FC<{ children: ReactNode; color?: string; className?: string; dot?: boolean }>;
export declare const Avatar: FC<{ name: string; src?: string; size?: "xs" | "sm" | "md" | "lg"; square?: boolean; className?: string }>;
export declare const Tabs: FC<{ tabs: TabItem[]; value: string; onChange(id: string): void; className?: string }>;
export declare const Tooltip: FC<{ content: ReactNode; children: ReactNode; side?: "top" | "bottom" }>;
export declare const Spinner: FC<{ className?: string; size?: "sm" | "md" | "lg" }>;
export declare const EmptyState: FC<{ icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }>;
export declare const PageHeader: FC<{ title: ReactNode; icon?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }>;
export declare const Kbd: FC<{ children: ReactNode }>;
export declare const Dropdown: FC<{ trigger: (props: { ref: (el: HTMLElement | null) => void; onClick(): void; open: boolean }) => ReactNode; items: MenuItem[]; align?: "start" | "end"; header?: ReactNode }>;
export declare const Table: ForwardRefExoticComponent<HTMLAttributes<HTMLTableElement> & RefAttributes<HTMLTableElement>>;
export declare const THead: FC<HTMLAttributes<HTMLTableSectionElement>>;
export declare const TBody: FC<HTMLAttributes<HTMLTableSectionElement>>;
export declare const Tr: FC<HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }>;
export declare const Th: FC<ThHTMLAttributes<HTMLTableCellElement>>;
export declare const Td: FC<TdHTMLAttributes<HTMLTableCellElement>>;
export declare const FieldValue: FC<FieldValueProps>;
export declare const FieldInput: FC<FieldInputProps>;
export declare const ObjectIcon: FC<{ name?: string; color?: string; className?: string; tile?: boolean }>;
export declare const Markdown: FC<{ source: string; className?: string }>;
export declare function confirmDialog(opts: ConfirmOptions): Promise<boolean>;
export declare const toast: ToastApi;
export declare function cn(...args: ClassValue[]): string;
export declare function newId(now?: number): string;

export declare const i18n: I18nInstance;
export declare function addBundles(namespace: string, bundles: NamespaceBundles): void;
export declare function activeLocale(): "en" | "fr";
export declare function intlLocale(): string;

export declare function formatFieldValue(field: FieldDef, value: unknown, ctx?: FormatContext): string;
export declare function formatCurrency(n: number, currency?: string, locale?: string, compact?: boolean): string;
export declare function formatNumber(n: number, locale?: string, opts?: Intl.NumberFormatOptions): string;
export declare function formatDate(value: DateLike, locale?: string): string;
export declare function formatDateTime(value: DateLike, locale?: string): string;
export declare function formatRelative(value: DateLike, locale?: string, now?: number): string;
export declare function recordLabel(object: ObjectDef | undefined, record: Pick<CrmRecord, "id" | "fields">): string;
export declare function coerceFieldValue(field: FieldDef, raw: unknown, opts?: { dayFirst?: boolean; unknownOptions?: "fail" | "keep" }): CoerceResult;
export declare function isEmptyFieldValue(field: FieldDef, value: unknown): boolean;
