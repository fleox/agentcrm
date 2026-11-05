# Modules

AgentCRM is split into modules that an admin can switch on and off for the whole workspace — Settings → **Modules**. A small team that only tracks contacts can hide deals, reports, forms and automations; turning a module back on restores everything. **Disabling never deletes data.**

Extension modules ([extensions.md](extensions.md)) appear in the same list (badge *Extension*) and follow the same rules.

## Built-in modules

| Id | Name | Category | Required | What disabling hides |
|---|---|---|---|---|
| `records` | Records | core | yes | — (objects, records, table & kanban views, record pages) |
| `search` | Search | core | yes | — (Cmd+K palette) |
| `settings` | Settings | core | yes | — (workspace settings, data model, users, import / export) |
| `setup` | Setup & access | core | yes | — (setup wizard, sign-in, data backend, hosting) |
| `customize` | Customisation | customisation | yes | — (Settings → Modules and Appearance) |
| `dashboard` | Dashboard | sales | | The home dashboard and its widgets; `/` opens the first object instead. |
| `deals` | Deals & pipelines | sales | | The **deals** object (navigation, search, relations), Settings → Pipelines, pipeline reports and dashboard widgets. Deal records stay in the data. |
| `reports` | Reports | sales | | The Reports page. |
| `forms` | Lead forms | sales | | The form builder and inbox ingestion pages (published forms keep collecting into their inbox). |
| `tasks` | Tasks | productivity | | The My tasks / all tasks page and task overlays (tasks stay on record timelines). |
| `automations` | Automations | automation | | The automation list / editor and run log. |
| `integrations` | Email & calendar | integrations | | Gmail, Google Calendar and Outlook sync (Settings → Integrations). |
| `assistant` | AI assistant | ai | | The chat panel driving the AI tools with your own Claude API key (Settings → Assistant). |

The five required modules can't be disabled. Built-in modules have no dependencies between them; extension modules can declare `dependsOn` (e.g. `sales-goals` needs `deals`).

## Dependencies

- Enabling a module whose dependency is off is refused; with **cascade** (the admin asks, CLI `--cascade`) the dependency is enabled too.
- Disabling a module that enabled modules depend on is refused; with cascade they are disabled too. The admin's confirmation (and the CLI plan) lists every module that changes.
- An extension module installed while its dependencies are off is installed disabled.

## Module settings and configuration

Modules with a settings section link to it from their card (deals → Pipelines, integrations, assistant). Extension modules can have a settings page at Settings → Modules → *module* (`/settings/modules/<id>`), backed by a per-module JSON configuration (`config/modules` → `config.<id>`, ≤ 256 KB, never secrets — keys such as `apiKey`, `token`, `secret`, `password` are refused). The configuration is kept when the module is disabled or its extension uninstalled.

## State

`config/modules` = `{ disabled: [built-in ids], config: { [moduleId]: JSON } }`; extension modules are enabled through their extension document. Routes of a disabled module show a "module disabled" page (with a link to Settings → Modules for admins); objects of a disabled module are hidden from navigation, search and pickers.

## CLI

```bash
npx -y @fleox-agent-crm/agentcrm@0.10.0 modules list --site acme
npx -y @fleox-agent-crm/agentcrm@0.10.0 modules get deals --site acme
npx -y @fleox-agent-crm/agentcrm@0.10.0 modules disable forms --site acme                  # plan: which modules change
npx -y @fleox-agent-crm/agentcrm@0.10.0 modules disable forms --site acme --yes
npx -y @fleox-agent-crm/agentcrm@0.10.0 modules disable deals --site acme --cascade --yes  # also disables modules needing deals
npx -y @fleox-agent-crm/agentcrm@0.10.0 modules enable deals --site acme --yes
npx -y @fleox-agent-crm/agentcrm@0.10.0 modules config get sales-goals --site acme
npx -y @fleox-agent-crm/agentcrm@0.10.0 modules config set sales-goals --value '{"targets":{"owner":50000}}' --site acme --yes
```

AI tools: `list_modules`, `set_module_enabled` (`cascade`); MCP resource: `agentcrm://modules`.

## With an AI agent

> "We don't use deals or lead forms — hide what we don't need."
>
> "Turn the automations back on."

The agent lists the modules, proposes what to switch off and what it hides, and applies the change once you agree.

## Adding a built-in module (maintainers)

A new `src/features/<id>/` feature = a catalog entry in `src/core/modules.ts` (`BUILTIN_MODULES`), `module: moduleMeta("<id>")` in its `index.ts`, and the i18n keys `customize:modules.catalog.<id>.{name,description}` (en + fr). `src/ops/modules.test.ts` keeps the features and the catalog identical.
