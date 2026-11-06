---
name: data-model-internals
description: Contributor notes for the AgentCRM data-model features built on top of the record engine — schema as code (src/ops/schemaApply.ts, `schema apply`), mirroring an external source (src/ops/syncRecords.ts, `records sync`), drilldown fields and the `?filter=` list parameter, rollup fields and scoped rollups (src/features/records/lib/viewModel.ts), URL image fields, per-field write stamps (`fieldUpdates`), and per-user view layouts (`users/<id>.prefs`, setUserPrefs). Invoke when changing any of those, adding a field-level feature to FieldDef / CrmRecord / CrmUser, or adding a code path that writes records in this repository.
---

# Data-model features — contributor notes (this repo)

Read [CLAUDE.md](../../../CLAUDE.md) ("Data model", "Data model additions", "Ops layer contract") and [AGENTS.md](../../../AGENTS.md) ("Engine invariants") first. User-facing reference: [docs/data-model.md](../../../docs/data-model.md) (field options, `fieldUpdates`, `prefs`), [docs/cli.md](../../../docs/cli.md) (`schema apply`, `records sync`). Don't commit unless asked. For the CLI plumbing (plans, `dryRun`, sessions) see [`agent-cli-internals`](../agent-cli-internals/SKILL.md); for Firestore rules and the incremental store see [`firebase-internals`](../firebase-internals/SKILL.md).

## Where things live

| Feature | Engine | Front doors | Tests |
|---|---|---|---|
| Schema as code | `src/ops/schemaApply.ts` (`parseSchemaSpec`, `applySchema` → `{ changes, conflicts, extraFields }`) over `schema.ts` / `pipelines.ts` / `views.ts` ops | `agentcrm schema apply <file\|-> [--yes]` (`agent/commands/schema.ts`, `schemaCommand`) | `src/ops/schemaApply.test.ts` |
| Records sync | `src/ops/syncRecords.ts` (`syncRecords(ctx, { object, key, rows, archiveField?, refKey? })` → `SyncReport`) | `agentcrm records sync --object --key --rows <json\|@file\|-> [--archive-field] [--ref-key] [--yes]` (`agent/commands/records.ts`) | `src/ops/syncRecords.test.ts`, `agent/cli.test.ts` (subcommand list) |
| Drilldown fields | `FieldDef.drilldown` (`src/core/types.ts`), validated by `checkDrilldown` in `src/ops/schema.ts` | `FieldValue` (`recordId` prop) → `FieldContextValue.listHref` → `listHref()` in `src/app/paths.ts`; `?filter=field:op:value` parsed by `parseLinkFilter` in `src/features/records/ObjectListPage.tsx` | `src/ops/schemaApply.test.ts` (validation through apply); no UI test of the link yet |
| Rollups | `FieldDef.rollup`, `checkRollup` in `src/ops/schema.ts`; stored value written by whoever syncs it | `scopeRollups` / `rollupValue` in `src/features/records/lib/viewModel.ts`, used by `ObjectListPage` | `src/features/records/lib/scopeRollups.test.ts` |
| URL image fields | `updateObject` accepts an `image` or `url` field as `imageField`; `recordImageId` / `isImageUrl` in `src/ops/files.ts` | `FileAvatar` (`src/components/ui/files/RecordAvatar.tsx`) shows an `https://` value as is; `RecordAvatarEditor` | `src/ops/schemaApply.test.ts` (`imageField` on a URL field), `src/ops/files.test.ts` |
| fieldUpdates | `creationStamps` + `recordPatchMutation` in `src/ops/records.ts`, `patchFieldMutation` in `relations.ts`, `mergeRecords` in `dedupe.ts` | `recordOut` in `agent/commands/records.ts` prints `createdBy`, `updatedBy`, `fieldUpdates` (ISO dates, limited to `--columns`) | `src/ops/records.test.ts` |
| View prefs | `setUserPrefs` + `PREFS_MAX_BYTES` (64 KB) in `src/ops/users.ts`; types `UserPrefs` / `ViewPrefs` | `src/features/records/lib/userPrefs.ts` (`mergePrefs`, `applyViewPrefs`, `layoutOverrides`, `applyPrefsPatch`; `localStorage` key `agentcrm.prefs.<userId>`, CRM write debounced 800 ms), `lib/hooks.ts`, `DataGrid` widths | `src/ops/users.test.ts`, `src/features/records/lib/userPrefs.test.ts`, `src/features/records/records.test.tsx` (layout + last view across reloads) |

`schemaApply.ts` and `syncRecords.ts` are **not** re-exported by `src/ops/index.ts`: the CLI imports them directly, so they are not part of the extension runtime's `ops`. Neither has an AI tool; adding one goes in `src/ai/` (see `agent-cli-internals`).

## Invariants

**Record writes and `fieldUpdates`**

- Every record write by a known actor (`actorId(ctx)`) stamps `updatedBy` and `fieldUpdates.<fieldId> = { by, at }` for each field it changes; `createRecord` stamps every prepared field. Use `createRecord` / `recordPatchMutation` (also exported for batch ops) instead of hand-built `records` mutations; if you must build one, stamp it the same way (`fieldUpdates.<id>` as a dot path in a `patch`, so the journal's per-field LWW and Firestore `update` keep teammates' stamps).
- The system context (`user: null`, maintenance, migrations, `demoFiles`, schema type conversions) writes no stamps — on purpose.
- Records created by hand (not through `createRecord`: `importCsv`, its auto-created companies, `syncRecords`) spread `creationStamps(ctx, fields, now)` from `records.ts` — `createdBy`, `updatedBy`, `fieldUpdates` for every field, nothing for the system context. A new hand-built creation must do the same (tests: `importExport.test.ts`, `syncRecords.test.ts`).

**`records sync`**

- One `store.write()` for the whole run, diff-only (`prepareRecordFields(...).changed` empty → `unchanged`), **no plugin actions** (no `emit`): a bulk mirror is not user activity and must not fire automations. Keep it that way; a sync that should trigger work is a separate `automations run`.
- Never deletes: a key that left the source sets the boolean `archiveField` to `true` (and back to `false` when it returns); without `archiveField` such records are left alone. Notes, tasks and deals may hang on them.
- Relations reference other mirrored records by **their** key (`{ "$key": "12" }`, `{ "$key": ["12","13"] }`, resolved on `refKey`, default = `key`); an unmatched key leaves that relation untouched on that row (`many`: one unmatched key keeps the whole existing value — never a partial list, never a clear) and is reported in `unresolved` (count) and `unresolvedRefs` (`{ key, field, refs }`); an explicit `null`, `{ "$key": [] }` or `{ "$key": "" }` clears (sync the parent object first). Unknown fields are errors (`unknownFields: "error"`), reported per row in `errors`, never thrown for the whole run. Last row wins for a duplicated key.
- The CLI plans on an in-memory copy (`dryRun`) and answers `needsConfirmation` only when something would change.

**`schema apply`**

- Additive and idempotent: applying the same spec twice must report no change (`upToDate: true` in the CLI). Compare through `same()` (key-order-insensitive, `undefined` ≈ `null`): Firestore returns map keys in its own order.
- Never: delete an object / field / view, change a field type (→ `conflicts`; `fields update --type` migrates values), remove a select option (stored values are option ids; options are matched **by label**, case-insensitive; `{ label, color }` recolours in place), remove a pipeline stage (it would move records), rename a taken stage id (stage ids are unique across pipelines → `conflicts`). Custom fields missing from the spec → `extraFields`, untouched.
- Atomic: `applySchema` runs its phases (`applyPhases`) through `runStaged` (`src/ops/staged.ts`) — on an in-memory copy, mutations recorded and replayed on the real store in **one** `store.write()`; an error in any phase writes nothing (test in `schemaApply.test.ts`). The schema ops it calls emit no plugin action (the staged context has an isolated registry); keep it that way or emit after the replay.
- Order matters: objects (new objects created without relation fields), then fields (relations can now target objects of the same spec), then `labelField` / `imageField`, then drilldowns / rollups (they point at fields of other objects), then pipelines, then views (matched by object + **name**).
- A new `FieldDef` / `ObjectDef` key the spec should carry: add it to `ObjectSpec` / `FieldInput`, to `fieldPatch` (or the last pass if it references other objects), and to `parseSchemaSpec` validation, with a test proving the second apply is a no-op.

**Drilldowns and rollups**

- `drilldown: { object, field }`: `field` must be a relation of `object` pointing at this field's object (`checkDrilldown`). The link is `#/objects/<object>?filter=<field>:in:<recordId>`; link filters are added to the view's filters, shown in a banner and never saved with the view.
- `rollup: { object, via, field, scope?, where? }`: `via` is the child's relation to this object, `scope.field` (relation of this object) and `scope.via` (child relation) must target the same object (`checkRollup`). The engine never computes the stored value: it covers every child and is written by the source (typically `records sync`). Only the list page recomputes it, and only while a complete filter on `scope.field` is active; it also narrows the scope relation. `scoped` / `narrowed` columns are read-only inline (an edit would save the scoped value as if it were the stored one). `rollupValue` keeps the field's type: options in option order (child select values matched **by label**), distinct tags / ids, sums for numbers, distinct text joined.
- `scopeRollups` is pure (records + objects in, records out): test it in `scopeRollups.test.ts`, not through the page.

**URL image fields**

- An `imageField` value is either a file id or an `https://` URL; `recordImageId` returns `undefined` for URLs (no file behind them). Anything that resolves a record image must go through `recordImageId` / `isImageUrl`, never assume a file id. Only `https:` URLs count (same rule as `Markdown` images).

**View prefs**

- `setUserPrefs` acts on `ctx.user` only (any role; `notFound` for a non-CRM user), merges per view / per object with dot paths `prefs.views.<viewId>` (`null` removes a layout), validates ids (`^[A-Za-z0-9_-]{1,120}$`) and requires `at` on each layout. When `prefs` does not exist yet it writes the whole object (dot paths need the parent on every backend). Over 64 KB the oldest layouts (`at`) are dropped.
- `prefs` never changes the saved view: Save still updates the view for everyone, Reset returns to it. The newest copy (`at`) wins between the CRM and the browser.
- Firestore rules let a user write **only** `name`, `avatarUrl`, `prefs`, `updatedAt`, `_ts` of their own `users/{uid}` (`firebaseRules.ts`); a new self-writable key needs the rule, `crmRulesModel` in `src/data/firebase/memoryApi.ts`, an emulator scenario and a `changelog.json` action (re-publish the rules). Until users re-publish, a refused CRM write is swallowed and the browser copy stands. git-json keeps the browser copy only (`store.kind !== "git-json"`: one commit per layout change would be too costly).

## Checks before handing over

```bash
npm run typecheck
npx vitest run src/ops/schemaApply.test.ts src/ops/syncRecords.test.ts src/ops/records.test.ts src/ops/users.test.ts src/ops/schema.test.ts
npx vitest run src/features/records          # scopeRollups, userPrefs, records.test.tsx
npx vitest run agent/cli.test.ts agent/e2e-local.test.ts   # when a command / option changed
# + the firebase-internals emulator harness when a users/ rule changed
```

A changed command, option or output field also updates `docs/cli.md`, `docs/data-model.md` and the distributed skills (`plugin/skills/agentcrm-admin/references/schema.md`, `records.md`), then `npm run hermes:build` (see AGENTS.md).
