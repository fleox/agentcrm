---
name: agentcrm-manage
description: "Check, repair and update existing AgentCRM CRMs - list the CRMs this computer manages, register one installed elsewhere (another computer, the setup wizard), attach credentials, run the health check (data access, passphrase, dataset, hosted admin, config.js, CORS, data exposure) and apply its fixes, detect newer AgentCRM releases and offer to update hosted admins, compact the data, set up scheduled automations. Use when the user asks about one of their CRMs, says something is broken, or wants to update."
version: 0.2.0
author: AgentCRM
license: PolyForm-Noncommercial-1.0.0
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [AgentCRM, CRM, Maintenance, Updates]
    related_skills: [agentcrm-install, agentcrm-admin, agentcrm-sales, agentcrm-extensions]
---

# Manage AgentCRM sites

This skill covers the CRMs themselves (registry, health, updates, maintenance). To work with the data - records, pipelines, imports - use `agentcrm-admin`; for sales workflows, `agentcrm-sales`.

**Language:** talk to the user in their language; keep commands and files in English.

Every command is `python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py <command> --json` (Node.js 20+); read `error.hint` whenever `ok` is false.

## Running the commands (Hermes)

Every `agentcrm <command>` below runs through this skill's Python wrapper: `python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py <command> …`. It adds `--json`, prints the CLI's JSON object (`{"ok": true, "data": …}` or `{"ok": false, "error": {code, message, hint}}`) and exits with the CLI's code. In the reference files, `python3 <skill dir>/scripts/agentcrm.py` means the same command with this skill's directory.

- **Requirements:** Python 3.9+ (stdlib only) and **Node.js 20.6+**: the AgentCRM engine is the `@agent-crm/agentcrm` npm package, fetched by `npx` on first use and pinned to the version of these skills. Without Node.js the wrapper answers `node-missing` with how to install it. `AGENTCRM_CMD` overrides the engine command (e.g. `node /path/to/agentcrm.mjs` from a clone).
- **From Python:** `sys.path.insert(0, "${HERMES_SKILL_DIR}/scripts")`, then `from agentcrm import run, AgentcrmError` — `run("records", "list", "--object", "deals", site="acme")` returns `data` and raises `AgentcrmError(code, message, hint)` when `ok` is false.
- **Plans:** a command that needs `--yes` and didn't get it writes nothing and answers `needsConfirmation: true` on `data` — test it with `needs_confirmation(data)` from the wrapper. The sentence "re-run with --yes" only exists in the human output, never match on text.
- **Secrets** never go through the chat. The user either types them in their own terminal (`python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py credentials set <account>` asks at a hidden prompt), or puts them in environment variables (e.g. in `~/.hermes/.env`) that you pass by name: `credentials set <account> --from-env VAR` (`--from-env KEY_ID,SECRET` for S3).
- **Helpers** in `${HERMES_SKILL_DIR}/scripts/` (each prints one JSON object; `--help` for options):
  - `pipeline_report.py`: Builds a pipeline review (forecast, stale deals, overdue tasks, won / lost) for one AgentCRM site as JSON or Markdown.

## Always start with status

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py status --json
```

- `data.tool.updateAvailable: true` -> tell the user AgentCRM `data.tool.latest` exists and offer to update the skills first (Hermes: `hermes skills update`, or re-install them from the repository's `hermes/skills`).
- A site with `state: "update"` -> summarise `update.changes` (breaking first), then offer `deploy-admin` (below). Never update silently.
- `state: "newer"` -> the hosted admin is newer than this tool: update the skills / tool first.
- `state: "unreachable"` -> run `doctor` for that site.
- `data.advice` already phrases these; relay it.

## Which CRM?

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py site list --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py site show <alias> --json
```

Commands take `--site <alias>`; always pass it. Without it the tool uses `AGENTCRM_SITE`, the folder's `agentcrm.json` (`{ "site": "<alias>" }`), the only site, or the default chosen with `site use <alias>` - otherwise it fails with `site-required`: ask the user which CRM. Say which CRM you are working on before changing anything.

Registry commands: `site use <alias>`, `site rename <from> <to>`, `site forget <alias>` (local only - nothing is deleted online).

## Register a CRM installed elsewhere

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py site add <alias> --admin-url https://crm.acme.com/admin/ --data-credential s3:main --passphrase-credential passphrase:acme --hosting-credential s3:main --json
```

- It reads the admin's public `config.js`, opens the data (proving the credentials) and reads the hosting from the dataset.
- `--data-credential`: the data location key (journal), the git token (git-json) or the Firebase login.
- `--passphrase-credential`: encrypted journals. The user stores the passphrase from their password manager: `python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py credentials set passphrase:<alias>`.
- `--user <email>`: the CRM user the CLI acts as (default: the first admin).
- A CRM in a local folder without a hosted admin: `site add <alias> --runtime @config.json --data-path /path/to/folder`.
- `warnings` lists what is still missing; fix later with `site credentials <alias> --hosting-credential <account>` (`""` removes one).
- Errors `passphrase-required` / `passphrase-wrong`: store the right passphrase and retry.

## Health check

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py doctor --site <alias> --json
```

`data.checks[]` has `id`, `status` (ok / warn / fail / skip), `message` and, for problems, `fix`. Exit code 1 when a check fails. Walk the user through each fix, most important first:

- `data-access` fail -> credentials or passphrase (see `fix`).
- `dataset` fail -> `doctor --site <alias> --repair --json` seeds what's missing (idempotent, keeps data).
- `cors-data` warn -> the data bucket lacks a CORS rule for the admin origin; `fix` holds the exact JSON (see the `agentcrm-install` skill, references/s3.md).
- `data-exposure` fail -> the unencrypted dataset is public: make it private NOW, then move it.
- `config-js` fail with secrets -> revoke those keys immediately, then `deploy-admin`.
- `https` fail -> the admin needs HTTPS.
- `purge` / `journal` warn -> compaction (below).

Details of every check: references/doctor.md.

## Update a hosted admin

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py deploy-admin --site <alias> --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py deploy-admin --site <alias> --yes --json
```

Without `--yes` it prints the plan (`needsConfirmation: true`, versions, file count): show it, ask, then re-run with `--yes`. `--all` covers every CRM with a hosting. It refuses downgrades and admins that store a newer data format. GitHub / GitLab Pages need a minute before `doctor` sees the new version.

## Compact (GDPR erasure)

Deleted records stay restorable until compaction. To erase them physically and shrink the journal:

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py compact --site <alias> --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py compact --site <alias> --yes --json
```

Show the plan (records purged) and confirm first: it can't be undone. Run it from one place at a time.

## Scheduled automations and lead forms (no server)

Scheduled / inactivity automations and lead form ingestion run when the admin is open, or from a cron. The recommended cron is a GitHub Actions workflow in a private repo: references/cron.md. Locally:

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py automations run --site <alias> --yes --json
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py forms ingest --site <alias> --yes --json
```

## Overview of one CRM

```bash
python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py stats --site <alias> --json
```
