# Automations, lead forms and cron — without a server

## How automations run

An automation = a trigger + conditions (filters) + actions.

| Trigger | When it runs |
|---|---|
| `record.created`, `record.updated`, `field.changed`, `stage.changed` | In-process, right after the write — in the browser, in the CLI (`agentcrm records …`, `import csv --yes`), in the MCP server, in the assistant. Every front door installs the engine (`installAutomations`). [`records sync`](sync.md) deliberately fires none (bulk mirror). |
| `schedule` (every N hours), `inactivity` (no activity for N days) | `runScheduled`: periodically while an admin tab is open, or from `agentcrm automations run --yes` (cron). |

Actions: create a task (due in N days, assigned to the owner or a user), update a field, add a note, assign an owner (fixed or round robin), call a webhook. Every run is logged in `automationRuns` (see the admin's run log). Writes made by an automation carry a depth counter; nesting stops at 3 to prevent loops.

CLI:

```bash
agentcrm automations list --site acme
agentcrm automations disable <id> --site acme
agentcrm automations run --site acme            # dry run: what would happen
agentcrm automations run --site acme --yes      # do it
agentcrm automations run --site acme --id <automationId> --force --yes
```

## Lead forms

A form is published as a static page (`forms publish <id> --yes` uploads it to the hosting and returns the embed snippet). Visitors' submissions go to an inbox **you** own:

- `s3`: the page PUTs a JSON file under a bucket prefix writable anonymously (write-only bucket policy); the CLI / admin reads it with the site's hosting (or data) credential;
- `firebase`: a Firestore collection with create-only rules;
- `webhook`: your own endpoint (Formspree, Make, Zapier, n8n…) — submissions don't come back to the CRM automatically.

`forms ingest` turns pending submissions into records (deduped by email, company created from the email domain, an activity logged), then removes them from the inbox:

```bash
agentcrm forms ingest --site acme           # dry run
agentcrm forms ingest --site acme --yes
```

## Cron with GitHub Actions

Copy [`templates/agentcrm-cron.yml`](templates/agentcrm-cron.yml) into `.github/workflows/` of a **private** repository and add the secrets it lists. Every hour it:

1. stores the credentials from repository secrets with `credentials set … --from-env` (never printed);
2. registers the CRM with `site add crm --runtime "$AGENTCRM_RUNTIME"` (the public `config.js` object);
3. runs `automations run --yes` and `forms ingest --yes`.

The journal backend makes this safe while people use the admin: the job only appends encrypted segments (no lock, no conflict). Don't run `compact` from the cron and from a computer at the same time.

Any other scheduler works the same way (a systemd timer, a cron on a NAS, a CI of your choice): the commands are idempotent and print one JSON object.
