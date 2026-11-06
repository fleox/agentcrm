---
name: agentcrm-extensions
description: "Create, test and ship AgentCRM extensions - scaffold a module or theme project, write pages, record tabs, dashboard widgets, settings pages with module config, AI tools, automation actions and hooks against the @agent-crm/runtime API, validate the bundle exactly as the admin loads it, pack the ZIP and install / enable / disable / uninstall / export it on a CRM. Use when the user wants a new module or theme for AgentCRM, wants to change or debug one, or asks how AgentCRM extensions work."
version: 0.12.0
author: AgentCRM
license: PolyForm-Noncommercial-1.0.0
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [AgentCRM, CRM, Extensions, Modules, Themes]
    related_skills: [agentcrm-install, agentcrm-manage, agentcrm-admin, agentcrm-sales]
---

# Build AgentCRM modules and themes

**Language:** talk to the user in their language; code, comments, files and these instructions stay in English. Ship UI strings in English and French (`i18n: { en, fr }`).

## Running the commands (Hermes)

Every `agentcrm <command>` below runs through this skill's Python wrapper: `python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py <command> …`. It adds `--json`, prints the CLI's JSON object (`{"ok": true, "data": …}` or `{"ok": false, "error": {code, message, hint}}`) and exits with the CLI's code. In the reference files, `python3 <skill dir>/scripts/agentcrm.py` means the same command with this skill's directory.

- **Requirements:** Python 3.9+ (stdlib only) and **Node.js 20.6+**: the AgentCRM engine is the `@fleox-agent-crm/agentcrm` npm package, fetched by `npx` on first use and pinned to the version of these skills. Without Node.js the wrapper answers `node-missing` with how to install it. `AGENTCRM_CMD` overrides the engine command (e.g. `node /path/to/agentcrm.mjs` from a clone).
- **From Python:** `sys.path.insert(0, "${HERMES_SKILL_DIR}/scripts")`, then `from agentcrm import run, AgentcrmError` — `run("records", "list", "--object", "deals", site="acme")` returns `data` and raises `AgentcrmError(code, message, hint)` when `ok` is false.
- **Plans:** a command that needs `--yes` and didn't get it writes nothing and answers `needsConfirmation: true` on `data` — test it with `needs_confirmation(data)` from the wrapper. The sentence "re-run with --yes" only exists in the human output, never match on text.
- **Secrets** never go through the chat. The user either types them in their own terminal (`python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py credentials set <account>` asks at a hidden prompt), or puts them in environment variables (e.g. in `~/.hermes/.env`) that you pass by name: `credentials set <account> --from-env VAR` (`--from-env KEY_ID,SECRET` for S3).

## How AgentCRM runs extensions (read this first)

AgentCRM is a static CRM: the admin is a single-page app that runs in the browser, the CLI / MCP server run the same engine in Node. There is no server. An extension is **one ES module** (`bundle.js`) plus `manifest.json` (and an optional `style.css`), packed in a ZIP:

- Installing stores the package **in the CRM's own data** (collection `extensions`, encrypted with the rest, shared by every user). No hosting, no rebuild.
- When the admin starts (and when an extension is installed / enabled / upgraded, live), it `import()`s every enabled `bundle.js` and reads its **default export**: `defineModule({...})` or `defineTheme({...})`.
- The bundle gets React, react-dom, react-i18next, lucide-react and the CRM API (`@agent-crm/runtime`) from the admin. These must stay **external** at build time (the scaffold's `vite.config.ts` does it). Any other import must be bundled in.
- **Modules** add a Feature (routes + navigation, slots: record tabs / panels / actions, dashboard widgets, settings sections, overlays), a settings page (Settings, Modules, the module), AI tools (MCP, in-admin assistant, `agentcrm tools`), automation actions (automation editor) and hooks on CRM actions (`register(api)`). The module id is also its i18n namespace and its module-config key.
- **Themes** are a set of appearance values (accent, neutral, radius, density, font, sidebar, buttons, contrast, default mode) plus optional CSS. They show up as presets in Settings, Appearance.
- The CLI loads the same enabled modules in every session: their AI tools appear in `tools list` and the MCP server, their hooks see CLI writes, their automation actions run in `automations run`. `--safe` skips them.

## Safety rules (always)

- **Installing runs code with admin rights.** The bundle runs in the admin of every user who opens the CRM (admins included) and in CLI / MCP sessions. Before `ext install … --yes`, show the user the plan (id, version, author, upgrade or not, size, dependencies) and get an explicit yes. Never install a ZIP from an unknown source without saying so.
- Every write in this skill prints a plan unless `--yes`: `ext install`, `ext enable`, `ext disable`, `ext uninstall`, `modules enable|disable|config set`, `appearance …`. Show the plan, ask, then re-run with `--yes`.
- Never put secrets (API keys, tokens, passwords) in module config or in the bundle: they would be readable by every CRM user. `modules config set` refuses well-known secret keys.
- If an extension breaks the admin: `ext disable <id> --yes` from the CLI, or open the admin with `?safe=1` (or hold Shift while it loads) to start without extensions.

## The toolchain: `agentcrm ext`

Every command is `npx -y @fleox-agent-crm/agentcrm@0.12.0 <command> … --json`. Read `error.hint` when `ok` is false.

| Action | What it does |
|---|---|
| `ext new module\|theme <id> [--dir <path>] [--name "…"] [--description "…"] [--author "…"] [--force]` | Scaffolds a standalone project: `package.json` (scripts build / typecheck / check / pack), `vite.config.ts` (runtime specifiers external, one `bundle.js`), `tsconfig.json` mapped to `types/agentcrm-runtime.d.ts` (copied from the CLI), `manifest.json`, `src/index.tsx` (module: a page with a nav entry, a record tab, an AI tool, en + fr strings) or `src/index.ts` + `src/style.css` (theme), README. |
| `ext check [<dir\|zip>] [--kind module\|theme] [--no-call]` | Validates manifest (id, kind, semver, apiVersion range, unknown keys), sizes, bundle imports (runtime specifiers only), default export, production JSX; then installs it in a throw-away demo CRM, loads it through the real loader and reports what it registers: routes, navigation, slots, settings page, i18n, AI tools (each one without required inputs is called once with `{}` on demo data), automation actions, hooks, theme values. Exit code 1 when `data.valid` is false. |
| `ext pack [<dir>] [--out <zip>]` | Writes `<id>-<version>.zip` (manifest.json + bundle.js + style.css) for Settings, Modules, Install, or `ext install`. |
| `ext install <zip\|dir> --site <alias> [--disabled] [--force] [--yes]` | First loads the bundle in a throw-away CRM like `ext check` (a package that fails is refused with `invalid-package` and nothing changes; `--force` skips this). Plan (install or upgrade, author, size, dependencies, warnings: downgrade, same version), then installs and loads it in the session (`load.status` must be `loaded`). Upgrades keep the enabled state and the module config. |
| `ext list --site <alias>` | Installed extensions with version, enabled state and load status. |
| `ext enable\|disable <id> --site <alias> [--cascade] [--yes]` | Switch it on or off without uninstalling. |
| `ext uninstall <id> --site <alias> [--force] [--yes]` | Remove it (its module config is kept for a later re-install). |
| `ext export <id> --site <alias> [--out <zip>]` | Download the installed package as a ZIP. |

## Workflow

1. **Understand the request.** A new look = a **theme**. New pages, widgets, record tabs, AI tools, automation steps or reactions to CRM events = a **module**. Pick an id: lowercase letters, digits and dashes, 3 to 50 characters, not a built-in module id (records, deals, dashboard, reports, forms, tasks, automations, integrations, assistant, search, settings, setup, customize) nor agentcrm, core, runtime, admin, app, custom, default. Prefix it with the company or product (`acme-quotes`).
2. **Scaffold and install the toolchain:**
   ```bash
   npx -y @fleox-agent-crm/agentcrm@0.12.0 ext new module acme-quotes --author "Acme" --json
   cd acme-quotes && npm install
   ```
3. **Read the scaffold**, then the reference for what you are building:
   - [references/module-recipes.md](references/module-recipes.md): custom object + page, record tab, dashboard widget, AI tool, automation action, settings page with module config, hooks.
   - [references/theme-recipes.md](references/theme-recipes.md): appearance values, CSS variables, brand themes.
   - [references/runtime-api.md](references/runtime-api.md): everything `@agent-crm/runtime` exports. The authoritative signatures are in the project's `types/agentcrm-runtime.d.ts`.
   - [references/testing.md](references/testing.md): build, check, pack, install, upgrade, debug, pitfalls.
4. **Implement**, keeping the scaffold's build settings.
5. **Verify after every meaningful change:**
   ```bash
   npm run typecheck
   npm run build
   npx -y @fleox-agent-crm/agentcrm@0.12.0 ext check . --json
   ```
   Fix every error; read the warnings (missing French strings, tool names without the module prefix, nav entries without a route).
6. **Pack and install** (plan first, then `--yes` once the user agreed):
   ```bash
   npx -y @fleox-agent-crm/agentcrm@0.12.0 ext pack . --json
   npx -y @fleox-agent-crm/agentcrm@0.12.0 ext install . --site acme --json
   npx -y @fleox-agent-crm/agentcrm@0.12.0 ext install . --site acme --yes --json
   npx -y @fleox-agent-crm/agentcrm@0.12.0 tools list --site acme --json
   ```
   For a new release, bump `version` in `manifest.json` (semver) and install again: it upgrades in place.

## Golden rules

- Import UI, data and helpers from `@agent-crm/runtime`, React from `react`, translations from `react-i18next`, icons from `lucide-react`. Never bundle a second React.
- The default export's `id` and `apiVersion` must equal `manifest.json`'s.
- All writes go through `ops.*` with the right context: `useOps()` in components, the `ctx` argument in AI tools, automation actions and hooks. Roles are enforced there (viewers can't write, only admins change modules / schema).
- Prefix AI tool names with the module id in snake_case (`acme_quotes_list`), describe them so a model knows when to call them, set `mutating` honestly.
- Automation action ids are `<moduleId>.<action>`.
- `register(api)` must only register things (hooks, tools); never write data there. Hooks run in the process that made the change (the user's admin tab, or the CLI): keep them fast and idempotent.
- Strings through `t("<moduleId>:key")` with `useTranslation("<moduleId>")`; ship `en` and `fr`.
- Every `<form>` has `data-form-type="other"`.
- Keep the bundle small (limit 1.5 MB, style.css 256 KB, ZIP 4 MB).

## Without writing code

Many requests need no extension at all: turning built-in modules off, changing the look, logo and colors, custom objects and fields. Use the `agentcrm-admin` skill (`modules`, `appearance`, `objects`, `fields`) first, and only build an extension when the CRM can't do it out of the box.
