# Scheduled automations with GitHub Actions

AgentCRM has no server, so time-based work (schedule / inactivity automations, ingesting lead form submissions) runs from a scheduled GitHub Actions workflow in a PRIVATE repository the user owns.

1. Create a private repo (e.g. `acme/crm-cron`).
2. Add repository secrets (Settings → Secrets and variables → Actions): `AGENTCRM_S3_KEY_ID`, `AGENTCRM_S3_SECRET`, `AGENTCRM_PASSPHRASE` (the dataset passphrase), and the site's public config as `AGENTCRM_RUNTIME` (the object of the admin's `config.js`, JSON).
3. Copy `docs/templates/agentcrm-cron.yml` of the AgentCRM repository to `.github/workflows/agentcrm-cron.yml`.

The workflow stores the credentials with `credentials set … --from-env`, registers the CRM with `site add --runtime`, then runs `automations run --yes` and `forms ingest --yes` every hour. Each run writes only journal segments (no conflict with users editing at the same time).

The same workflow can keep a mirror up to date: add a step that exports the source system's rows to `rows.json`, then `npx -y @fleox-agent-crm/agentcrm@0.12.0 records sync --object <id> --key <keyField> --rows @rows.json --archive-field <boolField> --yes --json` (diff-only: a run with nothing new writes nothing; recipe in the `agentcrm-admin` skill, references/sync.md). Try the command without `--yes` locally first.

Keep the passphrase secret strictly in the private repo; anyone with it can read the CRM.
