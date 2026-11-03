---
name: agentcrm-admin
description: "Run an AgentCRM like its admin does - find, list, create, update, delete, restore and merge records (companies, people, deals, custom objects), log notes, calls, emails and meetings, manage tasks, move deals through pipeline stages, edit the data model (custom objects and fields), saved views, users and roles, settings, import and export CSV / JSON, reports, automations and lead forms, and call the AI tool catalog. Use when the user wants to read or change data in one of their AgentCRM CRMs."
version: 0.1.0
author: AgentCRM
license: PolyForm-Noncommercial-1.0.0
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [AgentCRM, CRM, Records, Import, Reports]
    related_skills: [agentcrm-install, agentcrm-manage, agentcrm-sales]
---

# Run an AgentCRM

The CLI runs the admin's own engine headless: the same validation, roles and automations apply. It acts as the site's CLI user (an admin by default; `--as <email>` acts as another user).

**Language:** talk to the user in their language; keep commands and files in English.

Every command is `python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py <command> --json`; always pass `--site <alias>` (see `agentcrm-manage` to pick one). Read `error.hint` when `ok` is false. `python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py help records --json` lists any command's actions and options.

## Running the commands (Hermes)

Every `agentcrm <command>` below runs through this skill's Python wrapper: `python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py <command> …`. It adds `--json`, prints the CLI's JSON object (`{"ok": true, "data": …}` or `{"ok": false, "error": {code, message, hint}}`) and exits with the CLI's code. In the reference files, `python3 <skill dir>/scripts/agentcrm.py` means the same command with this skill's directory.

- **Requirements:** Python 3.9+ (stdlib only) and **Node.js 20.6+**: the AgentCRM engine is the `@agent-crm/agentcrm` npm package, fetched by `npx` on first use and pinned to the version of these skills. Without Node.js the wrapper answers `node-missing` with how to install it. `AGENTCRM_CMD` overrides the engine command (e.g. `node /path/to/agentcrm.mjs` from a clone).
- **From Python:** `sys.path.insert(0, "${HERMES_SKILL_DIR}/scripts")`, then `from agentcrm import run, AgentcrmError` — `run("records", "list", "--object", "deals", site="acme")` returns `data` and raises `AgentcrmError(code, message, hint)` when `ok` is false.
- **Plans:** a command that needs `--yes` and didn't get it writes nothing and answers `needsConfirmation: true` on `data` — test it with `needs_confirmation(data)` from the wrapper. The sentence "re-run with --yes" only exists in the human output, never match on text.
- **Secrets** never go through the chat. The user either types them in their own terminal (`python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py credentials set <account>` asks at a hidden prompt), or puts them in environment variables (e.g. in `~/.hermes/.env`) that you pass by name: `credentials set <account> --from-env VAR` (`--from-env KEY_ID,SECRET` for S3).
- **Helpers** in `${HERMES_SKILL_DIR}/scripts/` (each prints one JSON object; `--help` for options):
  - `import_csv.py`: Imports a CSV into an AgentCRM object in two steps: a dry run whose report is summarised, then (with --yes) the real import.
  - `add_lead.py`: Adds a lead to AgentCRM without creating duplicates: finds or creates the company (by email domain), finds or creates the person (by email), optionally logs a note and a follow-up task.

## Rules

- **Learn the model first:** `objects list`, then `objects get <object>` for field ids, types, select options and relations. Never guess field ids.
- **Search before creating** (`records search`) to avoid duplicates.
- **Destructive commands print a plan** (`needsConfirmation: true`) unless `--yes`: show the plan, ask, then re-run with `--yes`. This covers `records delete`, `records merge`, `objects delete`, `fields delete`, `views delete`, `import csv` (dry run by default), `compact`, `automations run`, `forms publish`, `forms ingest`.
- Personal data: don't paste whole exports into the chat; summarise.

## Records

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py records list --site acme --object deals --filter stage:in:proposal,negotiation --filter amount:gte:10000 --sort amount:desc --limit 20 --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py records get <id> --site acme --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py records search "globex" --site acme --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py records create --site acme --object people --set firstName=Grace --set lastName=Hopper --set email=grace@globex.com --set company=<companyId> --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py records update <id> --site acme --set jobTitle=CTO --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py records delete <id> --site acme --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py records restore <id> --site acme --json
```

- Filters: `--filter field:op:value`, repeatable. Ops: eq, neq, contains, notContains, empty, notEmpty, gt, gte, lt, lte, in, notIn, before, after, withinDays. Dates: `YYYY-MM-DD`, `today`, `+30d`. Also `id`, `ownerId`, `createdAt`, `updatedAt`.
- Values: `--set key=value` (numbers, true / false, null and JSON arrays are parsed; phone numbers and zip codes stay text) or `--fields '{"...": ...}'` / `--fields @file.json`. Select fields take the option id or label; relations take record ids (arrays for "many"); `null` clears.
- `--columns name,email` trims the output; `--view <id>` applies a saved view; `--deleted` lists the trash.
- Duplicates: `records duplicates --object people --by email,name`, then `records merge <primaryId> <dupId>...` (plan, then `--yes`). Merging fills empty fields and moves relations and activities.

More examples per object: references/records.md.

## Timeline and tasks

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py notes add <recordId> --site acme --body "Met at the expo; wants a demo in June." --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py activities add --site acme --type call --title "Discovery call" --record <personId> --record <dealId> --meta '{"durationMin":25}' --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py activities list --site acme --record <companyId> --related --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py tasks add --site acme --title "Send the proposal" --due 2026-11-10 --assignee me --record <dealId> --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py tasks list --site acme --assignee me --overdue --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py tasks done <taskId> --site acme --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py tasks reassign <taskId> --site acme --assignee sam@acme.com --json
```

Activity types: note, task, call, email, meeting. `--body @notes.md` reads a file.

## Pipelines

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py pipelines list --site acme --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py pipelines move <dealId> Negotiation --site acme --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py pipelines move <dealId> Lost --lost-reason "Budget" --site acme --json
```

Moving sets the deal's probability to the stage's. Adding / renaming stages is done in the admin (Settings → Data model).

## Data model, views, users, settings (admin role)

See references/schema.md for objects, fields (types, options, relations), views, users and roles, and settings.

## Import and export

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py import csv contacts.csv --site acme --object people --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py import csv contacts.csv --site acme --object people --yes --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py export csv --site acme --object companies --out companies.csv --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py export json --site acme --out backup.json --json
```

The import is a DRY RUN until `--yes`: read the report (mapping, per-row action, errors, new select options, companies to create) with the user before applying. Mapping, dedupe and coercion rules: references/import.md.

## Reports and stats

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py report pipeline --site acme --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py report forecast --site acme --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py report won-lost --site acme --months 6 --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py report activity --site acme --days 30 --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py report lead-sources --site acme --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py report stale --site acme --days 21 --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py report conversion --site acme --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py stats --site acme --json
```

## Automations and lead forms

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py automations list --site acme --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py automations disable <id> --site acme --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py automations run --site acme --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py forms list --site acme --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py forms publish <formId> --site acme --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py forms ingest --site acme --json
```

Event automations (record created, field changed, stage changed) fire on every write, from the CLI too. Building automations and forms is done in the admin; the CLI enables / disables, runs the scheduled ones and ingests form submissions. For a cron, see the `agentcrm-manage` skill.

## AI tool catalog

The same tools the MCP server and the in-admin assistant expose:

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py tools list --site acme --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py tools call pipeline_summary --site acme --input '{}' --json
```

Useful when a tool returns exactly what you need in one call (`get_record` with relations and latest activities, `pipeline_summary`).
