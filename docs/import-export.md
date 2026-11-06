# Import & export

## CSV import

Admin: Settings → Import, or any list page. CLI:

```bash
agentcrm import csv leads.csv --object people --site acme            # dry run (default)
agentcrm import csv leads.csv --object people --site acme --yes      # apply
```

1. **Parsing** — delimiter detected (`,` `;` tab) or forced with `--delimiter`; BOM and quoted fields handled.
2. **Mapping** — headers are matched to field ids / labels (`E-mail` → `email`, `Company` → `company`…). Override with `--map '{"Header":"fieldId"}'` or `--map "Header=fieldId,Other=fieldId"`. Special targets: `$id` (update the record with this id), `$owner` (owner by user email / name), `""` (skip).
3. **Coercion** — numbers (`1 200,50`, `$1,200`), dates (ISO; `--day-first` for `DD/MM/YYYY`), booleans, multi values (`,` `;` `|`), select values by label (unknown labels become new options unless `--no-create-options`), relations by label / domain (missing companies are created).
4. **Dedupe** — people by email, companies by domain, other objects by their label field. `--dedupe update` (default) fills the existing record; `skip`; `create`.
5. **Report** — `total`, `created`, `updated`, `skipped`, `failed`, the effective `mapping`, `unmappedColumns`, `newOptions`, `createdRelated`, and `rows[]` with each row's action and messages. Nothing is written until `--yes`.

The AI tool `import_csv` does the same and is a dry run unless `confirm: true`.

## Recurring mirrors: `records sync`, not `import csv`

`import csv` is for loading a list once (leads from an event, a spreadsheet of companies): it matches people by email and companies by domain, creates missing options and related companies, and fires automations for every record. To keep an object **in line with another system** on a schedule, use [`records sync`](sync.md): rows `{ key, fields }` matched on a source-id field, patches only where a value differs (a second run writes nothing), relations by source key, records that left the source flagged in an archive field instead of deleted, one write for the whole batch and no automation. CSV data can be turned into sync rows with any CSV-to-JSON tool (`mlr --icsv --ojson`, `jq`, a few lines of script).

The data model itself (objects, fields, options, pipelines, views) can be kept as a file too: [schema-as-code.md](schema-as-code.md).

## CSV export

```bash
agentcrm export csv --object companies --site acme --out companies.csv
agentcrm export csv --object deals --filter stage:eq:won --columns name,amount,closeDate --raw
```

Labels by default (option labels, related record names, formatted numbers); `--raw` exports stored values. The first column is the record id, so re-importing the file updates the same records.

## JSON export (backup / migration)

```bash
agentcrm export json --site acme --out backup.json
agentcrm export json --site acme --collections records,activities --out partial.json
```

The whole dataset as plain JSON: keep it somewhere safe — it is NOT encrypted. To move a CRM to another backend, export JSON, install the new CRM, and load it with the `importJson` op (admin Settings → Import, where available).
