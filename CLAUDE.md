# CLAUDE.md — AgentCRM

AgentCRM is **the static CRM your AI agent can run** — a Twenty / HubSpot-style CRM (companies, people, deals, pipelines, activities, tasks, custom objects & fields, views, automations, lead forms, reports) that is **100 % static**: the admin is a React + Vite SPA (strict TypeScript, Tailwind) that runs in the browser (or headless in Node through the `agentcrm` CLI / MCP server). There is **no server of ours**, ever. Data lives where the owner chooses; the admin itself is hosted on any static host.

It is the sibling of AgentCMS (`../cms-ia/`). Infrastructure was copied from there (see `SHARED.md` for provenance). When in doubt about a pattern (connectors, runtime config, setup wizard, CLI framework, skills, Hermes generation), **read the cms-ia equivalent first and mirror it**.

## Hard rules

1. **Full static.** No backend code, no edge functions, no required third-party service. Anything that "needs a server" is done (a) in the browser when the admin is open, (b) by the `agentcrm` CLI run by a human / an agent / a scheduled GitHub Action, or (c) by a service the *user* owns (Firebase, their S3 bucket, their Google account via browser OAuth).
2. **One engine, four front doors.** All business logic lives in `src/ops/` (pure TS over the `DataStore` API, no React, no DOM). The admin UI, the CLI (`agent/`), the MCP server (`agent/mcp/`) and the in-admin AI assistant (`src/features/assistant/`) all call `src/ops/`. Never duplicate business rules in a page or a command.
3. **AI tools are declared once** in `src/ai/tools.ts` (name, description, JSON schema, handler calling `src/ops/`). MCP and the in-admin assistant expose exactly this list; the CLI `agentcrm tools list|call` too.
4. **Secrets never leave the browser / the CLI credentials file**: never in `config.js`, never in the data, never in git. (Same as cms-ia.)
5. **Personal data**: file backends are **encrypted by default** (AES-256-GCM, `src/shared/crypto/`). Deleting a record must be able to purge it physically (`compact`).
6. All code, comments, docs, skills: **English**. UI strings through `t()`; ship `en` + `fr` at least (en is the source of truth).
7. Forms: every `<form>` has `data-form-type="other"`; submit buttons use the stable `<span>` icon wrapper (cms-ia "Form crash prevention").
8. `npm run typecheck`, `npm test`, `npm run build` must pass. Write Vitest tests next to the code (`*.test.ts`) for every op and store.

## Layout

```
src/
  shared/            Copied infra (see SHARED.md): storage/ connectors (s3, git-pages, local-folder, browser-mirror, memory) + siteFiles facade + batch,
                     git/ transport, crypto/ (AES-GCM + PBKDF2), lib/ (toast, utils)
  lib/runtimeConfig.ts  Runtime config + per-browser secrets (mirror of cms-ia src/lib/runtimeConfig.ts)
  core/              Pure domain: types.ts, schema/ (standard objects), fields.ts (validation/format), query.ts (filters/sorts),
                     search.ts (MiniSearch index), ids.ts, pluginRegistry.ts
  data/              DataStore API (types.ts), backends: local.ts (IndexedDB), journal/ (encrypted snapshot+journal over any connector),
                     gitJson.ts (one JSON file per doc in a git repo), firebase.ts (Firestore), memory.ts (tests/CLI), index.ts (getDataStore())
  ops/               Business engine: records, relations, activities, tasks, pipelines, views, schema, users, settings,
                     importCsv, exportCsv, dedupe/merge, reports, automations engine, lead inbox ingestion, compact, stats
  ai/                tools.ts (shared tool catalog), assistant runtime (Claude API from browser)
  app/               App.tsx, routes registry, layout shell, AuthContext, CrmDataContext, setup wizard
  features/<name>/   One folder per feature: index.ts exports { id, routes, navItems, i18n } — App aggregates src/features/index.ts
  components/ui/     Shared UI kit (Button, Input, Select, Modal, Drawer, Table, Badge, Avatar, Tabs, Toast, CommandPalette…)
  i18n/              core bundles en.json / fr.json; features ship their own bundles under features/<name>/i18n/
agent/               `agentcrm` CLI (Node ≥ 20, bundled to dist/agent/agentcrm.mjs), mcp/ (stdio MCP server), testing/ fakes
plugin/skills/       Claude Code skills (agentcrm-install, agentcrm-manage, agentcrm-admin, agentcrm-sales)
hermes/              generated Python-agent skills (scripts/build-hermes.mjs)
docs/                user docs
```

### Feature folders (parallel work boundary)

| Feature folder | Content |
|---|---|
| `features/records` | Object list pages: table view (inline edit, sort, filter, columns, saved views, bulk actions), kanban view (group by select/stage, drag & drop), record detail page (fields panel, relations, timeline, tasks, notes) |
| `features/dashboard` | Home dashboard (pipeline by stage, won/lost, activity, my tasks) + reports page (charts) |
| `features/tasks` | "My tasks" / all tasks / calendar-ish due list |
| `features/settings` | General settings, data model editor (custom objects & fields, pipelines), users & roles, data backend & hosting, import/export, admin hosting, danger zone (compact, purge) |
| `features/search` | Cmd+K command palette (records + navigation + actions) |
| `features/automations` | Automation list/editor + run log |
| `features/forms` | Lead capture form builder, published static form, inbox ingestion UI |
| `features/integrations` | Gmail / Google Calendar / Outlook via browser OAuth, email logging, meeting sync |
| `features/assistant` | Chat panel driving `src/ai/tools.ts` with the Claude API (user's own key) |

Each feature registers routes and nav items through its own `index.ts` and its i18n under its namespace (`t("records:…")`). **Do not edit another feature's folder.** Shared UI goes to `components/ui/` (additive only).

## Data model (`src/core/types.ts`)

Metadata-driven like Twenty: every business entity is a **record of an object**; standard objects are just pre-seeded object definitions.

```ts
type FieldType = "text" | "longText" | "number" | "currency" | "percent" | "date" | "datetime" | "boolean"
  | "select" | "multiSelect" | "email" | "phone" | "url" | "relation" | "user" | "rating" | "address" | "tags";
interface SelectOption { id: string; label: string; color: string }
interface FieldDef { id: string; label: string; type: FieldType; description?: string; required?: boolean; unique?: boolean;
  standard?: boolean; system?: boolean; hidden?: boolean; options?: SelectOption[]; currency?: string;
  relation?: { object: string; cardinality: "one" | "many"; inverseField?: string }; defaultValue?: unknown }
interface ObjectDef { id: string /* slug, e.g. "companies" */; labelSingular: string; labelPlural: string; icon: string; color: string;
  standard: boolean; labelField: string; fields: FieldDef[]; createdAt: number; updatedAt: number }
interface CrmRecord { id: string; object: string; fields: Record<string, unknown>; ownerId?: string;
  createdAt: number; updatedAt: number; createdBy?: string; updatedBy?: string; deletedAt?: number }
type ActivityType = "note" | "task" | "call" | "email" | "meeting";
interface Activity { id: string; type: ActivityType; title: string; body?: string /* markdown */;
  targets: { object: string; id: string }[]; dueAt?: number; doneAt?: number; assigneeId?: string;
  meta?: Record<string, unknown> /* email headers, call duration, meeting start/end, external ids */;
  createdAt: number; updatedAt: number; createdBy?: string; deletedAt?: number }
interface Pipeline { id: string; object: string /* "deals" */; name: string; stageField: string;
  stages: { id: string; label: string; color: string; probability: number; kind: "open" | "won" | "lost" }[] }
interface ViewDef { id: string; object: string; name: string; type: "table" | "kanban"; columns: string[];
  filters: Filter[]; sorts: Sort[]; groupBy?: string; pipelineId?: string; shared: boolean; ownerId?: string }
interface Filter { field: string; op: "eq"|"neq"|"contains"|"notContains"|"empty"|"notEmpty"|"gt"|"gte"|"lt"|"lte"|"in"|"notIn"|"before"|"after"|"withinDays"; value?: unknown }
interface Sort { field: string; dir: "asc" | "desc" }
interface CrmUser { id: string; email: string; name: string; role: "admin" | "member" | "viewer"; avatarUrl?: string; disabled?: boolean }
interface Automation { id: string; name: string; enabled: boolean; object: string;
  trigger: { type: "record.created" | "record.updated" | "field.changed" | "stage.changed" | "schedule" | "inactivity"; field?: string; to?: unknown; days?: number; everyHours?: number };
  conditions: Filter[];
  actions: ({ type: "createTask"; title: string; dueInDays?: number; assignTo?: "owner" | string }
          | { type: "updateField"; field: string; value: unknown }
          | { type: "addNote"; body: string }
          | { type: "assignOwner"; userId: string | "roundRobin" }
          | { type: "webhook"; url: string } )[];
  lastRunAt?: number }
interface LeadForm { id: string; name: string; object: string; fields: { field: string; label: string; required: boolean }[];
  inbox: { kind: "s3" | "firebase" | "webhook"; settings: Record<string, string> }; successMessage: string; publishedPath?: string }
```

Standard objects seeded on install (`src/core/schema/standardObjects.ts`): `companies` (name, domain, industry, employees, annualRevenue, address, linkedin, phone, tags), `people` (firstName, lastName, name, email, phone, jobTitle, company→companies, city, linkedin, lifecycleStage select: subscriber/lead/mql/sql/opportunity/customer/evangelist, leadSource, tags), `deals` (name, amount currency, stage, pipeline, closeDate, probability, company→companies, contacts→people many, lostReason). Default pipeline "Sales" with stages New / Qualified / Proposal / Negotiation / Won / Lost.

Relations are stored on the record field holding the id (`one`) or id array (`many`); inverse lists are computed by `ops/relations.ts` (no dual writes).

## DataStore API (`src/data/types.ts`)

Generalisation of cms-ia's docstore (`../cms-ia/src/services/docstore/types.ts`): whole dataset in memory, synchronous reads after `ready()`, optimistic `write()`.

```ts
type CollectionName = "objects" | "records" | "activities" | "pipelines" | "views" | "automations" | "forms" | "users" | "settings" | "config" | "automationRuns";
interface StoredDoc { id: string; [k: string]: unknown }
type DocMutation = { op: "set"; collection: CollectionName; doc: StoredDoc } | { op: "patch"; collection: CollectionName; id: string; fields: Record<string, unknown> } | { op: "delete"; collection: CollectionName; id: string };
interface DataStore { readonly kind: BackendKind; ready(): Promise<void>; list(c): StoredDoc[]; get(c, id): StoredDoc | undefined;
  write(mutations: DocMutation[], opts?: { message?: string }): Promise<void>; subscribe(l: (changed: Set<CollectionName>) => void): () => void;
  refresh(): Promise<void>; identity(): Promise<StoreIdentity | null>; compact?(): Promise<void>; close?(): void }
type BackendKind = "local" | "journal" | "git-json" | "firebase" | "memory";
```

`patch` merges **per field** (dot paths allowed for `fields.x`). One user action = one `write()`.

### Journal backend (`src/data/journal/`, default)

For any storage connector (S3 / R2 / OVH bucket, git repo, local folder): `<root>/snapshot.bin` (encrypted full state + `appliedSegments` list + hlc) and `<root>/journal/<hlc>-<clientId>.bin` (encrypted mutation batch, never rewritten). Writes append a segment (no lock, no conflict). Reads = snapshot + all segments not in snapshot, merged in HLC order with **per-field last-writer-wins** (a hybrid logical clock per mutation). Polling lists `journal/` (connector `listPrefix(prefix)` — added to our copy of the connectors) every 20 s. `compact()` writes a new snapshot then deletes merged segments (physical purge of deleted records = GDPR erasure). Encryption: passphrase → PBKDF2-SHA256 600k → AES-256-GCM, format `ACRMENC1|iter|salt|iv|ct`, salt in `<root>/keyinfo.json` (public). Gzip payloads (CompressionStream / zlib in Node) before encrypting.

### Other backends
- `local` — IndexedDB, single user, no login.
- `git-json` — one file per doc (`records/<object>/<id>.json`, …) in a **private** repo via `shared/git` (GitHub/GitLab REST, local clone); one commit per write; each user signs in with their own token (repo permission → role). Warn in UI: history keeps personal data.
- `firebase` — Firestore collections, `onSnapshot`, Firebase Auth (email/password + Google); roles in `users/{uid}`; rules generated by `ops/firebaseRules.ts` and documented in `docs/firebase.md`.
- `memory` — tests and CLI dry runs.

Roles: `admin` (everything incl. schema/settings/users), `member` (CRUD records/activities, own views), `viewer` (read-only). Enforced in `src/ops/` via `ctx.user` (`assertCan(ctx, action)`), and by Firestore rules in Firebase mode.

## Ops layer contract (`src/ops/`)

Every op takes an `OpsContext` first: `{ store: DataStore; user: CrmUser | null; now(): number; log?: (msg) => void }` (`ops/context.ts`). Ops validate input with `core/fields.ts`, enforce roles, write through `store.write`, then emit plugin actions (`record.created`, `record.updated`, `record.deleted`, `activity.created`, `stage.changed`) on `core/pluginRegistry.ts` — the automations engine subscribes to those. Ops return plain JSON-able values (the CLI prints them as-is).

Main modules: `records.ts` (list with filter/sort/search/pagination, get with relations expanded, create, update, delete (soft), restore, bulkUpdate, bulkDelete), `relations.ts`, `activities.ts` (notes/tasks/calls/emails/meetings, timeline), `pipelines.ts` (move stage, forecast), `schema.ts` (create/update/delete objects & fields with data migration on type change), `views.ts`, `users.ts`, `settings.ts`, `importCsv.ts` (mapping, type coercion, dedupe on email/domain, dry run), `exportCsv.ts`, `dedupe.ts` (find duplicates, merge records keeping relations/activities), `reports.ts` (pipeline by stage, forecast, won/lost over time, activity by user, lead sources, stale deals), `automations.ts` (engine: event triggers in-process + `runScheduled(ctx)` for schedule/inactivity), `forms.ts` (build static form HTML + embed snippet, `ingestInbox`), `compact.ts`, `stats.ts`, `seed.ts` (standard objects + optional demo data).

## Runtime config & setup

Mirror cms-ia (`lib/runtimeConfig.ts`, `pages/SetupForm.tsx`, `pages/setup/installers.ts`): `window.__AGENTCRM_CONFIG__` from `<admin>/config.js`, or localStorage `agentcrm.runtimeConfig`. Wizard: Terms → **Data** (Encrypted file on my storage [default] / Firebase / Private git repo / This browser) → **Where** (S3-compatible bucket, GitHub / GitLab repo, local folder — for the journal backend; plus "host the admin on…" GitHub/Cloudflare/GitLab Pages, S3, local, ZIP) → **Install** (seed schema, admin user, optional demo data, config.js upload or download). Admin uses `HashRouter`, Vite `base: "./"`.

## CLI (`agent/`) & MCP

Mirror cms-ia `agent/` (browserEnv, credentials in `~/.agentcrm/credentials.json` 0600, `sites.json` registry, `--json` → one `{ ok, data } | { ok: false, error: { code, message, hint } }`, exit 2 for usage errors, destructive = plan unless `--yes`). Bundled by `vite.agent.config.ts` into `dist/agent/agentcrm.mjs` (no runtime deps). Commands: `help`, `status`, `options`, `credentials set|list|remove`, `install --plan`, `site list|add|use|forget`, `doctor`, `serve` (serves dist/admin locally), `deploy-admin`, `records list|get|create|update|delete|search|merge`, `objects`/`fields` (schema), `activities add|list|done`, `tasks`, `pipelines list|move`, `views`, `users`, `settings`, `import csv`, `export csv|json`, `report <name>`, `automations list|enable|disable|run`, `forms list|publish|ingest`, `compact`, `tools list|call` (AI tool catalog), `mcp` (stdio MCP server, JSON-RPC 2.0, protocol 2025-06-18, tools = `src/ai/tools.ts`). A GitHub Actions template (`docs/templates/agentcrm-cron.yml`) runs `agentcrm automations run --yes` + `forms ingest --yes` on a schedule.

## Commands

```bash
npm install --legacy-peer-deps
npm run dev        # admin at http://localhost:5173
npm run typecheck
npm test
npm run build      # dist/admin + dist/agent/agentcrm.mjs + dist/version.json
node dist/agent/agentcrm.mjs help
```

## Contracts for parallel agents

The foundation is in place (`npm run typecheck`, `npm test`, `npm run build` pass). Build on these contracts; **don't change their
signatures** — add new optional fields / new exports instead. Each agent edits only its own folders (+ additive files in
`components/ui/` and new keys in its own i18n namespace).

| Agent | Owns |
|---|---|
| 1 Admin UI | `src/features/{records,dashboard,tasks,settings,search}/` |
| 2 Backends + setup + roles | `src/data/firebase.ts`, `src/data/gitJson.ts` (+ new `src/data/firebase/`, `src/data/gitJson/` helpers), `src/ops/firebaseRules.ts`, `src/features/setup/`, `docs/firebase.md` |
| 3 CLI + MCP + skills + hermes + docs | `agent/`, `plugin/`, `hermes/`, `scripts/{check-skills,build-hermes}.mjs`, `docs/` (except firebase.md) |
| 4 Automations / forms / integrations / assistant / reports | `src/ops/automations.ts`, `src/ops/forms.ts`, `src/features/{automations,forms,integrations,assistant}/` (reports charts belong to agent 1's dashboard; agent 4 may add report *ops* in new files) |

### Engine (`src/ops/`, `src/core/`, `src/data/`, `src/ai/`)

- **Context** — `src/ops/context.ts`: `OpsContext { store; user: CrmUser | null; now(); log?; plugins?: PluginRegistry; depth?: number }`
  (`user: null` = system context, all permissions; `depth` = automation nesting). `createOpsContext(store, user, opts?)`,
  `assertCan(ctx, action)`, `can(user, action)`, `PERMISSIONS` (admin/member/viewer matrix over `OpsAction`), `OpsError { code:
  "forbidden"|"notFound"|"validation"|"conflict"|"invalid"; details? }`, `emit(ctx, name, payload)`.
- **Ops** (all exported from `src/ops/index.ts`): `records.ts` (`listRecords`, `getRecord`, `getRecordDetails`, `searchRecords`,
  `createRecord`, `updateRecord`, `deleteRecord({hard})`, `restoreRecord`, `bulkUpdate`, `bulkDelete`, `setRecordOwner`,
  `prepareRecordFields`, `queryContext`), `relations.ts` (`inverseRelations`, `expandRelations`, `linkRecords`, `unlinkRecords`,
  `rewriteReferences`), `activities.ts` (`listActivities`, `addActivity`, `addNote`, `createTask`, `updateActivity`, `completeTask`,
  `deleteActivity`, `listTasks`, `lastActivityAt`, `timelineScope`), `pipelines.ts` (`listPipelines`, `createPipeline`,
  `updatePipeline`, `deletePipeline`, `moveStage`, `forecast`, `pipelineOfRecord`), `schema.ts` (`listObjects`, `describeSchema`,
  `createObject`, `updateObject`, `deleteObject`, `createField`, `updateField`, `changeFieldType`, `deleteField`, `reorderFields`,
  `addOption`, `updateOption`, `removeOption`), `views.ts`, `users.ts`, `settings.ts` (`getSettings`, `updateSettings`,
  `getConfigDoc`, `setConfigDoc` — refuses secrets), `importCsv.ts` (`parseCsv`, `suggestMapping`, `importCsv({dryRun})`),
  `exportCsv.ts` (`exportCsv`, `exportJson`, `importJson`), `dedupe.ts` (`findDuplicates`, `mergeRecords`), `reports.ts`
  (`pipelineByStage`, `wonLost`, `activityByUser`, `leadSources`, `staleDeals`, `conversion`, `REPORTS`, `runReport`), `stats.ts`
  (`getStats`), `seed.ts` (`seedCrm({admin, demo})`, `seedDemoData` — deterministic), `compact.ts` (`compactData`).
  **Stubs to implement (agent 4):** `automations.ts` (`runAutomationEvent`, `runScheduled`, `installAutomations`,
  `MAX_AUTOMATION_DEPTH`), `forms.ts` (`buildFormHtml`, `ingestInbox`) — keep the exported signatures.
- **Test helper** — `src/ops/testing.ts`: `setupTestCrm({demo?})` → `{ store, plugins, admin, as(role), clock }` (seeded memory
  store, isolated plugin registry, fixed `TEST_NOW`).
- **Plugin actions** — `src/core/pluginRegistry.ts`: `plugins` (default registry), `createPluginRegistry()`, typed
  `CrmActionPayloads` (`record.created|updated|deleted|restored`, `stage.changed`, `activity.created|updated|completed`); handlers
  receive `(ctx, payload)`.
- **Domain** — `src/core/types.ts` (exact CLAUDE.md model + `AutomationRun`, `CrmSettings`, `AddressValue`, `FIELD_TYPES`,
  `FILTER_OPS`, `ACTIVITY_TYPES`, `USER_ROLES`); `fields.ts` (`coerceFieldValue`, `validateRecordFields`, `formatFieldValue`,
  `isEmptyFieldValue`, `recordLabel`, `convertValue`, `OPTION_COLORS`, storage formats documented at the top); `query.ts`
  (`applyFilters`, `applySorts`, `paginate`, `groupRecords`, `resolveField`, `getRecordValue`; filter semantics documented at
  the top); `search.ts` (`buildSearchIndex`); `ids.ts` (`newId`, `seededId`, `slugId`); `hlc.ts`;
  `schema/standardObjects.ts` (`standardObjects`, `defaultPipeline`, `defaultViews`, `defaultViewFor`, `normalizeStandardFields`).
- **Data** — `src/data/types.ts` (DataStore API), `src/data/index.ts` (`getDataStore()`, `createDataStore(config, opts)`,
  `setDataStore`, `resetDataStore`, `browserBackendOptions`), `src/data/registry.ts` (`registerBackend(kind, factory)`,
  `BackendOptions { passphrase?, secrets?, clientId?, pollIntervalMs? }`), `src/data/core.ts` (`createStoreCore(backend)` with
  `StoreBackend { load, persist(mutations, before, after), poll?, watch?, identity, compact? }`, `snapshotFromDocs`),
  `memory.ts`, `local.ts`, `journal/` (`createJournalStore({ connector, root, encrypted, passphrase, clientId })`, `stats()`).
  **Stubs to implement (agent 2):** `src/data/firebase.ts` → `createFirebaseStore(config, opts)`, `src/data/gitJson.ts` →
  `createGitJsonStore(config, opts)` (already registered lazily in `data/index.ts`; build them on `createStoreCore`).
- **Runtime config** — `src/lib/runtimeConfig.ts`: `RuntimeConfig` union, `getRuntimeConfig`, `parseRuntimeConfig`,
  `saveLocalRuntimeConfig`, `setRuntimeConfigOverride` (CLI / tests), `buildConfigJsSource` (never secrets), secrets helpers
  `getSecret/setSecret`, `getConnectorSecrets/setConnectorSecrets`, `getPassphrase/setPassphrase`, `getGitToken/setGitToken`,
  `getHostingSecrets/setHostingSecrets`, `splitSecretSettings`, `forgetSecrets`, `datasetId`. The shell wires the siteFiles
  hosting target to `config/hosting` (`{ connectorId, settings }`, public part) + `getHostingSecrets(config)`.
- **Storage** — `src/shared/storage/registry.ts` (`instantiateStorageConnector(id, settings)`, `registerStorageConnector`,
  `setStorageConfigSource`), `testConnection.ts` (`testStorageConnection`, `missingFields(…, ["siteUrl"])` for data targets),
  `shared/siteFiles.ts` (hosting facade), `connectors/memory.ts` (`createMemoryConnector` for tests).
- **AI tools** — `src/ai/tools.ts`: `AiTool { name, description, inputSchema, mutating, handler(ctx, input) }`, `AI_TOOLS`,
  `findTool`, `callTool(ctx, name, input)`, `summarizeRecord`. MCP / assistant / `tools` CLI expose exactly `AI_TOOLS`.

### Admin shell (`src/app/`, `src/features/`, `src/components/ui/`)

- **Feature contract** — `src/features/types.ts`: `Feature { id, routes: FeatureRoute[], unconfiguredRoutes?, navItems?: NavItem[],
  i18n: { en, fr }, slots?: FeatureSlots, onStart?(env) }`. Slots: `topBar`, `recordDetailTabs`, `recordDetailPanels`,
  `recordActions`, `globalOverlays`, `settingsSections`, `dashboardWidgets`, `loginScreen`. Each `src/features/<id>/index.ts`
  default-exports its Feature; `src/features/index.ts` lists them (one import per feature — the only shared line).
  Read slots with `getSlot(name)` from `src/app/featureRegistry.ts`.
- **Routes / links** — `src/app/paths.ts` (`paths.objectList(objectId)`, `paths.record(objectId, recordId)`, `paths.settings(section)`,
  `recordHref`). Records routes: `/objects/:objectId`, `/objects/:objectId/:recordId` (owned by `features/records`); object nav
  entries are generated by the shell from the schema.
- **Shell events** — `src/app/shellEvents.ts`: `emitShellEvent` / `useShellEvent` (`"search.open"` from the top bar and Cmd+K,
  `"assistant.toggle"`, `"record.create"`).
- **Data hooks** — `src/app/CrmDataContext.tsx`: `useCrm()`, `useOps()`, `useCan(action)`, `useCurrentUser()`, `useCollection(name)`,
  `useDoc(name, id)`, `useObjects()`, `useObject(id)`, `useRecords(objectId)`, `useRecord(id)`, `useActivities(target?)`,
  `usePipelines(object?)`, `useViews(object)`, `useUsers()`, `useSettings()`, `useConfigDoc(id)`, `useAutomations()`,
  `useAutomationRuns()`, `useForms()`, `useRecordLabel()`, `useSearchIndex()`. Writes: call `src/ops/*` with `useOps()`.
- **Auth** — `src/app/AuthContext.tsx`: `useAuth()` → `{ backend, identity, user, role, isAdmin, canSignOut, signOut }`;
  `registerAuthAdapter(backend, { signOut })` for account backends. Identity → CrmUser mapping: `src/app/auth.ts`
  (`resolveCrmUser`). Boot order (App.tsx): `store.identity()` (null → `loginScreen` slot) → `store.ready()`
  (`PassphraseError` → built-in passphrase prompt) → empty dataset → install prompt → shell.
- **App control** — `useAppControl().reconfigure()` (from `src/app/App.tsx`) after the setup wizard saved a config.
- **UI kit** — `src/components/ui/index.ts`: `Button` (stable icon/spinner spans), `IconButton`, `Input`, `Textarea`, `Select`,
  `Label`, `FormField`, `Checkbox`, `Switch`, `Modal`, `Drawer`, `Portal`, `Popover`/`usePopover`, `Dropdown`/`MenuList`, `Tabs`,
  `Badge`, `Avatar`, `Tooltip`, `Spinner`, `EmptyState`, `Card`, `Kbd`, `PageHeader`, `Table`/`THead`/`TBody`/`Tr`/`Th`/`Td`,
  `ToastContainer`, `ConfirmDialog` + `confirmDialog()`, `FieldValue`, `FieldInput`, `ObjectIcon`/`OBJECT_ICONS`, color helpers
  (`chipClass`, `dotClass`, `chartColor`). Toasts: `toast.success/error/…` from `src/shared/lib/toast.ts`.
- **i18n** — `src/i18n/index.ts` (pure i18next; `registerI18nNamespace`, `setActiveLocale`, `intlLocale()`); core keys in
  `src/i18n/{en,fr}.json`; feature keys in `src/features/<id>/i18n/{en,fr}.json` → `useTranslation("<id>")`.
- **Dev loop** — `npm run dev`, pick "This browser" in the setup placeholder (optionally with demo data). The App smoke test
  (`src/app/App.test.tsx`) boots the whole shell under happy-dom — keep it green.

### Deviations from the sections above (kept intentionally)

- `runtimeConfig.ts` lives in `src/lib/` (as in cms-ia), not `src/shared/`.
- `OpsContext` has two extra optional fields (`plugins`, `depth`); `user: null` means system context.
- Deals carry a `pipeline` select field next to `stage`; both selects mirror the pipelines (`ops/pipelines.ts` keeps them in sync,
  stage ids are unique across pipelines). Moving a deal sets its probability to the stage's.
- Journal segments are named `journal/<hlc>.bin` where the HLC already ends with the client id (`<wall>-<counter>-<clientId>`);
  `keyinfo.json` also stores the PBKDF2 iteration count and an encrypted check value (wrong passphrase detected up front).
  Concurrent compactions are safe-ish: only the client whose snapshot is in place deletes segments; run compaction from one place.
- `tsconfig.agent.json` keeps the DOM lib (same as cms-ia: the CLI reuses browser-written modules).
- The AI catalog has one extra tool, `log_activity` (calls / emails / meetings).
