# Extensions

AgentCRM can be extended **without rebuilding or redeploying the admin**: an extension is a small ZIP (an ES module + a manifest) stored in the CRM's own data and loaded at runtime by every admin and by the `agentcrm` CLI / MCP server.

| Kind | What it adds |
|---|---|
| **Module** | Pages with navigation entries, record tabs / panels / actions, dashboard widgets, a settings page with its own configuration, AI tools (MCP, in-admin assistant, `agentcrm tools`), automation actions, hooks on CRM events. Shows up in Settings → Modules next to the built-in modules and can be switched off like them. |
| **Theme** | A set of appearance values (accent, grays, radius, density, font, sidebar, buttons, contrast, default mode) + optional CSS. Shows up as a preset in Settings → Appearance. |

- Writing one: [creating-a-module.md](creating-a-module.md), [creating-a-theme.md](creating-a-theme.md), [runtime-api-reference.md](runtime-api-reference.md).
- Built-in modules and what disabling them hides: [modules.md](modules.md). Appearance options: [appearance.md](appearance.md).
- Examples in the repository: [`external/modules/hello-module`](../external/modules/hello-module) (page + record tab + AI tool), [`external/modules/sales-goals`](../external/modules/sales-goals) (dashboard widget, settings page with module config, AI tool, automation action, `dependsOn: deals`), [`external/themes/midnight`](../external/themes/midnight) (theme + CSS). `npm run build:examples` builds their ZIPs into `dist/extensions/`.

## Safety first

Installing an extension **runs its code with the rights of every user who opens the CRM — admins included**. It can read and change all CRM data the user can. So:

- Only admins can install, enable, disable or uninstall extensions.
- The admin shows the id, version, author, size and dependencies of a package and asks you to tick *"I trust the author"* before installing. The CLI prints the same plan and changes nothing without `--yes`. AI agents are instructed (skills) to show you the plan and ask.
- Installing code is deliberately **not** an AI tool: an assistant connected through MCP can list and enable / disable extensions, not install new code.
- Upgrades are explicit (a new version installed over the old one).
- **Safe mode** starts the admin without any extension: add `?safe=1` to the admin URL (or `#/?safe=1`), or hold **Shift** while it loads. A banner reminds you; from there you can disable or uninstall the culprit. The CLI equivalent is `--safe` (or `AGENTCRM_SAFE=1`).

## Install, enable, disable, uninstall

### In the admin

Settings → **Modules** → tab **Installed extensions**:

1. Drop the ZIP (or click to pick it). The manifest is checked (id, API version, size, imports).
2. Review the card: name, version (`v1.0.0 → v1.1.0` for an upgrade), author, homepage, size, dependencies. Tick *I trust the author*, then **Install**.
3. The extension loads immediately in your tab and in every other open admin. Its module card appears in Settings → Modules (with **Settings** when it has a settings page); a theme appears in Settings → Appearance.
4. **Disable** keeps it installed (and its configuration); **Uninstall** removes the package (its module configuration is kept for a re-install); **Export** downloads the installed ZIP.

### With the CLI

```bash
npx -y @fleox-agent-crm/agentcrm@0.3.2 ext install ./sales-goals-1.0.0.zip --site acme          # plan
npx -y @fleox-agent-crm/agentcrm@0.3.2 ext install ./sales-goals-1.0.0.zip --site acme --yes    # install + load
npx -y @fleox-agent-crm/agentcrm@0.3.2 ext list --site acme
npx -y @fleox-agent-crm/agentcrm@0.3.2 ext disable sales-goals --site acme --yes
npx -y @fleox-agent-crm/agentcrm@0.3.2 ext enable sales-goals --site acme --cascade --yes
npx -y @fleox-agent-crm/agentcrm@0.3.2 ext export sales-goals --site acme --out backup.zip
npx -y @fleox-agent-crm/agentcrm@0.3.2 ext uninstall sales-goals --site acme --yes
```

`ext install` accepts a ZIP, an unpacked folder or a built project folder. It first loads the bundle in a throw-away CRM, like `ext check`: a package that doesn't load is refused and the installed version stays as it was (`--force` skips this check). Re-installing the same version or a lower one is allowed, with a warning in the plan. A module whose dependencies are disabled is installed disabled (the plan says so); `ext enable <id> --cascade` turns the dependencies on.

### With an AI agent

> "Install the sales goals extension from `~/Downloads/sales-goals-1.0.0.zip` on our CRM."

The agent (skill `agentcrm-extensions`) runs `ext install` without `--yes`, shows you the plan — author, version, what it adds — and installs only after you agree. *"Turn off the sales goals extension"* uses `ext disable` (or the `set_extension_enabled` MCP tool).

## Extensions in the CLI and MCP server

Every CLI command that opens a CRM loads its enabled extensions in Node, through the same loader as the admin:

- their **AI tools** are in `agentcrm tools list` (`source: "extension"`), `tools call` and the MCP server's `tools/list`;
- their **hooks** see the CLI's writes (a record created by `records create` fires `record.created`);
- their **automation actions** run in `agentcrm automations run` (schedule / inactivity triggers, e.g. from the GitHub Actions cron).

React components (pages, widgets, tabs) are not rendered by the CLI. `--safe` skips extensions for one command. A failing extension is reported as a note on stderr and never blocks the command.

## Package format

A ZIP with, at its root (one wrapping folder is accepted; `__MACOSX` and dotfiles are ignored):

| File | |
|---|---|
| `manifest.json` | Required. See below. |
| `bundle.js` | Required. One ES module whose **default export** is `defineModule({...})` or `defineTheme({...})` with the same `id` and `apiVersion` as the manifest. Bare imports limited to `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `react-i18next`, `lucide-react`, `@agent-crm/runtime` — everything else bundled. |
| `style.css` | Optional (declare `"style": "style.css"`). Injected while the extension is enabled (themes: while selected). |

```json
{
  "id": "sales-goals",
  "kind": "module",
  "name": "Sales goals",
  "version": "1.0.0",
  "apiVersion": "1.0.0",
  "description": "Monthly sales targets per user, a dashboard widget, an AI tool and an automation action.",
  "author": "AgentCRM",
  "homepage": "https://github.com/fleox/agentcrm",
  "entry": "bundle.js",
  "icon": "Target",
  "category": "sales",
  "dependsOn": ["deals"]
}
```

| Key | Rules |
|---|---|
| `id` | `^[a-z][a-z0-9-]{1,48}[a-z0-9]$`; not a built-in module id (records, search, settings, setup, customize, dashboard, deals, reports, forms, tasks, automations, integrations, assistant) nor `agentcrm`, `core`, `runtime`, `admin`, `app`, `custom`, `default`. Also the i18n namespace and the module-config key. |
| `kind` | `module` or `theme`. |
| `name`, `description`, `author`, `homepage` | Shown in the admin and the install plan (`homepage`: http(s) URL). |
| `version` | Semver `1.2.3`. Installing a package whose id is installed = upgrade. |
| `apiVersion` | The runtime API it targets; must be between the admin's minimum and current (today `1.0.0`). |
| `entry` | Always `bundle.js`. |
| `style` | `style.css` when shipped. |
| `icon` | Module only: a lucide icon name in PascalCase (`Target`). |
| `category` | Module only: `core`, `sales`, `productivity`, `automation`, `integrations`, `ai`, `customisation`. |
| `dependsOn` | Module only: module ids (built-in or extensions) that must be enabled. |

Unknown keys are rejected. Limits: bundle 1.5 MB, style 256 KB, manifest 16 KB, ZIP 4 MB.

## Where extensions live

In the CRM's own data, collection `extensions` (one document per extension: manifest, files, enabled flag, installed by / at, previous version) — encrypted with the rest on file backends, shared by every user, no hosting involved. On Firebase, large bundles are split over `extensionChunks` transparently. Exporting the whole dataset (`agentcrm export json`) includes them.

## Checklist for authors

1. `npx -y @fleox-agent-crm/agentcrm@0.3.2 ext new module|theme <id>` — then `npm install`.
2. Code against `@agent-crm/runtime` ([reference](runtime-api-reference.md)); strings in English **and** French.
3. `npm run typecheck && npm run build`.
4. `npx -y @fleox-agent-crm/agentcrm@0.3.2 ext check .` — no errors, read the warnings.
5. `npx -y @fleox-agent-crm/agentcrm@0.3.2 ext pack .` → `<id>-<version>.zip`.
6. Try it on a test CRM (`ext install … --yes`), in light and dark mode, in French, as an admin and as a member / viewer.
7. Bump `version` for every release.
