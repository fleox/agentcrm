---
name: agentcrm-admin
description: Run an AgentCRM like its admin does - find, list, create, update, delete, restore and merge records (companies, people, deals, custom objects), log notes, calls, emails and meetings, manage tasks, set contact photos / company logos and attach files (images, PDFs, documents) to records, notes and tasks, move deals through pipeline stages, edit the data model (custom objects and fields), saved views, users and roles, settings, turn modules on and off, change the appearance (brand color, logo, favicon, presets, themes, custom CSS), enable / disable installed extensions, import and export CSV / JSON, reports, automations and lead forms, and call the AI tool catalog. Use when the user wants to read or change data, features or the look of one of their AgentCRM CRMs.
license: PolyForm-Noncommercial-1.0.0
compatibility: Requires Node.js 20+.
metadata:
  version: "0.9.2"
  repository: "https://github.com/fleox/agentcrm"
allowed-tools: Bash Read Write
---

# Run an AgentCRM

The CLI runs the admin's own engine headless: the same validation, roles and automations apply. It acts as the site's CLI user (an admin by default; `--as <email>` acts as another user).

**Language:** talk to the user in their language; keep commands and files in English.

Every command is `npx -y @fleox-agent-crm/agentcrm@0.9.2 <command> --json`; always pass `--site <alias>` (see `agentcrm-manage` to pick one). Read `error.hint` when `ok` is false. `npx -y @fleox-agent-crm/agentcrm@0.9.2 help records --json` lists any command's actions and options.

## Rules

- **Learn the model first:** `objects list`, then `objects get <object>` for field ids, types, select options and relations. Never guess field ids.
- **Search before creating** (`records search`) to avoid duplicates.
- **Destructive commands print a plan** (`needsConfirmation: true`) unless `--yes`: show the plan, ask, then re-run with `--yes`. This covers `records delete`, `records merge`, `files delete`, `objects delete`, `fields delete`, `views delete`, `import csv` (dry run by default), `compact`, `automations run`, `forms publish`, `forms ingest`, and every workspace-wide change: `modules enable|disable|config set`, `appearance set|preset|logo|favicon|css|reset`, `ext install|enable|disable|uninstall`.
- Personal data: don't paste whole exports into the chat; summarise.

## Records

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.2 records list --site acme --object deals --filter stage:in:proposal,negotiation --filter amount:gte:10000 --sort amount:desc --limit 20 --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 records get <id> --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 records search "globex" --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 records create --site acme --object people --set firstName=Grace --set lastName=Hopper --set email=grace@globex.com --set company=<companyId> --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 records update <id> --site acme --set jobTitle=CTO --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 records delete <id> --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 records restore <id> --site acme --json
```

- Filters: `--filter field:op:value`, repeatable. Ops: eq, neq, contains, notContains, empty, notEmpty, gt, gte, lt, lte, in, notIn, before, after, withinDays. Dates: `YYYY-MM-DD`, `today`, `+30d`. Also `id`, `ownerId`, `createdAt`, `updatedAt`.
- Values: `--set key=value` (numbers, true / false, null and JSON arrays are parsed; phone numbers and zip codes stay text) or `--fields '{"...": ...}'` / `--fields @file.json`. Select fields take the option id or label; relations take record ids (arrays for "many"); `null` clears.
- `--columns name,email` trims the output; `--view <id>` applies a saved view; `--deleted` lists the trash.
- Duplicates: `records duplicates --object people --by email,name`, then `records merge <primaryId> <dupId>...` (plan, then `--yes`). Merging fills empty fields and moves relations and activities.

More examples per object: references/records.md.

## Timeline and tasks

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.2 notes add <recordId> --site acme --body "Met at the expo; wants a demo in June." --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 activities add --site acme --type call --title "Discovery call" --record <personId> --record <dealId> --meta '{"durationMin":25}' --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 activities list --site acme --record <companyId> --related --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 tasks add --site acme --title "Send the proposal" --due 2026-11-10 --assignee me --record <dealId> --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 tasks list --site acme --assignee me --overdue --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 tasks done <taskId> --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 tasks reassign <taskId> --site acme --assignee sam@acme.com --json
```

Activity types: note, task, call, email, meeting. `--body @notes.md` reads a file.

## Images and attachments

People have a **photo** (`avatar` field) and companies a **logo** (`logo`), shown next to the name everywhere; custom objects get one by adding an `image` field (the first becomes the object's image). Files (any type: images, PDFs, Office documents…) attach to a record or to an activity (note, task, call, email, meeting).

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.2 records image <personId> ./ada.jpg --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 records image <companyId> ./logo.svg --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 records image <personId> --remove --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 notes add <recordId> --body "Signed contract attached." --attach ./contract.pdf --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 tasks add --title "Review the quote" --record <dealId> --attach ./quote.xlsx --attach ./scope.pdf --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 activities add --type meeting --title "Workshop" --record <companyId> --attach ./whiteboard.png --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 files upload ./brochure.pdf ./photo.png --record <companyId> --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 files upload ./minutes.docx --activity <noteId> --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 files list --record <companyId> --related --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 files get <fileId> --out ./contract.pdf --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 files delete <fileId> --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 files usage --site acme --json
```

- Files live next to the data and are **encrypted with the same passphrase** on the journal backend; IndexedDB in local mode; the data repo (`files/`) for git-json (warn: history keeps them); Firebase Storage for Firebase (Storage must be enabled, see docs/files.md).
- Limit: 25 MB per file by default (`settings set --set maxUploadMb=50`). The admin resizes photos (2560 px) and makes thumbnails; the CLI uploads files as they are — resize big photos before uploading when you can.
- `files list` returns metadata only (name, type, size, what it is attached to); `files get` writes the decrypted bytes to a local file — never paste file contents into the chat.
- `files delete` is a soft delete (plan, then `--yes`): the file disappears from records and activities; `compact --yes` physically erases the bytes (also of files whose record / activity was purged) — GDPR erasure.
- In Markdown bodies an image can be shown inline with `![name](file:<fileId>)` (upload it with `files upload --activity <id>` or `--attach` first).
- AI tools: `list_files`, `describe_attachments` (metadata only; nothing fetches a URL into the CRM). Backups with files: `export zip --out backup.zip` / `import zip backup.zip` (plan, then `--yes`).

## Pipelines

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.2 pipelines list --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 pipelines move <dealId> Negotiation --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 pipelines move <dealId> Lost --lost-reason "Budget" --site acme --json
```

Moving sets the deal's probability to the stage's. Adding / renaming stages is done in the admin (Settings → Data model).

## Data model, views, users, settings (admin role)

See references/schema.md for objects, fields (types, options, relations), views, users and roles, and settings.

## Modules: disable what you don't need

Built-in modules: dashboard, deals (deals object + pipelines), reports, forms, tasks, automations, integrations (email and calendar), assistant (in-admin AI); records, search, settings, setup and customize are required. Installed extension modules are listed with `source: "extension"`. Disabling hides pages, navigation, widgets and owned objects for every user; it never deletes data, and enabling again brings everything back.

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.2 modules list --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 modules disable forms --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 modules disable forms --site acme --yes --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 modules enable deals --site acme --cascade --yes --json
```

- When the user says "we only manage contacts" or "hide what we don't use": list the modules, propose which to turn off (with what each hides), and apply only after they agree.
- A `conflict` error lists the modules that depend on it (`error.message`); `--cascade` also disables them (enable: also enables the dependencies). Show the plan's `changed` list first.
- Module configuration (JSON, used by extensions such as sales goals): `modules config get <id>` / `modules config set <id> --value '<json>'` (plan, then `--yes`). Never store secrets there.

## Appearance: make it look like our brand

One accent color drives the whole palette (a 50 to 950 scale is generated). Applies live to every user.

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.2 appearance get --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 appearance presets --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 appearance set --site acme --accent "#0f766e" --neutral stone --radius lg --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 appearance preset ocean --site acme --yes --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 appearance logo ./logo.svg --site acme --yes --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 appearance favicon ./favicon.png --site acme --yes --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 appearance css ./brand.css --site acme --yes --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 appearance reset --site acme --json
```

- **Brand from a hex:** `appearance set --accent <hex>`, then pick `--neutral` by temperature (blue / teal brands: slate; warm brands: stone; otherwise zinc), `--buttons accent` for a colorful brand. **From a logo:** read the dominant non-gray color of the SVG (its `fill`) or the image, propose it as the accent, and upload the logo itself with `appearance logo`.
- Options and values: references/appearance.md. Each change prints the before / after plan; apply with `--yes`.
- Presets: default, ocean, forest, sunset, graphite, rose, high-contrast, plus installed theme extensions. A preset keeps the logo, favicon and custom CSS.

## Extensions (installed modules and themes)

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.2 ext list --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 ext disable sales-goals --site acme --yes --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 ext enable sales-goals --site acme --yes --json
```

Installing, building or debugging extensions: the `agentcrm-extensions` skill. Installing runs third-party code with admin rights: always show the plan and ask. If the admin misbehaves after an extension change, `ext disable <id> --yes`, or open the admin with `?safe=1`; CLI commands accept `--safe` to skip extensions.

## Import and export

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.2 import csv contacts.csv --site acme --object people --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 import csv contacts.csv --site acme --object people --yes --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 export csv --site acme --object companies --out companies.csv --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 export json --site acme --out backup.json --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 export zip --site acme --out backup.zip --json
```

The import is a DRY RUN until `--yes`: read the report (mapping, per-row action, errors, new select options, companies to create) with the user before applying. Mapping, dedupe and coercion rules: references/import.md.

## Reports and stats

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.2 report pipeline --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 report forecast --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 report won-lost --site acme --months 6 --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 report activity --site acme --days 30 --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 report lead-sources --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 report stale --site acme --days 21 --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 report conversion --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 stats --site acme --json
```

## Automations and lead forms

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.2 automations list --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 automations disable <id> --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 automations run --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 forms list --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 forms publish <formId> --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 forms ingest --site acme --json
```

Event automations (record created, field changed, stage changed) fire on every write, from the CLI too. Building automations and forms is done in the admin; the CLI enables / disables, runs the scheduled ones and ingests form submissions. For a cron, see the `agentcrm-manage` skill.

## AI tool catalog

The same tools the MCP server and the in-admin assistant expose, including the tools of enabled extension modules (`source: "extension"`) the customisation tools (`list_modules`, `set_module_enabled`, `get_appearance`, `set_appearance`, `apply_appearance_preset`, `list_extensions`, `set_extension_enabled`) and the file tools (`list_files`, `describe_attachments`):

```bash
npx -y @fleox-agent-crm/agentcrm@0.9.2 tools list --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.9.2 tools call pipeline_summary --site acme --input '{}' --json
```

Useful when a tool returns exactly what you need in one call (`get_record` with relations and latest activities, `pipeline_summary`).
