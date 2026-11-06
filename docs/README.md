# AgentCRM documentation

| Document | For |
|---|---|
| [architecture.md](architecture.md) | How the pieces fit: one engine, four front doors, the DataStore backends, the journal |
| [data-model.md](data-model.md) | Objects, fields (record images, drilldowns, rollups, link filters), standard objects, collections (`fieldUpdates`, user `prefs`, tombstones), roles, storage formats |
| [cli.md](cli.md) | The `agentcrm` CLI: conventions, state, install plan, every command |
| [schema-as-code.md](schema-as-code.md) | `schema apply`: the data model (objects, fields, options, pipelines, views, drilldowns, rollups, image fields) as a JSON file, annotated example |
| [sync.md](sync.md) | `records sync`: mirror an external source by key (relations by key, archive field), recipes and a scheduled GitHub Action |
| [mcp.md](mcp.md) | The MCP server: client configuration (Claude Code / Desktop, Cursor), tools, resources, prompts |
| [modules.md](modules.md) | Built-in modules, dependencies, what disabling hides, module configuration |
| [appearance.md](appearance.md) | Appearance options, presets, logo / favicon, custom CSS variables |
| [extensions.md](extensions.md) | Extension modules and themes: safety, installing / enabling / safe mode, package format |
| [creating-a-module.md](creating-a-module.md) | Writing a module: scaffold, definition, recipes (custom object, record tab, widget, AI tool, automation action, settings page, hooks) |
| [creating-a-theme.md](creating-a-theme.md) | Writing a theme: values, brand colors, CSS |
| [runtime-api-reference.md](runtime-api-reference.md) | Every export of `@agent-crm/runtime` |
| [automations.md](automations.md) | Automations, lead forms and the GitHub Actions cron ([template](templates/agentcrm-cron.yml)) |
| [files.md](files.md) | Images & attachments: where files live per backend, record images from a URL, encryption, limits, GDPR purge, Firebase Storage, the HTTP files endpoint, CORS |
| [import-export.md](import-export.md) | CSV import (mapping, dedupe, dry run), `import csv` vs `records sync`, CSV / JSON export |
| [hosting.md](hosting.md) | Hosting the admin (S3, Pages, local) |
| [firebase.md](firebase.md) | The Firebase backend: setup, security rules, the CLI login and sessions, incremental loading and costs, files |
| [releasing.md](releasing.md) | Release process (maintainers) |

Agent skills: [`plugin/skills/`](../plugin/skills) (Claude Code plugin) and [`hermes/`](../hermes) (Hermes Agent). Security: [SECURITY.md](../SECURITY.md).
