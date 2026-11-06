# Runtime API reference — `@agent-crm/runtime`

Everything an extension bundle can import from `@agent-crm/runtime` (extension API **1.1.0**). The authoritative signatures, with every type, are in [`types/agentcrm-runtime.d.ts`](../types/agentcrm-runtime.d.ts) — shipped in the npm package and copied into each project by `agentcrm ext new`. Map it in your `tsconfig.json`:

```json
{ "compilerOptions": { "paths": { "@agent-crm/runtime": ["./types/agentcrm-runtime.d.ts"] } } }
```

At runtime the admin (and the CLI) provide these values from their own instances: one React, one router, one store, one i18n. Besides `@agent-crm/runtime`, a bundle may import only `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `react-i18next` and `lucide-react` (keep all seven external in your Vite config); anything else must be bundled.

Hooks (`use…`) and UI components work only inside React components rendered by the admin (pages, slots, settings pages). AI tools, automation actions and `register()` hooks also run in the CLI / MCP server (Node, no DOM): use `ops.*` with the `ctx` they receive there.

## Versioning and definitions

| Export | Signature | Notes |
|---|---|---|
| `apiVersion` | `string` | API version of the running admin (`"1.1.0"` since AgentCRM 0.12.1; `"1.0.0"` before). |
| `minApiVersion` | `string` | Oldest extension `apiVersion` it accepts. An extension's `apiVersion` must be within `minApiVersion` … `apiVersion`. |
| `defineModule` | `(def: ModuleDefinition) => ModuleDefinition` | Identity helper for typing the default export of a module. |
| `defineTheme` | `(def: ThemeDefinition) => ThemeDefinition` | Same for a theme. |
| `ops` | `RuntimeOps` | The whole business engine (`src/ops/`). Typed subset below; every other op is reachable as `ops.<name>` (type `unknown`: cast it). |

`ModuleDefinition`: `{ id, apiVersion, feature?: ModuleFeature, register?(api: ModuleApi): void | (() => void), aiTools?: AiTool[], automationActions?: AutomationActionDef[], settingsPage?: ComponentType }`.
`ModuleFeature`: `{ routes?, unconfiguredRoutes?, navItems?, i18n?: { en, fr? }, slots?: FeatureSlots, onStart?(env) }`.
`ModuleApi` (argument of `register`): `moduleId`, `addAction`, `addFilter`, `registerAiTool`, `registerAutomationAction`, `onDispose(fn)` — everything registered through it is removed when the module is disabled, upgraded or uninstalled.
`ThemeDefinition`: `{ id, apiVersion, name, description?, appearance: Partial<Appearance>, css? }`.

### `ops` — typed subset (`RuntimeOps`)

Every op takes an `OpsContext` first (`useOps()` in components; the `ctx` argument in tools, actions and hooks). Roles are enforced: viewers read, members write records / activities, admins change schema, settings, modules and appearance.

| Op | Signature |
|---|---|
| `listRecords` | `(ctx, objectId, { filters?, sorts?, search?, viewId?, ownerId?, offset?, limit?, includeDeleted?, onlyDeleted? }) => Page<CrmRecord>` |
| `getRecord` | `(ctx, id, { includeDeleted? }) => CrmRecord` |
| `createRecord` | `(ctx, objectId, fields, { unknownFields?, dayFirst?, silent?, message?, id?, ownerId? }) => Promise<CrmRecord>` |
| `updateRecord` | `(ctx, id, fields, opts?) => Promise<CrmRecord>` |
| `deleteRecord` | `(ctx, id, { hard?, silent? }) => Promise<{ id, hard }>` |
| `listActivities` | `(ctx, { target?, includeRelated?, type?, types?, assigneeId?, status?, dueBefore?, dueAfter?, since?, offset?, limit? }) => Page<Activity>` |
| `addNote` | `(ctx, target, body, title?) => Promise<Activity>` |
| `createTask` | `(ctx, { title, body?, dueAt?, assigneeId?, targets? }) => Promise<Activity>` |
| `completeTask` | `(ctx, id, done?) => Promise<Activity>` |
| `listPipelines` | `(ctx, object?) => Pipeline[]` |
| `pipelineOfRecord` | `(ctx, record) => Pipeline \| undefined` |
| `moveStage` | `(ctx, recordId, stage, { lostReason? }) => Promise<CrmRecord>` |
| `forecast` | `(ctx, { pipelineId?, from?, to?, ownerId? }) => Forecast` |
| `listObjects` | `(ctx) => ObjectDef[]` |
| `getSettings` | `(ctx) => CrmSettings` |
| `listUsers` | `(ctx, { includeDisabled? }) => CrmUser[]` |
| `listModules` | `(ctx) => ModuleInfo[]` |
| `getModuleConfig` | `<T>(ctx, moduleId) => T \| undefined` |
| `setModuleConfig` | `<T>(ctx, moduleId, value \| null) => Promise<T \| undefined>` (admins; JSON ≤ 256 KB, no secrets) |
| `getAppearance` | `(ctx) => Appearance` |
| `parseSchemaSpec` | `(raw: unknown) => SchemaSpec` — validates the shape of a schema file (throws `validation`). |
| `applySchema` | `(ctx, spec: SchemaSpec) => Promise<SchemaApplyReport>` (admins) — schema as code ([schema-as-code.md](schema-as-code.md)): additive, idempotent, atomic (all or nothing, one write). `SchemaApplyReport` = `{ changes: SchemaChange[], conflicts, extraFields }`. |
| `syncRecords` | `(ctx, spec: SyncSpec) => Promise<SyncReport>` (members) — mirror an external source into one object ([sync.md](sync.md)): `SyncSpec` = `{ object, key, rows: SyncRow[], archiveField?, refKey? }`; one write, diff-only, no automation fires. |

`applySchema`, `parseSchemaSpec` and `syncRecords` are in `ops` since API **1.1.0**: an extension calling them should declare `"apiVersion": "1.1.0"` (what `ext new` writes) so an older admin refuses it instead of failing at run time; one that doesn't may keep `"1.0.0"` to load on older admins too.

Other ops (cast before calling): `searchRecords`, `getRecordDetails`, `restoreRecord`, `bulkUpdate`, `bulkDelete`, `setRecordOwner`, `linkRecords`, `unlinkRecords`, `inverseRelations`, `addActivity`, `updateActivity`, `deleteActivity`, `listTasks`, `createPipeline`, `updatePipeline`, `describeSchema`, `createObject`, `updateObject`, `createField`, `updateField`, `addOption`, views, users and settings ops, `importCsv`, `exportCsv`, `findDuplicates`, `mergeRecords`, `runReport`, `getStats`, `listAutomations`, `createAutomation`, `runScheduled`, `listExtensions`, `setAppearance`, `applyPreset`… (see `src/ops/index.ts`).

## Data hooks (live; components only)

| Export | Signature |
|---|---|
| `useCrm` | `() => { store, user, ops, can(action) }` |
| `useOps` | `() => OpsContext` — the context to pass to `ops.*` (acts as the signed-in user). |
| `useCan` | `(action: OpsAction) => boolean` — e.g. `useCan("modules.write")` (admin). |
| `useCurrentUser` | `() => CrmUser` |
| `useCollection` | `<T>(collection) => T[]` — raw documents of a collection. |
| `useObjects` | `({ includeHidden? }) => ObjectDef[]` — objects of enabled modules. |
| `useObject` | `(id) => ObjectDef \| undefined` |
| `useRecords` | `(objectId \| undefined, { includeDeleted? }) => CrmRecord[]` — `undefined` = every object. |
| `useRecord` | `(id) => CrmRecord \| undefined` |
| `useActivities` | `(target?: recordId \| { id } \| null, { includeDeleted? }) => Activity[]` |
| `usePipelines` | `(objectId?) => Pipeline[]` |
| `useViews` | `(objectId) => ViewDef[]` |
| `useUsers` | `({ includeDisabled? }) => CrmUser[]` |
| `useSettings` | `() => CrmSettings` (name, defaultCurrency, locale, staleDealDays…) |
| `useModuleConfig` | `<T>(moduleId) => T \| undefined` — live module config. |
| `useModuleEnabled` | `(moduleId) => boolean` — e.g. hide a widget when `deals` is off. |
| `useAppearance` | `() => Appearance` — the applied appearance (accent, mode…). |

## Router (the admin's hash router)

| Export | Signature |
|---|---|
| `useNavigate` | `() => (to, { replace?, state? }) => void` |
| `useParams` | `() => Record<string, string \| undefined>` — params of your route (`/acme/:id`). |
| `useSearchParams` | `() => [URLSearchParams, setter]` |
| `useLocation` | `() => { pathname, search, hash, state, key }` |
| `Link` | `<Link to="/path">` |
| `NavLink` | `<NavLink to end className={({ isActive }) => …}>` |
| `paths` | `{ dashboard(), objectList(objectId, viewId?), record(objectId, recordId), tasks(), automations(), forms(), reports(), settings(section?) }` |
| `recordHref` | `(objectId, recordId) => string` — `#/objects/…` for a plain `<a href>`. |

## Plugin registry (CRM actions and filters)

| Export | Signature |
|---|---|
| `addAction` | `(hook, fn(ctx, payload), priority?) => remove` — CRM actions: `record.created`, `record.updated`, `record.deleted`, `record.restored`, `stage.changed`, `activity.created`, `activity.updated`, `activity.completed`. Prefer `api.addAction` inside `register()` (auto-removed). |
| `removeAction` | `(hook, fn) => void` |
| `addFilter` | `(hook, fn(value, …args), priority?) => remove` |
| `removeFilter` | `(hook, fn) => void` |
| `doAction` | `(hook, …args) => Promise<void>` — fire your own hooks. |
| `applyFilters` | `(hook, value, …args) => Promise<value>` |
| `registerAiTool` | `(tool: AiTool) => remove` — prefer `aiTools` in the definition. |
| `registerAutomationAction` | `(def: AutomationActionDef) => remove` — prefer `automationActions`. |

`AiTool`: `{ name (snake_case, unique), description, inputSchema: { type: "object", properties, required? }, mutating, handler(ctx, input) }`.
`AutomationActionDef`: `{ id: "<moduleId>.<action>", label, description?, params?: { id, label, type: text|longText|number|boolean|select, required?, options?, placeholder?, template? }[], objects?, describe?(input), validate?(params, object), run(ctx, { params, record, object, automation, trigger }) }`.

## UI kit

Same components as the admin (Tailwind classes `surface-*` / `accent-*` follow the workspace appearance).

| Export | Props (main) |
|---|---|
| `Button` | `variant: primary \| secondary \| ghost \| danger \| outline`, `size: xs \| sm \| md`, `icon`, `loading`, `trailing` + button attributes |
| `IconButton` | `label` (required, a11y), `icon`, `size`, `variant`, `active` |
| `Input` | `icon`, `invalid` + input attributes |
| `Textarea` | `invalid` + textarea attributes |
| `Select` | `options: { value, label, disabled? }[]`, `placeholder` + select attributes |
| `Label` | `htmlFor`, `hint` |
| `FormField` | `label`, `htmlFor`, `error`, `help` |
| `Checkbox` | `label`, `indeterminate` |
| `Switch` | `checked`, `onChange(checked)`, `label`, `disabled`, `size` |
| `Modal` | `open`, `onClose`, `title`, `description`, `footer`, `size: sm \| md \| lg \| xl`, `dismissible` |
| `Drawer` | `open`, `onClose`, `title`, `footer`, `width: sm \| md \| lg`, `side`, `actions` |
| `Card` | `title`, `actions`, `padded` |
| `Badge` | `color`, `dot` |
| `Avatar` | `name`, `src`, `size: xs \| sm \| md \| lg`, `square` |
| `Tabs` | `tabs: { id, label, icon?, count? }[]`, `value`, `onChange(id)` |
| `Tooltip` | `content`, `side` |
| `Spinner` | `size` |
| `EmptyState` | `icon`, `title`, `description`, `action` |
| `PageHeader` | `title`, `icon`, `description`, `actions` |
| `Kbd` | children |
| `Dropdown` | `trigger({ ref, onClick, open })`, `items: { id, label, icon?, onSelect?, danger?, disabled?, separator?, checked? }[]`, `align` |
| `Table`, `THead`, `TBody`, `Tr` (`selected`), `Th`, `Td` | table primitives (row height follows the density setting) |
| `FieldValue` | `field`, `value`, `compact`, `emptyText` — displays any field type like the admin. |
| `FieldInput` | `field`, `value`, `onChange`, `onCommit`, `onCancel`, `autoFocus`, `disabled` — edits any field type. |
| `ObjectIcon` | `name`, `color`, `tile` |
| `Markdown` | `source` — sanitized Markdown. |
| `confirmDialog` | `({ title, description?, confirmLabel?, cancelLabel?, danger? }) => Promise<boolean>` |
| `toast` | `{ info, success, warn, error }(message, durationMs?)` |
| `cn` | `(...classValues) => string` (clsx) |
| `newId` | `(now?) => string` — a new document id. |

## i18n

| Export | Signature |
|---|---|
| `i18n` | the admin's i18next instance (`language`, `t`, `changeLanguage`). |
| `addBundles` | `(namespace, { en, fr? }) => void` — merge strings (a module's `feature.i18n` is registered under its id automatically). |
| `activeLocale` | `() => "en" \| "fr"` |
| `intlLocale` | `() => string` — BCP 47 locale for `Intl` (`en-US`, `fr-FR`…). |

In components use `useTranslation("<moduleId>")` from `react-i18next`.

## Formatters

| Export | Signature |
|---|---|
| `formatFieldValue` | `(field, value, { locale?, currency?, recordLabel?, userName? }) => string` |
| `formatCurrency` | `(n, currency?, locale?, compact?) => string` |
| `formatNumber` | `(n, locale?, Intl.NumberFormatOptions?) => string` |
| `formatDate` | `(value, locale?) => string` |
| `formatDateTime` | `(value, locale?) => string` |
| `formatRelative` | `(value, locale?, now?) => string` ("3 days ago") |
| `recordLabel` | `(object, record) => string` — the record's display name. |
| `coerceFieldValue` | `(field, raw, { dayFirst?, unknownOptions? }) => { ok: true, value } \| { ok: false, code, message }` — parse user input like the admin. |
| `isEmptyFieldValue` | `(field, value) => boolean` |

## Types

Type-only exports (import with `import type`): `FieldType`, `SelectOption`, `RelationDef`, `FieldDef`, `ObjectDef`, `DrilldownDef`, `RollupDef`, `CrmRecord`, `FieldUpdate`, `ActivityType`, `ActivityTarget`, `Activity`, `StageKind`, `PipelineStage`, `Pipeline`, `FilterOp`, `Filter`, `Sort`, `ViewDef`, `UserRole`, `CrmUser`, `ViewPrefs`, `UserPrefs`, `CrmSettings`, `Page`, `CollectionName`, `StoredDoc`, `DocMutation`, `DataStore`, `OpsContext`, `ListRecordsOptions`, `WriteRecordOptions`, `ListActivitiesOptions`, `TaskInput`, `ForecastStage`, `Forecast`, `ModuleInfo`, `RuntimeOps`, schema as code (`FieldSpec`, `ObjectSpec`, `StageSpec`, `PipelineSpec`, `ViewSpec`, `SchemaSpec`, `SchemaChange`, `SchemaApplyReport`), records sync (`SyncRow`, `SyncSpec`, `SyncReport`), `ModuleCategory`, `Appearance`, `ThemeDefinition`, `JsonSchema`, `AiTool`, `AutomationActionParam`, `AutomationTriggerType`, `Automation`, `AutomationActionRunInput`, `AutomationActionDef`, `CrmActionPayloads`, `CrmActionName`, `OpsContextLike`, `CrmActionHandler`, `NamespaceBundles`, `FeatureRoute`, `NavSection`, `NavItem`, `RecordSlotProps`, `RecordDetailTab`, `RecordDetailPanel`, `RecordAction`, `SettingsSection`, `DashboardWidget`, `FeatureSlots`, `FeatureEnv`, `ModuleFeature`, `ModuleApi`, `ModuleDefinition`, `ExtensionKind`, `ExtensionManifest`, UI props (`ButtonVariant`, `ButtonSize`, `SelectOptionItem`, `ButtonProps`, `IconButtonProps`, `InputProps`, `SelectProps`, `CheckboxProps`, `SwitchProps`, `ModalProps`, `DrawerProps`, `TabItem`, `MenuItem`, `FieldValueProps`, `FieldInputProps`, `ConfirmOptions`), `FormatContext`, `CoerceResult`, `DateLike`, `ClassValue`, `ClassArray`, `ClassDictionary`, `ToastApi`, `OpsAction`, `CrmContextValue`, `I18nInstance`, `AppPaths`, `NavigateFunction`, `LinkProps`.

### Slots (`feature.slots`)

| Slot | Item |
|---|---|
| `recordDetailTabs` | `{ id, label, icon?, order?, component: ComponentType<{ record, object }>, when?(object) }` — a tab on record pages. |
| `recordDetailPanels` | `{ id, order?, component, when? }` — a panel in the record side column. |
| `recordActions` | `{ id, label, icon?, order?, component? \| onSelect?({ record, object }), when? }` — an entry of the record actions menu. |
| `dashboardWidgets` | `{ id, order?, span?: 4 \| 6 \| 8 \| 12, component }` — a card on the home dashboard. |
| `settingsSections` | `{ id, label, icon?, order?, roles?, component, group?: workspace \| data \| extra }` — a section of Settings. |
| `topBar` | `ComponentType[]` — items in the top bar. |
| `globalOverlays` | `ComponentType[]` — always-mounted overlays (dialogs, listeners). |
| `loginScreen` | sign-in screen replacement (reserved for backends). |

`navItems`: `{ id, label, icon: LucideIcon, to, section?: main \| workspace \| bottom, order?, roles?, useBadge?() }`. `routes`: `{ path, element, roles? }`.

## Changing the API (maintainers)

Adding an export: `runtimeApi` in `src/extensions/runtime.ts`, `public/runtime/agentcrm-runtime.js`, `types/agentcrm-runtime.d.ts`, this page, then bump `EXTENSION_API_VERSION` (minor) in `src/extensions/api.ts` — also when `ops` gains a re-exported module or a typed op. An optional field added to a domain type (`src/core/types.ts`) or to a UI kit prop is restated in the typings: the compile-time checks of `src/extensions/runtime.test.ts` compare the key sets (`Same<…>`), not just assignability. `src/extensions/runtime.test.ts` keeps the three lists identical and `scripts/docs.test.ts` checks this page lists every value export.
