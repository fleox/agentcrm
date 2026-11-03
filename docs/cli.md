# `agentcrm` CLI reference

`agentcrm` is the headless front door of AgentCRM: it runs the admin's own engine (`src/ops/`) in Node.js 20+, against the same data, with the same validation, roles and automations.

```bash
npx -y @agent-crm/agentcrm@0.1.0 <command> [action] [options] [--json]
```

## Conventions

- **`--json`** prints exactly one object on stdout: `{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message", "hint" } }`. Progress and notes go to stderr.
- **Exit codes**: `0` ok, `1` failure (network, permission, not found…), `2` usage error (unknown command / option, invalid plan, validation).
- **Plans**: destructive actions (`records delete|merge`, `objects delete`, `fields delete`, `views delete`, `compact`, `deploy-admin`, `forms publish`) and dry-run-first actions (`import csv`, `automations run`, `forms ingest`) answer `{ "needsConfirmation": true, … }` and change nothing unless `--yes`.
- **Site resolution**: `--site <alias>` > `$AGENTCRM_SITE` > `./agentcrm.json` (`{ "site": "<alias>" }`, searched upwards) > the only registered site > the default set by `site use` > error `site-required` (exit 2).
- **Acting user**: data commands act as the site's CLI user (the install's owner, or `site credentials --user`), or `--as <email|id>`. Roles are enforced.
- **Locking**: writes take `~/.agentcrm/locks/<alias>.lock` (one writer per site per computer; stale locks are taken over).
- **Values**: `--set key=value` parses numbers, booleans, `null` and JSON arrays when they round-trip (`00123` and `+33…` stay text); `--fields` takes a JSON object or `@file.json`; long text options accept `@file` and `-` (stdin).
- **Filters**: `--filter field:op:value` (repeatable). Ops: `eq neq contains notContains empty notEmpty gt gte lt lte in notIn before after withinDays`. `in` / `notIn` values are comma-separated. Sorts: `--sort field[:asc|desc]` (repeatable).

## State (`~/.agentcrm`, or `$AGENTCRM_HOME`)

| File | Content |
|---|---|
| `sites.json` | Registered CRMs: alias, runtime config (public), data path, hosting (public settings), admin URL, credential account ids, CLI user, admin version. No secret. |
| `credentials.json` | Mode 0600. Accounts `<type>:<name>` → values. Types: `s3` (accessKeyId, secretAccessKey), `github` / `gitlab` (token), `firebase` (email, password), `passphrase`, `anthropic` (apiKey). |
| `locks/` | One lock file per site during writes. |

Environment: `AGENTCRM_HOME`, `AGENTCRM_SITE`, `AGENTCRM_DIST` (alternate dist folder), `AGENTCRM_KDF_ITERATIONS` (PBKDF2 iterations for NEW datasets — tests only).

## Install plan

`agentcrm options --json` documents every field. Minimal example:

```json
{
  "alias": "acme",
  "owner": { "name": "Ada Lovelace", "email": "ada@acme.com" },
  "data": { "backend": "journal", "location": { "type": "s3", "settings": { "region": "eu-west-3", "bucket": "acme-crm-data" }, "credential": "s3:main" } },
  "hosting": { "type": "s3", "settings": { "region": "eu-west-3", "bucket": "acme-crm-admin", "siteUrl": "https://crm.acme.com" }, "credential": "s3:main" }
}
```

`install` checks every access (`--dry-run` stops there), generates and stores the passphrase (`passphrase:<alias>`) before the first encrypted write, seeds the standard objects / pipeline / views / settings / owner (and demo data with `"demo": true`), stores the public hosting target in the dataset (`config/hosting`), uploads the admin + `version.json` + `config.js`, and registers the site.

## Commands

### `help`

List commands with their subcommands and options (--json gives a machine-readable list).

```text
agentcrm help [<command>]
```

### `version`

Print the AgentCRM version (CLI, minimum skills version, data schema).

```text
agentcrm version
```

### `status`

Versions overview — run it first: this tool (= the skills) vs the latest npm release, and every registered CRM's hosted admin vs this release.

```text
agentcrm status [--site <alias>]
```

### `options`

Data backends, data locations, admin hostings, credential types and the install plan format — ask the user about the data first, then the hosting.

```text
agentcrm options
```

### `credentials`

Store, list, copy, verify or remove access keys per account (<type>:<name>; types: s3, github, gitlab, firebase, passphrase, anthropic) in ~/.agentcrm/credentials.json (0600). `set` reads the secret from --from-env, --from-gh, --from-aws-profile, --generate (passphrases) or a hidden prompt the USER types in.

```text
agentcrm credentials <set|list|remove|copy|verify|types> [<type>:<name>] [--from-env VAR[,VAR]] [--from-gh] [--from-aws-profile <name>] [--generate]
```

| Action | Usage | What it does |
|---|---|---|
| `set` | `agentcrm credentials set <type>:<name> [--from-env VAR[,VAR]] [--from-gh] [--from-aws-profile <p>] [--generate]` | Store a credential (hidden prompt unless a --from-* source is given). |
| `list` | `agentcrm credentials list` | Accounts stored on this computer (field names only) and the sites using them. |
| `remove` | `agentcrm credentials remove <type>:<name>` | Delete a stored credential. |
| `copy` | `agentcrm credentials copy <type>:<name> [--field <f>]` | Put a secret on the clipboard without printing it (save the passphrase in a password manager). |
| `verify` | `agentcrm credentials verify <type>:<name> [--field <f>]` | The USER pastes the value from their password manager at a hidden prompt: proves the saved copy is right. |
| `types` | `agentcrm credentials types` | Credential types, their fields and where to create them. |

| Option | Description |
|---|---|
| `--from-env <value>` | Read the value(s) from these environment variables (comma-separated, in field order — s3: KEY_ID,SECRET). |
| `--from-gh` | github: take the token of the signed-in GitHub CLI (gh auth token). |
| `--from-aws-profile <value>` | s3: import the key pair of this aws CLI profile. |
| `--generate` | passphrase: generate a strong random passphrase. |
| `--field <value>` | copy / verify: which field (default: the first). |

### `install`

Install a CRM from a JSON plan (see `options`): checks access, creates the (encrypted) dataset on the chosen location, seeds the standard objects, pipeline, views and first admin (+ optional demo data), uploads the admin + config.js to the hosting, registers the site. --dry-run only checks.

```text
agentcrm install --plan <file|-> [--dry-run]
```

| Option | Description |
|---|---|
| `--plan <value>` | Plan file path, or - for stdin. |
| `--dry-run` | Validate the plan and test every access without writing anything. |

### `site`

The registry of CRMs this computer drives (~/.agentcrm/sites.json, no secrets): list, show, add an existing CRM, choose the default, rename, forget (local only — nothing is deleted online), attach credentials.

```text
agentcrm site <list|show|add|use|rename|forget|credentials> [args] [--admin-url <url>] [--data-credential <acct>] [--hosting-credential <acct>] [--passphrase-credential <acct>] [--user <email>]
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentcrm site list` | Registered CRMs (* = default). |
| `show` | `agentcrm site show [<alias>]` | One site's record (backend, location, hosting, credential accounts, CLI user). |
| `add` | `agentcrm site add <alias> (--admin-url <url> \| --runtime <json\|@file>) [--data-credential …] [--hosting-credential …] [--passphrase-credential …] [--data-path <folder>] [--user <email>]` | Register a CRM installed elsewhere: reads its config.js, opens the data to prove the credentials, reads its hosting. |
| `use` | `agentcrm site use <alias>` | Default site for commands without --site. |
| `rename` | `agentcrm site rename <from> <to>` | Rename an alias. |
| `forget` | `agentcrm site forget <alias>` | Remove from this computer's registry (nothing is deleted online). |
| `credentials` | `agentcrm site credentials <alias> [--data-credential <acct>] [--hosting-credential <acct>] [--passphrase-credential <acct>] [--user <email>]` | Attach / change the accounts a site uses ("" removes one). |

| Option | Description |
|---|---|
| `--admin-url <value>` | add: URL of the hosted admin, e.g. https://crm.acme.com/admin/. |
| `--runtime <value>` | add: the runtime config (config.js object) as JSON or @file, when the admin isn't hosted. |
| `--data-credential <value>` | Account of the data location / git token / Firebase login. |
| `--hosting-credential <value>` | Account used to write to the admin hosting. |
| `--passphrase-credential <value>` | Passphrase account of an encrypted dataset. |
| `--data-path <value>` | add: folder of this computer holding a local-folder dataset. |
| `--user <value>` | Email of the CRM user the CLI acts as (default: the store identity / first admin). |

### `doctor`

Health check of a CRM: credentials, data access (passphrase), dataset health, journal size, pending purge, hosted admin (HTTPS, version, config.js without secrets), bucket CORS rules, public exposure of the data. Every problem has a `fix`. Exit 1 when a check fails.

```text
agentcrm doctor [--site <alias>] [--repair]
```

| Option | Description |
|---|---|
| `--repair` | Seed what the dataset lacks (standard objects, pipeline, settings, admin) — idempotent. |

### `serve`

Serve the admin on this computer (127.0.0.1) and open the setup wizard in the browser. Runs until stopped (Ctrl+C).

```text
agentcrm serve [--port <n>] [--dir <folder>] [--no-open]
```

| Option | Description |
|---|---|
| `--port <value>` | First port to try (the next free one is used). |
| `--dir <value>` | Serve this folder instead of the bundled admin (e.g. a local-folder hosting). |
| `--no-open` | Don't open a browser. |

### `deploy-admin`

Upload this release's admin (+ version.json + config.js, never secrets) to a CRM's hosting. Prints the plan unless --yes; refuses downgrades and admins that store a newer data format.

```text
agentcrm deploy-admin [--site <alias> | --all] [--yes] [--allow-downgrade]
```

| Option | Description |
|---|---|
| `--all` | Every registered site with a hosting. |
| `--allow-downgrade` | Allow installing an older admin than the hosted one. |

### `records`

Records of any object (companies, people, deals, custom objects): list with filters / sorts / pagination, get with relations and timeline counts, create, update (only the given fields), soft delete / restore, full-text search, find and merge duplicates.

```text
agentcrm records <list|get|create|update|delete|restore|search|duplicates|merge> …
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentcrm records list --object <id> [--filter field:op:value]… [--sort field[:desc]] [--search <q>] [--view <id>] [--owner <userId>] [--limit n] [--offset n] [--columns a,b] [--deleted]` | List records. Filter ops: eq, neq, contains, notContains, empty, notEmpty, gt, gte, lt, lte, in, notIn, before, after, withinDays. Values: in/notIn comma-separated; dates YYYY-MM-DD, today, +30d. |
| `get` | `agentcrm records get <id>` | One record with its relations (both directions) and activity count. |
| `create` | `agentcrm records create --object <id> [--fields <json\|@file>] [--set key=value]… [--owner <userId>]` | Create a record (field ids from `objects get`; select fields take an option id or label). |
| `update` | `agentcrm records update <id> [--fields <json\|@file>] [--set key=value]… [--owner <userId>]` | Update some fields (null clears a field). |
| `delete` ⚠ | `agentcrm records delete <id>… [--hard] [--yes]` | Soft delete (restorable until `compact`); --hard removes at once. Plan unless --yes. |
| `restore` | `agentcrm records restore <id>` | Restore a soft-deleted record. |
| `search` | `agentcrm records search <query> [--object <id>]… [--limit n]` | Full-text search (names, emails, domains, phones). |
| `duplicates` | `agentcrm records duplicates --object <id> [--by email,domain,name,phone]` | Groups of likely duplicates (same email / domain / name / phone). |
| `merge` ⚠ | `agentcrm records merge <primaryId> <duplicateId>… [--yes]` | Merge duplicates into the primary (empty fields filled, relations and activities moved). Plan unless --yes. |

| Option | Description |
|---|---|
| `--object <value>` (repeatable) | Object id (companies, people, deals, …). |
| `--filter <value>` (repeatable) | field:op:value (repeatable). |
| `--sort <value>` (repeatable) | field[:asc\|desc] (repeatable; --sort=-field also means desc). |
| `--search <value>` | list: full-text filter. |
| `--view <value>` | list: apply a saved view's filters and sorts. |
| `--owner <value>` | list: owned by this user id; create / update: set the owner ("" clears). |
| `--limit <value>` | Page size (default 50, max 500). |
| `--offset <value>` | Page offset. |
| `--columns <value>` | list: only these field ids in the output (comma-separated). |
| `--deleted` | list: only soft-deleted records. |
| `--fields <value>` | create / update: field values as a JSON object or @file.json. |
| `--set <value>` (repeatable) | create / update: key=value (repeatable; numbers / true / null / JSON parsed). |
| `--hard` | delete: remove immediately (no restore). |
| `--by <value>` | duplicates: email,domain,name,phone. |

### `objects`

The data model: list objects, describe one (fields, types, select options, relations, pipelines), create custom objects, rename / recolor, delete a custom object (admin).

```text
agentcrm objects <list|get|create|update|delete> …
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentcrm objects list` | Objects with record counts. |
| `get` | `agentcrm objects get <id>` | Fields (ids, types, options, relations) and pipelines of one object — read it before writing records. |
| `create` | `agentcrm objects create --singular <label> --plural <label> [--id <slug>] [--icon <name>] [--color <c>] [--data <json>]` | Create a custom object (with a name field; add fields with `fields add`). |
| `update` | `agentcrm objects update <id> [--singular …] [--plural …] [--icon …] [--color …] [--label-field <fieldId>]` | Rename, change icon / color / label field. |
| `delete` ⚠ | `agentcrm objects delete <id> [--yes]` | Delete a custom object, ALL its records, its views and relation fields pointing at it. Plan unless --yes. |

| Option | Description |
|---|---|
| `--singular <value>` | Singular label. |
| `--plural <value>` | Plural label. |
| `--id <value>` | create: object id (slug; default from the plural label). |
| `--icon <value>` | Icon name (lucide). |
| `--color <value>` | Color name. |
| `--label-field <value>` | update: field used as the record label. |
| `--data <value>` | create: full ObjectInput JSON (with fields) or @file. |

### `fields`

Custom fields: add (any type, select options, relations), update (label, options, required, type change with data migration), delete (values cleared). Admin only.

```text
agentcrm fields <add|update|delete> --object <id> …
```

| Action | Usage | What it does |
|---|---|---|
| `add` | `agentcrm fields add --object <id> --label <label> --type <text\|longText\|number\|currency\|percent\|date\|datetime\|boolean\|select\|multiSelect\|email\|phone\|url\|relation\|user\|rating\|address\|tags> [--options a,b,c] [--relation-object <id> --cardinality one\|many] [--required] [--unique] [--description …] [--id <fieldId>]` | Add a field. |
| `update` | `agentcrm fields update <fieldId> --object <id> [--label …] [--options a,b] [--type <t>] [--required\|--optional] [--data <json>]` | Change a field (type changes migrate existing values). |
| `delete` ⚠ | `agentcrm fields delete <fieldId> --object <id> [--yes]` | Delete a custom field and clear its values. Plan unless --yes. |

| Option | Description |
|---|---|
| `--object <value>` | Object id. |
| `--label <value>` | Field label. |
| `--type <value>` | Field type: text, longText, number, currency, percent, date, datetime, boolean, select, multiSelect, email, phone, url, relation, user, rating, address, tags. |
| `--id <value>` | add: field id (default: camelCase of the label). |
| `--options <value>` | select / multiSelect option labels, comma-separated. |
| `--relation-object <value>` | relation: target object id. |
| `--cardinality <value>` | relation: one (default) or many. |
| `--required` | Value required. |
| `--optional` | update: no longer required. |
| `--unique` | Values must be unique. |
| `--description <value>` | Help text. |
| `--data <value>` | update: raw FieldPatch JSON. |

### `activities`

Timeline entries: log calls, emails, meetings and notes on records; list a record's timeline (optionally with its related records' activities).

```text
agentcrm activities <add|list|done> …
```

| Action | Usage | What it does |
|---|---|---|
| `add` | `agentcrm activities add --type <note\|task\|call\|email\|meeting> --title <t> [--body <md\|@file>] --record <id>… [--meta <json>] [--due <date>] [--assignee <user>]` | Log an activity. |
| `list` | `agentcrm activities list [--record <id>] [--type <t>]… [--related] [--limit n]` | Timeline, most recent first. |
| `done` | `agentcrm activities done <id> [--undo]` | Mark a task done (or reopen). |

| Option | Description |
|---|---|
| `--type <value>` (repeatable) | Activity type: note, task, call, email, meeting (list: repeatable filter). |
| `--title <value>` | Title / subject. |
| `--body <value>` | Markdown body, or @file. |
| `--record <value>` (repeatable) | Record id the activity is attached to (repeatable). |
| `--meta <value>` | JSON metadata, e.g. {"durationMin":20} or {"startAt":…,"endAt":…}. |
| `--due <value>` | Due date (tasks): ISO date / datetime. |
| `--assignee <value>` | Assignee user id or email. |
| `--related` | list: include activities of linked records. |
| `--limit <value>` | Max items (default 50). |
| `--undo` | done: reopen the task. |

### `notes`

Add a note (Markdown) to a record's timeline.

```text
agentcrm notes add <recordId> --body <markdown|@file> [--title <t>]
```

| Action | Usage | What it does |
|---|---|---|
| `add` | `agentcrm notes add <recordId> --body <markdown\|@file> [--title <t>]` | Add a note. |

| Option | Description |
|---|---|
| `--body <value>` | Markdown, or @file. |
| `--title <value>` | Title (default: first line). |

### `tasks`

Tasks: list (open by default; by assignee, record, overdue, due soon), add with due date and assignee, mark done, reassign.

```text
agentcrm tasks <list|add|done|reassign> …
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentcrm tasks list [--assignee <user\|me>] [--record <id>] [--status open\|done\|all] [--overdue] [--due-within <days>] [--limit n]` | Tasks sorted by due date. |
| `add` | `agentcrm tasks add --title <t> [--due <date>] [--assignee <user\|me>] [--record <id>]… [--body <md>]` | Create a task. |
| `done` | `agentcrm tasks done <id> [--undo]` | Complete (or reopen) a task. |
| `reassign` | `agentcrm tasks reassign <id> --assignee <user>` | Change the assignee. |

| Option | Description |
|---|---|
| `--title <value>` | Task title. |
| `--body <value>` | Details (Markdown or @file). |
| `--due <value>` | Due date / datetime (ISO). |
| `--assignee <value>` | User id or email; "me" = the CLI user. |
| `--record <value>` (repeatable) | Record id the activity is attached to (repeatable). |
| `--status <value>` | list: open (default), done or all. |
| `--overdue` | list: only overdue. |
| `--due-within <value>` | list: due within N days. |
| `--limit <value>` | Max items (default 50). |
| `--undo` | done: reopen. |

### `pipelines`

Pipelines and their stages (probability, open / won / lost); move a deal to a stage (updates probability; lostReason for lost stages).

```text
agentcrm pipelines <list|move> …
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentcrm pipelines list [--object <id>]` | Pipelines with stages. |
| `move` | `agentcrm pipelines move <recordId> <stage id or label> [--lost-reason <text>]` | Move a record to a stage. |

| Option | Description |
|---|---|
| `--object <value>` | list: only this object's pipelines. |
| `--lost-reason <value>` | move: why the deal was lost. |

### `views`

Saved views (table / kanban) of an object: list, create with filters / sorts / columns, delete.

```text
agentcrm views <list|create|delete> …
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentcrm views list [--object <id>]` | Views visible to the CLI user. |
| `create` | `agentcrm views create --object <id> --name <n> [--type table\|kanban] [--columns a,b] [--filter f:op:v]… [--sort f[:desc]] [--group-by <field>] [--shared]` | Create a view. |
| `delete` ⚠ | `agentcrm views delete <id> [--yes]` | Delete a view. Plan unless --yes. |

| Option | Description |
|---|---|
| `--object <value>` | Object id. |
| `--name <value>` | View name. |
| `--type <value>` | table (default) or kanban. |
| `--columns <value>` | Column field ids, comma-separated. |
| `--filter <value>` (repeatable) | field:op:value (repeatable). |
| `--sort <value>` (repeatable) | field[:asc\|desc] (repeatable). |
| `--group-by <value>` | kanban: select field to group by. |
| `--pipeline <value>` | kanban: pipeline id. |
| `--shared` | Visible to every user (admin). |

### `users`

CRM users and roles (admin, member, viewer): list, add, change role, disable / re-enable. Admin only for changes. (Firebase / git logins are created on that service.)

```text
agentcrm users <list|add|role|disable> …
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentcrm users list [--all]` | Users (--all includes disabled). |
| `add` | `agentcrm users add --email <e> [--name <n>] [--role admin\|member\|viewer]` | Add a user. |
| `role` | `agentcrm users role <id\|email> <admin\|member\|viewer>` | Change a user's role. |
| `disable` | `agentcrm users disable <id\|email> [--enable]` | Disable (or re-enable) a user. |

| Option | Description |
|---|---|
| `--email <value>` | add: email. |
| `--name <value>` | add: display name. |
| `--role <value>` | add: role (default member). |
| `--all` | list: include disabled users. |
| `--enable` | disable: re-enable instead. |

### `settings`

CRM settings (name, default currency, locale, timezone, week start, stale deal days).

```text
agentcrm settings <get|set> …
```

| Action | Usage | What it does |
|---|---|---|
| `get` | `agentcrm settings get` | Current settings. |
| `set` | `agentcrm settings set [--set key=value]… [--data <json>]` | Change settings (admin). |

| Option | Description |
|---|---|
| `--set <value>` (repeatable) | key=value (repeatable), e.g. --set staleDealDays=21 --set defaultCurrency=EUR. |
| `--data <value>` | JSON object of settings, or @file. |

### `import`

Import a CSV into an object: columns mapped to fields automatically (or with --map), values coerced, duplicates (people by email, companies by domain, else by name) updated / skipped. DRY RUN by default — the report shows every row's outcome; --yes applies.

```text
agentcrm import csv <file|-> --object <id> [--map <json|Header=field,…>] [--dedupe update|skip|create] [--delimiter ;] [--day-first] [--yes]
```

| Action | Usage | What it does |
|---|---|---|
| `csv` | `agentcrm import csv <file\|-> --object <id> [--map …] [--dedupe update\|skip\|create] [--yes]` | Dry run (default) or apply (--yes). |

| Option | Description |
|---|---|
| `--object <value>` | Target object id. |
| `--map <value>` | Column mapping: JSON {"Header":"fieldId"} or "Header=fieldId,…" ("" skips a column, $owner / $id special). |
| `--dedupe <value>` | Existing duplicate: update (default), skip, or create anyway. |
| `--delimiter <value>` | Column delimiter (default: detected). |
| `--day-first` | Ambiguous dates are DD/MM/YYYY. |
| `--no-create-options` | Don't add unknown select values as new options. |
| `--dry-run` | Explicit dry run (the default without --yes). |
| `--rows <value>` | Rows shown in the report (default 100). |

### `export`

Export one object as CSV (labels or raw values, filters, columns), or the whole dataset as JSON (backup / migration, re-importable).

```text
agentcrm export <csv|json> …
```

| Action | Usage | What it does |
|---|---|---|
| `csv` | `agentcrm export csv --object <id> [--out <file>] [--filter f:op:v]… [--sort f] [--columns a,b] [--view <id>] [--raw] [--deleted]` | CSV of one object. |
| `json` | `agentcrm export json [--out <file>] [--collections records,activities,…]` | Whole dataset (or some collections) as JSON. |

| Option | Description |
|---|---|
| `--object <value>` | csv: object id. |
| `--out <value>` | Write to this file (default: stdout / the JSON result). |
| `--filter <value>` (repeatable) | field:op:value (repeatable). |
| `--sort <value>` (repeatable) | field[:desc] (repeatable). |
| `--columns <value>` | Field ids to export. |
| `--view <value>` | Apply a saved view. |
| `--raw` | Stored values (ids, ISO dates) instead of labels. |
| `--deleted` | Include soft-deleted records. |
| `--collections <value>` | json: collections to export. |

### `report`

Sales reports: pipeline by stage, weighted forecast, won / lost per month (win rate), activity per user, lead sources, stale deals, lifecycle conversion funnel.

```text
agentcrm report <pipeline|forecast|won-lost|activity|lead-sources|stale|conversion> [--months n] [--days n] [--pipeline <id>] [--owner <userId>] [--params <json>]
```

| Action | Usage | What it does |
|---|---|---|
| `pipeline` | `agentcrm report pipeline` | The pipeline report. |
| `forecast` | `agentcrm report forecast` | The forecast report. |
| `won-lost` | `agentcrm report won-lost` | The won-lost report. |
| `activity` | `agentcrm report activity` | The activity report. |
| `lead-sources` | `agentcrm report lead-sources` | The lead-sources report. |
| `stale` | `agentcrm report stale` | The stale report. |
| `conversion` | `agentcrm report conversion` | The conversion report. |

| Option | Description |
|---|---|
| `--months <value>` | won-lost: months back (default 6). |
| `--days <value>` | activity / stale: days (default 30 / settings.staleDealDays). |
| `--pipeline <value>` | Pipeline id. |
| `--owner <value>` | Only deals owned by this user id. |
| `--params <value>` | Raw report parameters (JSON). |

### `automations`

Automations (event triggers run in-process on every write, also from the CLI): list, enable / disable, run the scheduled & inactivity ones (cron / GitHub Actions). `run` is a dry run unless --yes.

```text
agentcrm automations <list|enable|disable|run> …
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentcrm automations list` | Automations with trigger, enabled state and last run. |
| `enable` | `agentcrm automations enable <id>` | Enable an automation. |
| `disable` | `agentcrm automations disable <id>` | Disable an automation. |
| `run` | `agentcrm automations run [--id <automationId>] [--force] [--yes]` | Evaluate schedule / inactivity triggers now (runScheduled). Dry run unless --yes. |

| Option | Description |
|---|---|
| `--id <value>` | run: only this automation. |
| `--force` | run: ignore the everyHours spacing. |

### `forms`

Lead capture forms: list, publish the static form page to the hosting, ingest pending submissions from the inbox (records created / deduped, activity logged). publish and ingest print a plan / dry run unless --yes.

```text
agentcrm forms <list|publish|ingest> …
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentcrm forms list` | Forms with their inbox and published URL. |
| `publish` | `agentcrm forms publish <formId> [--yes]` | Upload the form page (+ print the embed snippet). |
| `ingest` | `agentcrm forms ingest [--form <id>] [--limit n] [--yes]` | Turn inbox submissions into records. Dry run unless --yes. |

| Option | Description |
|---|---|
| `--form <value>` | ingest: only this form. |
| `--limit <value>` | ingest: max submissions. |

### `compact`

Physical purge (GDPR erasure): hard-deletes soft-deleted records and activities and old automation runs, then rewrites the storage without history (journal: new snapshot, merged segments deleted). Plan unless --yes.

```text
agentcrm compact [--older-than <days>] [--keep-runs <n>] [--yes]
```

| Option | Description |
|---|---|
| `--older-than <value>` | Only items deleted more than N days ago (default: all). |
| `--keep-runs <value>` | Automation runs kept (default 500). |

### `stats`

Dataset overview: records per object, activities by type, open / overdue tasks, users, open pipeline (+ journal segments).

```text
agentcrm stats [--site <alias>]
```

### `tools`

The AI tool catalog (src/ai/tools.ts) — exactly what the MCP server and the in-admin assistant expose: list the tools with their JSON schemas, or call one with a JSON input.

```text
agentcrm tools <list|call> [<name>] [--input <json|@file>]
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentcrm tools list` | Tools with description, input schema and whether they write. |
| `call` | `agentcrm tools call <name> --input <json\|@file>` | Run one tool as the site's CLI user. |

| Option | Description |
|---|---|
| `--input <value>` | call: the tool input as a JSON object or @file. |

### `mcp`

Run the MCP server on stdio (JSON-RPC 2.0, protocol 2025-06-18 / 2024-11-05): tools = the AI catalog (read-only mode hides the ones that write), resources = schema + pipelines, prompts = pipeline review, follow-up email, lead qualification. For Claude Desktop / Claude Code / Cursor.

```text
agentcrm mcp [--site <alias>] [--read-only] [--as <user>]
```

| Option | Description |
|---|---|
| `--read-only` | Expose only the tools that don't write. |

