# Data model

AgentCRM is metadata-driven (like Twenty): every business entity is a **record of an object**; the standard objects are pre-seeded object definitions you can extend. Types live in `src/core/types.ts`.

## Objects and fields

```ts
interface ObjectDef { id: string /* "companies" */; labelSingular; labelPlural; icon; color; standard: boolean; labelField: string;
  imageField?: string /* image field shown as the record avatar */; fields: FieldDef[] }
interface FieldDef { id; label; type: FieldType; required?; unique?; standard?; system?; hidden?; options?: SelectOption[]; currency?;
  relation?: { object: string; cardinality: "one" | "many"; inverseField?: string }; defaultValue?;
  drilldown?: { object: string; field: string };
  rollup?: { object: string; via: string; field: string; scope?: { field: string; via: string }; where?: Filter[] } }
```

`drilldown` turns a value (typically a count) into a link to another object's list filtered on the current record: `{ object: "companies", field: "markets" }` on a market's `operatorCount` opens `#/objects/companies?filter=markets:in:<marketId>`. `field` must be a relation of `object` pointing at this object. The list page applies `?filter=field:op:value` (repeatable) on top of the view, shows it in a banner and never saves it with the view.

`rollup` marks a value that rolls up a field of child records: `{ object: "operator-markets", via: "operator", field: "statusLabel", scope: { field: "markets", via: "market" }, where: [{ field: "archived", op: "neq", value: true }] }` on an operator's Status. The stored value (written by whoever syncs it) covers every child. While a list is filtered on `scope.field` (eq / in / contains), the list recomputes the rollup from the children whose `scope.via` matches, so cells, the other filters and the sorts all see the values for the filtered markets; the list header names the narrowed fields. Values take the field's type: options in option order (select / multiSelect), distinct tags or ids, a sum for numbers, distinct text joined.

Field types: `text`, `longText`, `number`, `currency`, `percent`, `date`, `datetime`, `boolean`, `select`, `multiSelect`, `email`, `phone`, `url`, `relation`, `user`, `rating`, `address`, `tags`, `image` (one file: photo / logo), `files` (several files).

Storage formats: dates `YYYY-MM-DD`, datetimes epoch ms, currency a number in the field's currency, select the option id, multi values arrays, relations the target id (`one`) or an id array (`many`), `image` a file id, `files` an array of file ids (see [files.md](files.md)). Inverse relations (a company's people) are computed, never stored twice.

## Standard objects (seeded at install)

| Object | Fields |
|---|---|
| `companies` | name, domain, industry, employees, annualRevenue, address, linkedin, phone, tags, logo (image — the object's image field) |
| `people` | firstName, lastName, name, email, phone, jobTitle, company → companies, city, linkedin, lifecycleStage (subscriber / lead / mql / sql / opportunity / customer / evangelist), leadSource, tags, avatar (image, "Photo") |
| `deals` | name, amount, stage, pipeline, closeDate, probability, company → companies, contacts → people (many), lostReason |

Workspaces created before 0.3.0 get `logo` / `avatar` (and `imageField`) added once, on the next admin boot or writing CLI session (`src/ops/migrate.ts`, additive and idempotent).

Default pipeline **Sales**: New → Qualified → Proposal → Negotiation → Won / Lost, each stage with a probability and a kind (`open` / `won` / `lost`). Moving a deal sets its probability.

## Other collections

| Collection | Content |
|---|---|
| `records` | `{ id, object, fields, ownerId?, createdAt, updatedAt, createdBy?, updatedBy?, deletedAt? }` |
| `activities` | notes, tasks, calls, emails, meetings: `{ type, title, body?, targets[], dueAt?, doneAt?, assigneeId?, meta?, attachments?: fileId[] }` |
| `files` | file metadata `{ name, mime, size, width?, height?, thumbId?, sha256, targets: { kind: record / activity, object?, id }[], deletedAt? }` — bytes in the backend's file storage ([files.md](files.md)) |
| `pipelines` | `{ object, name, stageField, stages[] }` |
| `views` | saved table / kanban views: columns, filters, sorts, groupBy, shared |
| `users` | `{ email, name, role: admin / member / viewer, disabled? }` |
| `automations`, `automationRuns` | see [automations.md](automations.md) |
| `forms` | lead capture forms |
| `settings` | `general`: name, currency, locale, timezone, staleDealDays, maxUploadMb… |
| `config` | public config docs (`hosting`: where the admin / forms are published) — never secrets |

## Roles

| Role | Can |
|---|---|
| `admin` | everything: schema, pipelines, settings, users, automations, forms, compaction |
| `member` | read; create / update / delete records and activities; own views; import / export; run automations |
| `viewer` | read only |

Enforced in `src/ops/context.ts` (`assertCan`) for every front door, and by Firestore rules in Firebase mode.

## Storage

- **Journal** (`src/data/journal/`): `<root>/keyinfo.json` (public KDF params), `<root>/snapshot.bin` (encrypted merged state), `<root>/journal/<hlc>.bin` (one encrypted batch per write, never rewritten). Reads merge segments per field with last-writer-wins on hybrid logical clocks. `compact` writes a new snapshot and deletes merged segments — the physical purge of deleted records. Files: `<root>/files/<id>.bin`, encrypted with the same key; `compact` also erases the bytes of deleted / orphan files.
- **git-json**: one JSON file per document in a private repo, one commit per write; file bytes in `files/<id>.bin`.
- **Firebase**: one Firestore collection per collection, real-time listeners; file bytes in Firebase Storage (`files/<id>`).
- **local**: IndexedDB in one browser (file bytes in the `agentcrm-local-files` database).

`package.json → agentcrm.dataSchema` is the stored format version; an admin never downgrades below it.
