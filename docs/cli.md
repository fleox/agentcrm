# `agentcrm` CLI reference

`agentcrm` is the headless front door of AgentCRM: it runs the admin's own engine (`src/ops/`) in Node.js 20+, against the same data, with the same validation, roles and automations.

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.3 <command> [action] [options] [--json]
```

## Conventions

- **`--json`** prints exactly one object on stdout: `{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message", "hint" } }`. Progress and notes go to stderr.
- **Exit codes**: `0` ok, `1` failure (network, permission, not found…), `2` usage error (unknown command / option, invalid plan, validation).
- **Plans**: destructive actions (`records delete|merge`, `objects delete`, `fields delete`, `views delete`, `compact`, `deploy-admin`, `forms publish`), workspace-wide customisation (`modules enable|disable|config set`, `appearance set|preset|logo|favicon|css|reset`, `ext install|enable|disable|uninstall`) and dry-run-first actions (`import csv`, `automations run`, `forms ingest`) answer `{ "needsConfirmation": true, … }` and change nothing unless `--yes`. Customisation plans are computed by running the op on an in-memory copy of the data (`plan.changes` / `plan.changed`), so a conflict or validation error shows up before `--yes`.
- **Extensions**: commands that open a CRM load its enabled extension modules and themes in Node (same loader as the admin): their AI tools are in `tools list|call` and `mcp`, their hooks see the command's writes, their automation actions run in `automations run`. A failing extension is a note on stderr. `--safe` (any command) or `AGENTCRM_SAFE=1` skips them.
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

Environment: `AGENTCRM_HOME`, `AGENTCRM_SITE`, `AGENTCRM_DIST` (alternate dist folder), `AGENTCRM_SAFE` (`1` = safe mode, no extensions), `AGENTCRM_RUNTIME_DIR` (runtime stubs used to load extensions; default `dist/admin/runtime` of the package), `AGENTCRM_KDF_ITERATIONS` (PBKDF2 iterations for NEW datasets — tests only).

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
agentcrm records <list|get|create|update|delete|restore|search|duplicates|merge|image> …
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
| `sync` ⚠ | `agentcrm records sync --object <id> --key <fieldId> --rows <json\|@file\|-> [--archive-field <fieldId>] [--ref-key <fieldId>] [--yes]` | Mirror an external source into one object (see below). Plan unless --yes. |
| `merge` ⚠ | `agentcrm records merge <primaryId> <duplicateId>… [--yes]` | Merge duplicates into the primary (empty fields filled, relations and activities moved). Plan unless --yes. |
| `image` | `agentcrm records image <recordId> <path> \| --remove [--field <imageFieldId>]` | Set the record's avatar / logo from a local image (the object's image field), or --remove it. |

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
| `--remove` | image: remove the record's image. |
| `--field <value>` | image: image field id (default: the object's image field). |

#### Mirroring an external source (`records sync`)

`--rows` is a JSON array of `{ "key": "<source id>", "fields": { … } }`. Rows are matched on the `--key` field (a text field, ideally unique); a record is created when the key is new and patched only on the fields whose value differs, so a second run of the same rows writes nothing. A relation value can point at another mirrored record by its key: `{ "$key": "12" }` (one) or `{ "$key": ["12", "13"] }` (many), resolved against the related object's `--ref-key` field (default: the same field id as `--key`) — mirror the referenced objects first; references with no match are counted in `unresolved`. With `--archive-field <boolean field>`, records whose key is missing from the rows are flagged `true` (and `false` again when they come back): they are never deleted, so notes, tasks and deals attached to them stay. No automation fires. Invalid rows are reported in `errors` and the others are still written.

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
| `add` | `agentcrm fields add --object <id> --label <label> --type <text\|longText\|number\|currency\|percent\|date\|datetime\|boolean\|select\|multiSelect\|email\|phone\|url\|relation\|user\|rating\|address\|tags\|image\|files> [--options a,b,c] [--relation-object <id> --cardinality one\|many] [--required] [--unique] [--description …] [--id <fieldId>]` | Add a field. |
| `update` | `agentcrm fields update <fieldId> --object <id> [--label …] [--options a,b] [--type <t>] [--required\|--optional] [--data <json>]` | Change a field (type changes migrate existing values). |
| `delete` ⚠ | `agentcrm fields delete <fieldId> --object <id> [--yes]` | Delete a custom field and clear its values. Plan unless --yes. |

| Option | Description |
|---|---|
| `--object <value>` | Object id. |
| `--label <value>` | Field label. |
| `--type <value>` | Field type: text, longText, number, currency, percent, date, datetime, boolean, select, multiSelect, email, phone, url, relation, user, rating, address, tags, image, files. |
| `--id <value>` | add: field id (default: camelCase of the label). |
| `--options <value>` | select / multiSelect option labels, comma-separated. |
| `--relation-object <value>` | relation: target object id. |
| `--cardinality <value>` | relation: one (default) or many. |
| `--required` | Value required. |
| `--optional` | update: no longer required. |
| `--unique` | Values must be unique. |
| `--description <value>` | Help text. |
| `--data <value>` | update: raw FieldPatch JSON. |

### `schema`

Schema as code: bring the data model in line with a JSON description, so a team keeps its CRM model in a repository and re-applies it after every change.

```
agentcrm schema apply <file|-> [--yes]
```

| Action | Usage | What it does |
|---|---|---|
| `apply` ⚠ | `agentcrm schema apply <file\|-> [--yes]` | Create what is missing, update what differs. Plan unless --yes. |

The description:

```json
{
  "objects": [
    { "id": "accounts", "labelSingular": "Account", "labelPlural": "Accounts", "icon": "Handshake", "labelField": "name",
      "fields": [
        { "id": "name", "label": "Account", "type": "text" },
        { "id": "status", "label": "Status", "type": "select", "options": ["active", "pending", "closed"] },
        { "id": "operators", "label": "Operators", "type": "relation", "relation": { "object": "companies", "cardinality": "many" } }
      ] }
  ],
  "pipelines": [
    { "id": "partnerships", "name": "Partnerships", "object": "deals",
      "stages": [{ "id": "p-prospect", "label": "Prospect", "probability": 10 }, { "id": "p-signed", "label": "Signed", "probability": 100, "kind": "won" }] }
  ],
  "views": [
    { "object": "accounts", "name": "Pending accounts", "columns": ["name", "status"], "filters": [{ "field": "status", "op": "eq", "value": "pending" }], "shared": true }
  ]
}
```

- Additive and idempotent: a second apply of the same file changes nothing. Objects and fields match by `id`, pipelines by `id`, views by object + name.
- Never deletes and never changes a field type (reported in `conflicts`); select options and stages are only added, never removed (records point at them). Custom fields the file doesn't list are reported in `extraFields`.
- Relation fields may point at objects defined later in the same file. Standard objects (`companies`, `people`, `deals`) can be relabelled and extended.
- Stage ids are unique across all pipelines: a stage id another pipeline uses is a conflict (prefix them, e.g. `p-prospect`).

### `activities`

Timeline entries: log calls, emails, meetings and notes on records; list a record's timeline (optionally with its related records' activities).

```text
agentcrm activities <add|list|done> …
```

| Action | Usage | What it does |
|---|---|---|
| `add` | `agentcrm activities add --type <note\|task\|call\|email\|meeting> --title <t> [--body <md\|@file>] --record <id>… [--meta <json>] [--due <date>] [--assignee <user>] [--attach <path>]…` | Log an activity (with attachments). |
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
| `--attach <value>` (repeatable) | Attach a local file (repeatable; images are uploaded as they are). |

### `notes`

Add a note (Markdown, optional attachments) to a record's timeline.

```text
agentcrm notes add <recordId> --body <markdown|@file> [--title <t>] [--attach <path>]…
```

| Action | Usage | What it does |
|---|---|---|
| `add` | `agentcrm notes add <recordId> --body <markdown\|@file> [--title <t>] [--attach <path>]…` | Add a note. |

| Option | Description |
|---|---|
| `--body <value>` | Markdown, or @file. |
| `--title <value>` | Title (default: first line). |
| `--attach <value>` (repeatable) | Attach a local file (repeatable; images are uploaded as they are). |

### `tasks`

Tasks: list (open by default; by assignee, record, overdue, due soon), add with due date and assignee, mark done, reassign.

```text
agentcrm tasks <list|add|done|reassign> …
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentcrm tasks list [--assignee <user\|me>] [--record <id>] [--status open\|done\|all] [--overdue] [--due-within <days>] [--limit n]` | Tasks sorted by due date. |
| `add` | `agentcrm tasks add --title <t> [--due <date>] [--assignee <user\|me>] [--record <id>]… [--body <md>] [--attach <path>]…` | Create a task. |
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
| `--attach <value>` (repeatable) | Attach a local file (repeatable; images are uploaded as they are). |

### `files`

Images and attachments: list a record's / activity's files (metadata), upload local files to a record or an activity, download one, soft-delete (bytes purged by `compact`), storage usage.

```text
agentcrm files <list|upload|get|delete|usage> …
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentcrm files list [--record <id> \| --activity <id>] [--related] [--kind image\|pdf\|document\|…] [--search <name>] [--limit n]` | Files of a record (its own, its activities', --related: linked records') or of an activity; all files without a target. |
| `upload` | `agentcrm files upload <path>… (--record <id> \| --activity <id>)` | Upload local files and attach them to a record or an activity (CRM size limit applies). |
| `get` | `agentcrm files get <id> --out <path> [--thumb]` | Download a file's bytes (decrypted) to a local path. |
| `delete` ⚠ | `agentcrm files delete <id> [--yes]` | Soft-delete a file (removed from its records / activities; bytes purged by `compact`). Plan unless --yes. |
| `usage` | `agentcrm files usage` | Number of files and total size. |

| Option | Description |
|---|---|
| `--record <value>` | Record id. |
| `--activity <value>` | Activity id (note, task, call, email, meeting). |
| `--related` | list: include files of related records. |
| `--kind <value>` | list: image, pdf, document, spreadsheet, presentation, archive, text, audio, video, other. |
| `--search <value>` | list: part of the file name. |
| `--limit <value>` | list: max items (default 100). |
| `--out <value>` | get: local path to write. |
| `--thumb` | get: the thumbnail when there is one. |

Bytes are read from / written to local paths; the CRM limit (`settings.maxUploadMb`, 25 MB by default) applies; images are uploaded as they are (the admin resizes, the CLI doesn't). See [files.md](files.md).

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
| `zip` ⚠ | `agentcrm import zip <backup.zip> [--replace] [--yes]` | Restore a backup ZIP (data + files; merge, or --replace). Plan unless --yes. |

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
| `--replace` | zip: also delete documents absent from the backup. |

### `export`

Export one object as CSV (labels or raw values, filters, columns), the whole dataset as JSON (backup / migration, re-importable), or a ZIP backup with data + files.

```text
agentcrm export <csv|json|zip> …
```

| Action | Usage | What it does |
|---|---|---|
| `csv` | `agentcrm export csv --object <id> [--out <file>] [--filter f:op:v]… [--sort f] [--columns a,b] [--view <id>] [--raw] [--deleted]` | CSV of one object. |
| `json` | `agentcrm export json [--out <file>] [--collections records,activities,…]` | Whole dataset (or some collections) as JSON. |
| `zip` | `agentcrm export zip --out <file.zip> [--no-files]` | Backup ZIP: data.json + the (decrypted) bytes of every file. Not encrypted: keep it safe. |

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
| `--no-files` | zip: data only (no file bytes). |

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

Physical purge (GDPR erasure): hard-deletes soft-deleted records and activities and old automation runs, deletes the bytes of deleted / orphan files, then rewrites the storage without history (journal: new snapshot, merged segments deleted). Plan unless --yes.

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

### `modules`

Workspace modules (Settings → Modules): built-in features (dashboard, deals, reports, forms, tasks, automations, integrations, assistant…) and installed extension modules. Disabling hides pages, navigation, widgets and owned objects for everyone without deleting data. enable / disable / config set print a plan unless --yes.

```text
agentcrm modules <list|get|enable|disable|config> …
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentcrm modules list` | Modules with category, source, enabled / required state and dependencies. |
| `get` | `agentcrm modules get <id>` | One module (dependents, missing dependencies, owned objects, settings section). |
| `enable` | `agentcrm modules enable <id> [--cascade] [--yes]` | Enable a module (--cascade also enables its dependencies). |
| `disable` | `agentcrm modules disable <id> [--cascade] [--yes]` | Disable a module (--cascade also disables the modules depending on it). Plan unless `--yes`. |
| `config` | `agentcrm modules config get <id> \| modules config set <id> --value <json\|@file\|-> [--yes] \| modules config set <id> --clear [--yes]` | Read or replace a module's configuration (JSON ≤ 256 KB, never secrets). |

| Option | Description |
|---|---|
| `--cascade` | enable / disable: also enable the dependencies / disable the dependents. |
| `--value <value>` | config set: the new configuration as JSON, @file or - (stdin). |
| `--clear` | config set: remove the module's configuration. |

### `appearance`

Workspace appearance (Settings → Appearance) for every user: accent color (a full scale is generated from one hex), neutral grays, radius, density, font, sidebar style, default light / dark mode, buttons, contrast, presets and theme extensions, logo, favicon, custom CSS. Changes print a plan (before → after) unless --yes.

```text
agentcrm appearance <get|presets|set|preset|logo|favicon|css|reset> …
```

| Action | Usage | What it does |
|---|---|---|
| `get` | `agentcrm appearance get [--full]` | The effective appearance (defaults ← selected theme ← workspace values). |
| `presets` | `agentcrm appearance presets` | Built-in presets and installed theme extensions. |
| `set` | `agentcrm appearance set [--accent <#hex>] [--neutral zinc\|slate\|stone\|gray\|neutral] [--radius none\|sm\|md\|lg\|xl] [--density compact\|comfortable] [--font <id>] [--sidebar default\|dark\|accent] [--mode system\|light\|dark] [--buttons neutral\|accent] [--contrast normal\|high] [--theme <id>] [--yes]` | Change some values ("null" resets one). |
| `preset` | `agentcrm appearance preset <id> [--yes]` | Apply a preset (default, ocean, forest, sunset, graphite, rose, high-contrast) or an installed theme; logo, favicon and custom CSS are kept. |
| `logo` | `agentcrm appearance logo <file.png\|svg\|jpg> [--yes] \| appearance logo --remove [--yes]` | Set or remove the workspace logo (≤ 200 KB). |
| `favicon` | `agentcrm appearance favicon <file> [--yes] \| appearance favicon --remove [--yes]` | Set or remove the favicon (≤ 200 KB). |
| `css` | `agentcrm appearance css <file.css\|-> [--yes] \| appearance css --remove [--yes]` | Replace the custom CSS of the workspace (≤ 50 KB, plain CSS). |
| `reset` | `agentcrm appearance reset [--branding] [--yes]` | Back to the defaults (keeps logo / favicon unless --branding). Plan unless `--yes`. |

| Option | Description |
|---|---|
| `--accent <value>` | set: accent color #rrggbb. |
| `--neutral <value>` | set: zinc, slate, stone, gray or neutral. |
| `--radius <value>` | set: none, sm, md, lg or xl. |
| `--density <value>` | set: compact or comfortable. |
| `--font <value>` | set: system (no network) or a Google font id (inter, geist, roboto, ibm-plex-sans…). |
| `--sidebar <value>` | set: default, dark or accent. |
| `--mode <value>` | set: default color mode — system, light or dark (users who never chose). |
| `--buttons <value>` | set: primary buttons neutral or accent. |
| `--contrast <value>` | set: normal or high. |
| `--theme <value>` | set: installed theme extension id to use ("null" clears it). |
| `--remove` | logo / favicon / css: remove it. |
| `--branding` | reset: also remove the logo and favicon. |
| `--full` | get: include the logo / favicon data URLs and the custom CSS. |

### `ext`

Extensions (modules and themes loaded at runtime, no rebuild): new module|theme <id> scaffolds a project (Vite, typings, i18n en/fr), check <dir|zip> validates and loads the bundle like the admin and lists what it registers (exit 1 on errors), pack <dir> builds the ZIP, install <zip|dir> adds it to a CRM (plan first; installing runs code with admin rights), list, enable / disable, uninstall, export (download as ZIP).

```text
agentcrm ext <new|check|pack|install|list|enable|disable|uninstall|export> …
```

| Action | Usage | What it does |
|---|---|---|
| `new` | `agentcrm ext new <module\|theme> <id> [--dir <path>] [--name <name>] [--description <text>] [--author <name>] [--force]` | Scaffold a standalone extension project (package.json, vite.config.ts, tsconfig + runtime typings, src/index.tsx, README). |
| `check` | `agentcrm ext check [<dir\|zip>] [--kind module\|theme] [--no-call]` | Validate manifest, ids, apiVersion, sizes, imports; load the bundle in a throw-away CRM and report routes, nav, slots, AI tools, automation actions, theme values. |
| `pack` | `agentcrm ext pack [<dir>] [--out <file.zip>]` | ZIP manifest.json + bundle.js (+ style.css) for Settings → Modules → Install or `ext install`. |
| `install` | `agentcrm ext install <zip\|dir> [--site <alias>] [--disabled] [--force] [--yes]` | Install or upgrade an extension on a CRM. The bundle is first loaded in a throw-away CRM (like `ext check`): a package that fails is refused and nothing changes (`--force` skips it). Prints the plan (id, version, author, upgrade, size, warnings) unless `--yes`. |
| `list` | `agentcrm ext list [--kind module\|theme]` | Installed extensions with version, enabled state and load status in this process. |
| `enable` | `agentcrm ext enable <id> [--cascade] [--yes]` | Enable an installed extension (plan unless --yes). |
| `disable` | `agentcrm ext disable <id> [--cascade] [--yes]` | Disable it without uninstalling (plan unless --yes). |
| `uninstall` | `agentcrm ext uninstall <id> [--force] [--yes]` | Remove an extension (its module configuration is kept). Plan unless --yes. Plan unless `--yes`. |
| `export` | `agentcrm ext export <id> [--out <file.zip>]` | Download an installed extension as its ZIP. |

| Option | Description |
|---|---|
| `--dir <value>` | new: target folder (default: ./<id>). |
| `--name <value>` | new: display name. |
| `--description <value>` | new: one-sentence description. |
| `--author <value>` | new: author shown in the install plan and Settings → Modules. |
| `--force` | new: write into a non-empty folder. install: skip the trial load (ext check). uninstall: even if enabled modules depend on it. |
| `--kind <value>` | check: expected kind. list: only modules or themes. |
| `--no-call` | check: don't smoke-call the AI tools on the demo data. |
| `--out <value>` | pack / export: ZIP path (default: <dir>/<id>-<version>.zip, ./<id>-<version>.zip). |
| `--disabled` | install: install it disabled. |
| `--cascade` | enable / disable: also enable the dependencies / disable the dependents. |

### `tools`

The AI tool catalog (src/ai/tools.ts + the tools of the site's enabled extension modules) — exactly what the MCP server and the in-admin assistant expose: list the tools with their JSON schemas, or call one with a JSON input.

```text
agentcrm tools <list|call> [<name>] [--input <json|@file>]
```

| Action | Usage | What it does |
|---|---|---|
| `list` | `agentcrm tools list [--site <alias>]` | Tools with description, input schema, whether they write and their source (builtin / extension). |
| `call` | `agentcrm tools call <name> --input <json\|@file>` | Run one tool as the site's CLI user. |

| Option | Description |
|---|---|
| `--input <value>` | call: the tool input as a JSON object or @file. |

### `mcp`

Run the MCP server on stdio (JSON-RPC 2.0, protocol 2025-06-18 / 2024-11-05): tools = the AI catalog incl. the site's extension tools (read-only mode hides the ones that write; --safe skips extensions), resources = schema, pipelines, modules, appearance, prompts = pipeline review, follow-up email, lead qualification. For Claude Desktop / Claude Code / Cursor.

```text
agentcrm mcp [--site <alias>] [--read-only] [--as <user>]
```

| Option | Description |
|---|---|
| `--read-only` | Expose only the tools that don't write. |
