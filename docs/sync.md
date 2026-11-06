# Mirroring an external source (`agentcrm records sync`)

`records sync` keeps one object of the CRM in line with another system: a back office, a product database, a public registry, a spreadsheet export. Each run sends the current rows of the source; AgentCRM creates the new ones, patches only the values that changed, links records to each other by their source ids, and flags (never deletes) the records that left the source. A second run with the same rows writes nothing.

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.0 records sync --object operators --key sourceId --rows @operators.json --archive-field archived --site acme         # plan
npx -y @fleox-agent-crm/agentcrm@0.12.0 records sync --object operators --key sourceId --rows @operators.json --archive-field archived --site acme --yes   # apply
```

Engine: `src/ops/syncRecords.ts` (`syncRecords(ctx, spec)`); needs `records.write` (member or admin).

## `records sync` or `import csv`?

| | `import csv` ([import-export.md](import-export.md)) | `records sync` |
|---|---|---|
| Input | a CSV file, columns mapped to fields | JSON rows `{ key, fields }` with field ids |
| Matching | people by email, companies by domain, others by label; or `$id` | one key field holding the source system's id |
| Existing records | fill / update / skip / create (`--dedupe`) | patched only where a value differs; a second identical run writes nothing |
| Relations | by label / domain, missing companies created | by the related record's source key (`{ "$key": … }`), nothing created |
| Records gone from the source | untouched | flagged in a boolean `--archive-field` (never deleted) |
| Select values | unknown labels become new options (unless `--no-create-options`) | must exist (unknown label = row error) |
| Automations | fire for every created / updated record | **none fire** (bulk mirror, not user activity) |
| Writes | one per row | **one write for the whole batch** (one journal segment, one git commit, Firestore batches of 500) |
| Use it for | a one-off load of a list of leads | a recurring mirror, typically on a schedule |

## Rows

`--rows` takes a JSON array, `@file.json` or `-` (stdin):

```json
[
  { "key": "op-1", "fields": { "name": "Acme Bet", "logoUrl": "https://logos.example.com/acme.png",
                               "markets": { "$key": ["FR", "DE"] }, "licenceCount": 2 } },
  { "key": "op-2", "fields": { "name": "Nordic Play", "markets": { "$key": ["SE"] } } }
]
```

- `key` is the source id. It is written to the `--key` field (a text field, ideally `unique`) and matched against it as a string. Rows with an empty key are ignored; when a key appears twice, the last row wins.
- `fields` uses field ids (`agentcrm objects get <object>`), with the same values as `records create`: select options by id or label, dates `YYYY-MM-DD`, numbers, booleans, arrays for multi values. An unknown field id or an invalid value is an **error for that row** (listed in `errors`); the other rows are still written.
- Only the fields a row lists are written. Fields the source doesn't send (an owner, a note field, tags your team adds) are never touched, so the team can enrich mirrored records. A field the source does send is overwritten on every run where it differs: the source wins for those fields. Send `null` to clear a value.
- **Relations by key**: a relation value `{ "$key": "FR" }` (cardinality one) or `{ "$key": ["FR", "DE"] }` (many) is resolved against the key field of the related object. That field id is `--ref-key` (default: the same id as `--key`) and is the same for every relation of the run — give every mirrored object the same key field id (`sourceId`). A reference whose key matches no record leaves that relation **as it is** on that row (for a `many` relation, one unknown key is enough: the whole value is kept, never a partial list) and is reported: `unresolved` counts the keys, `unresolvedRefs` lists them as `{ key, field, refs }` (row key, relation field, unknown keys). The rest of the row is still written. To clear a relation, send it explicitly empty: `null`, `{ "$key": [] }` or `{ "$key": "" }`. **Sync the referenced objects first** (markets before operators before licences).
- Soft-deleted records don't match: a key whose record was deleted is created again.

## Archive instead of delete

With `--archive-field <boolean field>`, every record of the object that has a key and whose key is **not** in the rows is set to `true` in that field, and set back to `false` when its key comes back. Records are never deleted by a sync: notes, tasks, deals and files attached to them stay. Hide archived records with a view filter (`archived neq true`), and delete them by hand (or `records delete`) when you really want them gone. Without `--archive-field`, records missing from the rows are left alone — so the rows must be the **complete** source each run when you use it.

## Report

Plan (no `--yes`): the sync runs on an in-memory copy and returns `{ "needsConfirmation": true, "plan": <report> }`; when nothing would change (everything `unchanged`), it returns the report directly. With `--yes`:

```json
{ "ok": true, "data": {
  "object": "operators", "rows": 2,
  "created": 1, "updated": 1, "unchanged": 0, "archived": 1, "unresolved": 1,
  "unresolvedRefs": [{ "key": "op-2", "field": "markets", "refs": ["SE"] }],
  "errors": [{ "key": "op-9", "message": "Status: \"Bogus\" is not one of Live, Pending, Closed." }],
  "samples": { "created": ["op-2 Nordic Play"], "updated": [{ "key": "op-1", "fields": ["name", "markets"] }], "archived": ["op-7 Old Casino"] }
} }
```

`samples` holds up to 10 items of each kind. The text output is one line: `operators: 2 rows → 1 new, 1 updated, 0 unchanged, 1 archived, 1 unresolved references (relation kept; first: op-2.markets → SE), 1 errors (first: op-9: …)`. Errors and unresolved references don't change the exit code (0): check `errors` and `unresolvedRefs` in scripts.

## Who changed what

Writes made by a sync are stamped with the CLI user (the site's `--user`, or `--as`): patches set `updatedBy` and `fieldUpdates.<fieldId> = { by, at }` for the fields they change; records created by a sync carry `createdBy`, `updatedBy` and a `fieldUpdates` stamp for every field they are created with, like a record created in the admin. `records list` / `records get` print them, so you can tell a value the source wrote from one a teammate edited:

```bash
agentcrm records get <id> --json   # … "updatedBy": "u_sync", "fieldUpdates": { "name": { "by": "u_sync", "at": "2026-11-06T12:18:43.996Z" } }
```

Tip: add a dedicated CRM user for the job (`agentcrm users add --email sync@acme.com --role member`) and register the site with `--user sync@acme.com` on the machine that runs it.

## Recipes

### A full mirror of three related objects

```bash
# 1. the model (once, or whenever it changes) — see schema-as-code.md
agentcrm schema apply crm-schema.json --site acme --yes

# 2. parents first, children last; the same key field id (sourceId) everywhere
agentcrm records sync --object markets   --key sourceId --rows @markets.json   --archive-field archived --site acme --yes --json
agentcrm records sync --object operators --key sourceId --rows @operators.json --archive-field archived --site acme --yes --json
agentcrm records sync --object licences  --key sourceId --rows @licences.json  --archive-field archived --site acme --yes --json
```

### Rows from an API with `jq`

```bash
curl -fsS https://backoffice.example.com/api/operators \
  | jq '[.[] | { key: (.id | tostring), fields: {
        name: .name,
        logoUrl: .logo_url,
        markets: { "$key": [.markets[].iso] },
        licenceCount: (.licences | length) } }]' \
  | agentcrm records sync --object operators --key sourceId --rows - --archive-field archived --site acme --yes --json
```

### Counts and rollups computed by the source

A `drilldown` count (a market's `operatorCount`) and the stored value of a `rollup` field are plain values: compute them in the job and send them as fields. While a list is filtered on a rollup's scope, the admin recomputes it from the children itself ([data-model.md](data-model.md#drilldown-and-rollup-fields)); the stored value is what every other screen shows.

### On a schedule (GitHub Actions)

Copy into `.github/workflows/agentcrm-sync.yml` of a **private** repository holding `crm-schema.json` and the script that produces the rows. Secrets as in the [cron template](templates/agentcrm-cron.yml) (`AGENTCRM_RUNTIME` = the object of the admin's `config.js`, the data credential, the passphrase), plus whatever your source needs.

```yaml
name: AgentCRM sync

on:
  schedule:
    - cron: "41 */6 * * *" # every 6 hours (UTC)
  workflow_dispatch: {}

permissions:
  contents: read

concurrency:
  group: agentcrm-sync
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      AGENTCRM_HOME: ${{ runner.temp }}/agentcrm
      AGENTCRM_RUNTIME: ${{ secrets.AGENTCRM_RUNTIME }}
      AGENTCRM_S3_KEY_ID: ${{ secrets.AGENTCRM_S3_KEY_ID }}
      AGENTCRM_S3_SECRET: ${{ secrets.AGENTCRM_S3_SECRET }}
      AGENTCRM_PASSPHRASE: ${{ secrets.AGENTCRM_PASSPHRASE }}
      SOURCE_TOKEN: ${{ secrets.SOURCE_TOKEN }}
      CLI: npx -y @fleox-agent-crm/agentcrm@0.12.0
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Credentials (from repository secrets, never printed)
        run: |
          $CLI credentials set s3:data --from-env AGENTCRM_S3_KEY_ID,AGENTCRM_S3_SECRET --json > /dev/null
          $CLI credentials set passphrase:crm --from-env AGENTCRM_PASSPHRASE --json > /dev/null

      - name: Register the CRM
        run: |
          $CLI site add crm --runtime "$AGENTCRM_RUNTIME" \
            --data-credential s3:data --passphrase-credential passphrase:crm \
            --user sync@acme.com --json

      - name: Data model
        run: $CLI schema apply crm-schema.json --site crm --yes --json

      - name: Fetch the source
        run: ./scripts/export-source.sh   # writes markets.json, operators.json, licences.json

      - name: Mirror (parents first)
        run: |
          for object in markets operators licences; do
            $CLI records sync --object "$object" --key sourceId --rows "@$object.json" \
              --archive-field archived --site crm --yes --json > "report-$object.json"
            jq -e '.ok and (.data.errors | length == 0)' "report-$object.json" > /dev/null \
              || { cat "report-$object.json"; exit 1; }
          done
```

`site add` opens the data to prove the credentials. The job fails when a sync reports row errors (the rows that were valid are already written; fix the source and re-run).

On the **journal** backend the job only appends one encrypted segment per sync: safe while people use the admin. Don't run `compact` from the job and from a computer at the same time.

On **Firebase**, store the login instead (`credentials set firebase:data --from-env AGENTCRM_FB_EMAIL,AGENTCRM_FB_PASSWORD`, `--data-credential firebase:data`, no passphrase), use an account that is a CRM member, and mind the reads: a fresh `AGENTCRM_HOME` has no local copy of the dataset, so every run reads every document once ([firebase.md](firebase.md#costs)). For frequent runs on a large CRM, persist the copy between runs with `actions/cache` on `${{ runner.temp }}/agentcrm/cache` (key `agentcrm-${{ github.run_id }}`, `restore-keys: agentcrm-`) — it holds the CRM data unencrypted in the repository's Actions cache, so only in a private repository you control — or run the job less often.
