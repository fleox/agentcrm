# `@agent-crm/runtime` at a glance

The full reference with every signature is `docs/runtime-api-reference.md` in the AgentCRM repository; the authoritative types are the project's `types/agentcrm-runtime.d.ts` (read it when in doubt, it is self-contained). Extension API version: 1.1.0 (AgentCRM 0.12.1+, written by `ext new`; extensions declaring 1.0.0 still load). 1.1.0 adds `ops.parseSchemaSpec`, `ops.applySchema` and `ops.syncRecords`; an extension that doesn't use them may keep `apiVersion: "1.0.0"` to load on older admins too. Besides this module a bundle may import only `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `react-i18next`, `lucide-react`.

Hooks and components work only in React components the admin renders (pages, slots, settings pages). AI tools, automation actions and `register()` hooks also run in the CLI / MCP server (Node, no DOM): there, only use `ops.*` with the `ctx` argument.

## Definitions

- `defineModule({ id, apiVersion, feature?, register?(api), aiTools?, automationActions?, settingsPage? })`
- `defineTheme({ id, apiVersion, name, description?, appearance, css? })`
- `apiVersion`, `minApiVersion`: what the running admin accepts.
- `feature`: `routes [{ path, element, roles? }]`, `navItems [{ id, label, icon, to, section: main|workspace|bottom, order?, roles? }]`, `i18n { en, fr }`, `slots { recordDetailTabs, recordDetailPanels, recordActions, dashboardWidgets, settingsSections, topBar, globalOverlays }`, `onStart?(env)`.
- `register(api)`: `api.addAction(hook, fn)`, `api.addFilter(hook, fn)`, `api.registerAiTool(tool)`, `api.registerAutomationAction(def)`, `api.onDispose(fn)`, `api.moduleId`. Removed automatically on disable / upgrade.

## Engine: `ops`

Every op takes the context first: `useOps()` in components, `ctx` in tools / actions / hooks. Typed: `listRecords(ctx, objectId, { filters, sorts, search, limit })` → `{ items, total }`, `getRecord`, `createRecord(ctx, objectId, fields)`, `updateRecord(ctx, id, fields)`, `deleteRecord`, `listActivities(ctx, { target })`, `addNote(ctx, { object, id }, body, title?)`, `createTask(ctx, { title, dueAt?, assigneeId?, targets? })`, `completeTask`, `listPipelines`, `pipelineOfRecord`, `moveStage(ctx, recordId, stage)`, `forecast`, `listObjects`, `getSettings`, `listUsers`, `listModules`, `getModuleConfig(ctx, id)`, `setModuleConfig(ctx, id, value)`, `getAppearance`, `parseSchemaSpec(raw)` + `applySchema(ctx, spec)` (schema as code, admins: additive, idempotent, all or nothing → `{ changes, conflicts, extraFields }`), `syncRecords(ctx, { object, key, rows: [{ key, fields }], archiveField?, refKey? })` (mirror a source by key: one write, diff-only, no automation fires → `{ created, updated, unchanged, archived, unresolved, unresolvedRefs, errors, samples }`). Typed records carry `fieldUpdates` (`{ [fieldId]: { by, at } }`), fields `drilldown` / `rollup`, users `prefs`. Every other op of the engine (`createObject`, `createField`, `searchRecords`, `createAutomation`, `runReport`…) is there too, typed `unknown`: cast it to its signature.

Filters: `{ field, op, value }` with op `eq, neq, contains, notContains, empty, notEmpty, gt, gte, lt, lte, in, notIn, before, after, withinDays`. Sorts: `{ field, dir: "asc" | "desc" }`.

## Data hooks (live)

`useCrm`, `useOps`, `useCan(action)`, `useCurrentUser`, `useCollection(name)`, `useObjects`, `useObject(id)`, `useRecords(objectId)`, `useRecord(id)`, `useActivities(recordId)`, `usePipelines(objectId)`, `useViews(objectId)`, `useUsers`, `useSettings`, `useModuleConfig(id)`, `useModuleEnabled(id)`, `useAppearance`.

Permissions for `useCan`: `records.read`, `records.write`, `records.delete`, `activities.write`, `schema.write`, `settings.write`, `users.write`, `automations.write`, `modules.write`, `appearance.write`, `extensions.write`…

## Router

`useNavigate`, `useParams`, `useSearchParams`, `useLocation`, `Link`, `NavLink`, `paths` (`dashboard()`, `objectList(objectId, viewId?)`, `record(objectId, recordId)`, `tasks()`, `automations()`, `forms()`, `reports()`, `settings(section?)`), `recordHref(objectId, recordId)`.

## Plugin registry

`addAction`, `removeAction`, `addFilter`, `removeFilter`, `doAction`, `applyFilters`, `registerAiTool`, `registerAutomationAction`. CRM actions: `record.created`, `record.updated`, `record.deleted`, `record.restored`, `stage.changed`, `activity.created`, `activity.updated`, `activity.completed` (handler: `(ctx, payload)`).

## UI kit

`Button`, `IconButton`, `Input`, `Textarea`, `Select`, `Label`, `FormField`, `Checkbox`, `Switch`, `Modal`, `Drawer`, `Card`, `Badge`, `Avatar`, `Tabs`, `Tooltip`, `Spinner`, `EmptyState`, `PageHeader`, `Kbd`, `Dropdown`, `Table`, `THead`, `TBody`, `Tr`, `Th`, `Td`, `FieldValue`, `FieldInput`, `ObjectIcon`, `Markdown`, `confirmDialog`, `toast`, `cn`, `newId`. Tailwind classes of the admin work (`text-surface-500`, `bg-accent-500`, `dark:`…) and follow the workspace appearance.

## i18n and formatters

`i18n`, `addBundles(ns, { en, fr })`, `activeLocale()`, `intlLocale()`; `formatFieldValue`, `formatCurrency(n, currency, locale, compact?)`, `formatNumber`, `formatDate`, `formatDateTime`, `formatRelative`, `recordLabel(object, record)`, `coerceFieldValue(field, raw)`, `isEmptyFieldValue`.
