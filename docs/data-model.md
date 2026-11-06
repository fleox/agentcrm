# Data model

AgentCRM is metadata-driven (like Twenty): every business entity is a **record of an object**; the standard objects are pre-seeded object definitions you can extend. Types live in `src/core/types.ts`.

## Objects and fields

```ts
interface ObjectDef { id: string /* "companies" */; labelSingular; labelPlural; icon; color; standard: boolean; labelField: string;
  imageField?: string /* image or URL field shown as the record avatar */; fields: FieldDef[] }
interface FieldDef { id; label; type: FieldType; required?; unique?; standard?; system?; hidden?; options?: SelectOption[]; currency?;
  relation?: { object: string; cardinality: "one" | "many"; inverseField?: string }; defaultValue?;
  drilldown?: { object: string; field: string };
  rollup?: { object: string; via: string; field: string; scope?: { field: string; via: string }; where?: Filter[] } }
```

Objects and fields are created in Settings → Data model, with `objects` / `fields` commands, or declared in a file and applied with [`schema apply`](schema-as-code.md).

**Record image** — `imageField` names the field shown as the record's avatar / logo (record header, tables, kanban cards, relation chips, search). It is an `image` field (a stored file, see [files.md](files.md)) or, since 0.7.0, a `url` field: an `https://` image hosted elsewhere (a logo CDN) is displayed as is, with no file storage and no upload; when it fails to load the initials are shown. A URL image is edited like any URL field (the crop / upload menu only applies to `image` fields).

### Drilldown and rollup fields

`drilldown` turns a value (typically a count) into a link to another object's list filtered on the current record: `{ object: "companies", field: "markets" }` on a market's `operatorCount` opens `#/objects/companies?filter=markets:in:<marketId>`. `field` must be a relation of `object` pointing at this object. The list page applies `?filter=field:op:value` (repeatable) on top of the view, shows it in a banner and never saves it with the view.

`rollup` marks a value that rolls up a field of child records (`via` = the child's relation to this object, `field` = the child field collected, `where` = which children count, `scope` = a relation of this object paired with the child's relation to the same target): `{ object: "operator-markets", via: "operator", field: "statusLabel", scope: { field: "markets", via: "market" }, where: [{ field: "archived", op: "neq", value: true }] }` on an operator's Status. The engine never computes the stored value: whoever maintains the data writes it (typically a [`records sync`](sync.md) job), and it covers every child. Both are validated when set (`fields update --data`, `schema apply`): the relations they name must exist and point the right way. While a list is filtered on `scope.field` (eq / in / contains), the list recomputes the rollup from the children whose `scope.via` matches, so cells, the other filters and the sorts all see the values for the filtered markets; the scope relation itself shows the filtered markets only, the list header names the narrowed fields and those columns are not editable inline while the filter is on. Values take the field's type: options in option order (select / multiSelect; a child select is read by its option labels, so parent and child options only need the same labels), distinct tags or ids, a sum for numbers, distinct text joined. Other operators on the scope relation (`neq`, `notIn`, `empty`…) select parents without narrowing: the rollup is then recomputed from all of the record's children (those matching `where`).

**Link filters** — any list page accepts `?filter=field:op:value` (repeatable, same ops as the CLI; `in` / `notIn` values comma-separated), e.g. `#/objects/people?filter=lifecycleStage:eq:customer&filter=city:contains:Paris`. Fields must be fields of the object (not `ownerId` / `createdAt`); unknown fields or operators are ignored. A link filter also narrows rollups like a filter of the view.

Field types: `text`, `longText`, `number`, `currency`, `percent`, `date`, `datetime`, `boolean`, `select`, `multiSelect`, `email`, `phone`, `url`, `relation`, `user`, `rating`, `address`, `tags`, `image` (one file: photo / logo), `files` (several files).

Storage formats: dates `YYYY-MM-DD`, datetimes epoch ms, currency a number in the field's currency, select the option id, multi values arrays, relations the target id (`one`) or an id array (`many`), `image` a file id, `files` an array of file ids, `url` a string (an `https://` URL when it is the image field) (see [files.md](files.md)). Inverse relations (a company's people) are computed, never stored twice.

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
| `records` | `{ id, object, fields, ownerId?, createdAt, updatedAt, createdBy?, updatedBy?, fieldUpdates?, deletedAt? }` — `fieldUpdates.<fieldId>` = `{ by: userId, at }`, who last wrote that field (`updatedBy` names the last writer of the whole record); `records list / get --json` print `createdBy`, `updatedBy` and `fieldUpdates` |
| `activities` | notes, tasks, calls, emails, meetings: `{ type, title, body?, targets[], dueAt?, doneAt?, assigneeId?, meta?, attachments?: fileId[] }` |
| `files` | file metadata `{ name, mime, size, width?, height?, thumbId?, sha256, targets: { kind: record / activity, object?, id }[], deletedAt? }` — bytes in the backend's file storage ([files.md](files.md)) |
| `pipelines` | `{ object, name, stageField, stages[] }` |
| `views` | saved table / kanban views: columns, filters, sorts, groupBy, shared — each user's unsaved changes are kept in their `users.prefs` |
| `users` | `{ email, name, role: admin / member / viewer, disabled?, prefs? }` — `prefs`, written by the user only: `views.<viewId>` = their own layout of that list (filters, sorts, columns, type / groupBy, column widths, `at`) laid over the saved view without changing it, and `lastView.<objectId>` = `{ id, at }`, the view reopened next time. The newest copy wins between devices; the browser keeps one too (`localStorage`), the only one on git-json |
| `automations`, `automationRuns` | see [automations.md](automations.md) |
| `forms` | lead capture forms |
| `settings` | `general`: name, currency, locale, timezone, staleDealDays, maxUploadMb… |
| `config` | public config docs (`hosting`: where the admin / forms are published, `modules`, `appearance`) — never secrets |
| `extensions` | installed extension packages ([extensions.md](extensions.md)) |
| `deletions` | Firebase only: tombstones `{ collection, id, _ts }` (`deletions/{collection}__{id}`), written in the same batch as every delete so cached copies drop the document ([firebase.md](firebase.md#costs)) |

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
- **Firebase**: one Firestore collection per collection; every write stamps a server time `_ts` (never visible in the CRM documents) and every delete leaves a tombstone in `deletions`, so clients keep a local copy and read / listen to changed documents only. File bytes in Firebase Storage (`files/<id>`) or an HTTP files endpoint ([files.md](files.md#http-files-endpoint-firebase-without-firebase-storage)).
- **local**: IndexedDB in one browser (file bytes in the `agentcrm-local-files` database).

`package.json → agentcrm.dataSchema` is the stored format version; an admin never downgrades below it.
