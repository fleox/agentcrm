---
name: agentcrm-manage
description: Check, repair and update existing AgentCRM CRMs - list the CRMs this computer manages, register one installed elsewhere (another computer, the setup wizard), attach credentials, run the health check (data access, passphrase, dataset, hosted admin, config.js, CORS, data exposure) and apply its fixes, detect newer AgentCRM releases and offer to update hosted admins, compact the data, set up scheduled automations. Use when the user asks about one of their CRMs, says something is broken, or wants to update.
license: PolyForm-Noncommercial-1.0.0
compatibility: Requires Node.js 20+.
metadata:
  version: "0.12.1"
  repository: "https://github.com/fleox/agentcrm"
allowed-tools: Bash Read Write
---

# Manage AgentCRM sites

This skill covers the CRMs themselves (registry, health, updates, maintenance). To work with the data - records, pipelines, imports - use `agentcrm-admin`; for sales workflows, `agentcrm-sales`.

**Language:** talk to the user in their language; keep commands and files in English.

Every command is `npx -y @fleox-agent-crm/agentcrm@0.12.1 <command> --json` (Node.js 20+); read `error.hint` whenever `ok` is false.

## Always start with status

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.1 status --json
```

- `data.tool.updateAvailable: true` -> tell the user AgentCRM `data.tool.latest` exists and offer to update the skills first (Claude Code: `/plugin marketplace update agentcrm`, then `/reload-plugins`).
- A site with `state: "update"` -> summarise `update.changes` (breaking first), then offer `deploy-admin` (below). Never update silently.
- `state: "newer"` -> the hosted admin is newer than this tool: update the skills / tool first.
- `state: "unreachable"` -> run `doctor` for that site.
- `data.advice` already phrases these; relay it.

## Which CRM?

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.1 site list --json
npx -y @fleox-agent-crm/agentcrm@0.12.1 site show <alias> --json
```

Commands take `--site <alias>`; always pass it. Without it the tool uses `AGENTCRM_SITE`, the folder's `agentcrm.json` (`{ "site": "<alias>" }`), the only site, or the default chosen with `site use <alias>` - otherwise it fails with `site-required`: ask the user which CRM. Say which CRM you are working on before changing anything.

Registry commands: `site use <alias>`, `site rename <from> <to>`, `site forget <alias>` (local only - nothing is deleted online).

## Register a CRM installed elsewhere

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.1 site add <alias> --admin-url https://crm.acme.com/admin/ --data-credential s3:main --passphrase-credential passphrase:acme --hosting-credential s3:main --json
```

- It reads the admin's public `config.js`, opens the data (proving the credentials) and reads the hosting from the dataset.
- `--data-credential`: the data location key (journal), the git token (git-json) or the Firebase login.
- `--passphrase-credential`: encrypted journals. The user stores the passphrase from their password manager: `! npx -y @fleox-agent-crm/agentcrm@0.12.1 credentials set passphrase:<alias>`.
- `--user <email>`: the CRM user the CLI acts as (default: the first admin).
- A CRM in a local folder without a hosted admin: `site add <alias> --runtime @config.json --data-path /path/to/folder`.
- `warnings` lists what is still missing; fix later with `site credentials <alias> --hosting-credential <account>` (`""` removes one).
- The runtime config changed on the CRM's side (e.g. a Firebase CRM now sends files to an HTTP files endpoint): `site runtime <alias> --runtime @runtime.json` replaces the copy this computer uses (same backend and project only; otherwise `site forget` + `site add`). Start from the `runtime` object of `site show <alias>`; a files endpoint must be an absolute URL for the CLI (`agentcrm-install` skill, references/firebase.md).
- Errors `passphrase-required` / `passphrase-wrong`: store the right passphrase and retry.
- Firebase CRMs: `--data-credential firebase:<name>` is the user's own login (email verified); the CLI acts as that user through the Firestore rules, keeps its session in `~/.agentcrm/sessions/` and a local copy of the data in `~/.agentcrm/cache/` (only changes are read on later commands). After `credentials set` / `remove` of that login its session is forgotten and the next command signs in again.

## Health check

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.1 doctor --site <alias> --json
```

`data.checks[]` has `id`, `status` (ok / warn / fail / skip), `message` and, for problems, `fix`. Exit code 1 when a check fails. Walk the user through each fix, most important first:

- `data-access` fail -> credentials or passphrase (see `fix`).
- `dataset` fail -> `doctor --site <alias> --repair --json` seeds what's missing (idempotent, keeps data).
- `cors-data` warn -> the data bucket lacks a CORS rule for the admin origin; `fix` holds the exact JSON (see the `agentcrm-install` skill, references/s3.md).
- `data-exposure` fail -> the unencrypted dataset is public: make it private NOW, then move it.
- `config-js` fail with secrets -> revoke those keys immediately, then `deploy-admin`.
- `https` fail -> the admin needs HTTPS.
- `purge` / `journal` warn -> compaction (below).
- `firestore-reads` (Firebase, informational) -> the Firestore reads the load cost: a full read on the first command or once a week, then about 15 when nothing changed. A full read on every command means the local copy isn't kept: check that `~/.agentcrm/cache/` is writable.
- Firebase, after an update: deletes or profile edits refused (`permission-denied`), or list layouts remembered in each browser only -> the Firestore rules are older than the release: re-publish them (`options --firebase-rules <bootstrap admin email>`, or Settings → Data backend in the admin).

Details of every check: references/doctor.md.

## Update a hosted admin

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.1 deploy-admin --site <alias> --json
npx -y @fleox-agent-crm/agentcrm@0.12.1 deploy-admin --site <alias> --yes --json
```

Without `--yes` it prints the plan (`needsConfirmation: true`, versions, file count): show it, ask, then re-run with `--yes`. `--all` covers every CRM with a hosting. It refuses downgrades and admins that store a newer data format. GitHub / GitLab Pages need a minute before `doctor` sees the new version.

## Compact (GDPR erasure)

Deleted records stay restorable until compaction. To erase them physically and shrink the journal:

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.1 compact --site <alias> --json
npx -y @fleox-agent-crm/agentcrm@0.12.1 compact --site <alias> --yes --json
```

Show the plan (records purged) and confirm first: it can't be undone. Run it from one place at a time.

## Scheduled automations and lead forms (no server)

Scheduled / inactivity automations and lead form ingestion run when the admin is open, or from a cron. The recommended cron is a GitHub Actions workflow in a private repo: references/cron.md. Locally:

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.1 automations run --site <alias> --yes --json
npx -y @fleox-agent-crm/agentcrm@0.12.1 forms ingest --site <alias> --yes --json
```

## Overview of one CRM

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.1 stats --site <alias> --json
```
