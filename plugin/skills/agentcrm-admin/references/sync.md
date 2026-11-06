# Mirror an external source (`records sync`)

Use `records sync` when the CRM must follow another system (a product database, a billing tool, a spreadsheet exported every night) rather than a one-off CSV import. Rows are matched on a **key field** holding the source id; a record is created when its key is new and patched only where a value differs, so a second run with the same rows writes nothing. Records whose key left the source are flagged in an **archive field** (a boolean), never deleted: their notes, tasks and deals stay. The whole batch is one write and no automation fires.

## 1. Prepare the model (once)

Each mirrored object needs a key field (text, ideally unique) and, to flag removals, a boolean archive field. With `schema apply` (references/schema.md) or:

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.1 fields add --site acme --object companies --label "Source id" --id sourceId --type text --unique --json
npx -y @fleox-agent-crm/agentcrm@0.12.1 fields add --site acme --object companies --label Archived --id archived --type boolean --json
```

Use the same key field id on every mirrored object: relations between them resolve through it.

## 2. Write the rows

`rows.json` is an array of `{ key, fields }`. Field values follow `records create` (select: option id or label; numbers; dates `YYYY-MM-DD`). A relation references another mirrored record by its key: `{ "$key": "12" }` (one) or `{ "$key": ["12", "13"] }` (many).

```json
[
  { "key": "c-12", "fields": { "name": "Globex", "domain": "globex.com", "markets": { "$key": ["FR", "DE"] } } },
  { "key": "c-13", "fields": { "name": "Initech", "domain": "initech.com", "markets": { "$key": ["FR"] } } }
]
```

## 3. Plan, then apply

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.1 records sync --site acme --object markets --key sourceId --rows @markets.json --archive-field archived --json
npx -y @fleox-agent-crm/agentcrm@0.12.1 records sync --site acme --object companies --key sourceId --rows @rows.json --archive-field archived --json
npx -y @fleox-agent-crm/agentcrm@0.12.1 records sync --site acme --object companies --key sourceId --rows @rows.json --archive-field archived --yes --json
```

- Without `--yes` nothing is written: the result is `needsConfirmation: true` with a `plan` of `created`, `updated`, `unchanged`, `archived`, `unresolved`, `unresolvedRefs`, `errors` and `samples` (keys created, fields updated per key, keys archived). Show it, then re-run with `--yes`.
- Sync the **referenced objects first** (markets before companies): `unresolved` counts `$key` references with no matching record and `unresolvedRefs` lists them (`{ key, field, refs }`). Such a relation is left unchanged on that row (for a `many` relation, the whole value is kept); send `null` or `{ "$key": [] }` to clear it.
- `--ref-key <fieldId>` when the related objects' key field has another id than `--key`. `--rows -` reads stdin (pipe the output of the user's own export script).
- Without `--archive-field`, records missing from the rows are left alone. A record that comes back is un-archived.
- Only the fields given in the rows are compared: fields edited in the CRM that the source doesn't send stay as they are.
- For a schedule, run the same command from the user's cron / GitHub Actions workflow (references/cron.md of the `agentcrm-manage` skill shows the setup).

Full reference: https://github.com/fleox/agentcrm/blob/master/docs/sync.md
