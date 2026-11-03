# AgentCRM for Hermes Agent

Skills and Python scripts that let [Hermes Agent](https://hermes-agent.nousresearch.com) (and any agent that prefers Python) install and run AgentCRM: create an encrypted CRM on storage you own, work with records, pipelines and imports, and run sales workflows.

| Skill | Use it to |
|---|---|
| [`agentcrm-install`](skills/agentcrm-install/SKILL.md) | install a new CRM (data location + admin hosting + credentials) |
| [`agentcrm-manage`](skills/agentcrm-manage/SKILL.md) | check, repair, register and update existing CRMs |
| [`agentcrm-admin`](skills/agentcrm-admin/SKILL.md) | records, schema, pipelines, views, users, import / export, automations, forms |
| [`agentcrm-sales`](skills/agentcrm-sales/SKILL.md) | pipeline review, follow-ups, meeting prep, lead qualification, weekly report |

## Install

```bash
hermes skills install fleox/agentcrm/hermes/skills/agentcrm-admin
```

Or from a clone, in `~/.hermes/config.yaml`:

```yaml
skills:
  external_dirs:
    - /path/to/agentcrm/hermes/skills
```

## Requirements

- **Python 3.9+** — standard library only.
- **Node.js 20.6+** — the engine is the [`@agent-crm/agentcrm`](https://www.npmjs.com/package/@agent-crm/agentcrm) npm package, run with `npx` and pinned to the skills' version. `AGENTCRM_CMD` overrides it (e.g. `AGENTCRM_CMD="node /path/to/agentcrm/dist/agent/agentcrm.mjs"`).

## The scripts

Every skill ships `scripts/agentcrm.py`, a dependency-free wrapper of the CLI (adds `--json`, prints the CLI's JSON object, keeps its exit code):

```python
import sys; sys.path.insert(0, "<skill dir>/scripts")
from agentcrm import run, needs_confirmation, AgentcrmError

deals = run("records", "list", "--object", "deals", "--filter", "stage:eq:proposal", site="acme")["records"]
```

| Script | Skills | What it does |
|---|---|---|
| `import_csv.py` | admin, sales | Dry run then (`--yes`) import of a CSV, optional `--source` lead source on every row, compact summary + errors. |
| `pipeline_report.py` | manage, sales | Pipeline, forecast, stale deals, won / lost and overdue tasks in one JSON or Markdown report. |
| `add_lead.py` | admin, sales | Finds or creates the company (by email domain) and the person (by email), adds a note and a follow-up task. |

## Secrets

Never in the chat. The user types them in their own terminal (`python3 scripts/agentcrm.py credentials set s3:main`), or keeps them in environment variables passed by name: `credentials set s3:main --from-env S3_KEY_ID,S3_SECRET`. They are stored in `~/.agentcrm/credentials.json` (mode 0600).

## Maintenance (this repository)

`hermes/skills/` is generated — don't edit it. Text comes from [`plugin/skills/`](../plugin/skills), scripts from [`hermes/python/`](python). `npm run hermes:build` regenerates it; `npm run check:hermes` verifies it is up to date and runs the Python tests ([`hermes/tests/`](tests), fake engine, no network).
