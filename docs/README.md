# AgentCRM documentation

| Document | For |
|---|---|
| [architecture.md](architecture.md) | How the pieces fit: one engine, four front doors, the DataStore backends, the journal |
| [data-model.md](data-model.md) | Objects, fields, standard objects, collections, roles, storage formats |
| [cli.md](cli.md) | The `agentcrm` CLI: conventions, state, install plan, every command |
| [mcp.md](mcp.md) | The MCP server: client configuration (Claude Code / Desktop, Cursor), tools, resources, prompts |
| [automations.md](automations.md) | Automations, lead forms and the GitHub Actions cron ([template](templates/agentcrm-cron.yml)) |
| [import-export.md](import-export.md) | CSV import (mapping, dedupe, dry run), CSV / JSON export |
| [hosting.md](hosting.md) | Hosting the admin (S3, Pages, local) |
| [firebase.md](firebase.md) | The Firebase backend and its security rules |
| [releasing.md](releasing.md) | Release process (maintainers) |

Agent skills: [`plugin/skills/`](../plugin/skills) (Claude Code plugin) and [`hermes/`](../hermes) (Hermes Agent). Security: [SECURITY.md](../SECURITY.md).
