# Test, pack, install, upgrade, debug

## The loop

```bash
npm run typecheck                                            # tsc against types/agentcrm-runtime.d.ts
npm run build                                                # vite build → dist/bundle.js
npx -y @fleox-agent-crm/agentcrm@0.7.0 ext check . --json           # what the admin will see
```

`ext check` reads `manifest.json` + `dist/bundle.js` (+ `src/style.css` for themes declaring it) from a project, `manifest.json` + `bundle.js` from an unpacked folder, or a ZIP. Then:

| Field | Meaning |
|---|---|
| `data.valid` | false = the admin would refuse or fail to load it (exit code 1). |
| `data.errors[]` | `{ code, message, hint }`: `manifest`, `incompatibleApi`, `imports` (a bare import the admin doesn't provide), `noDefaultExport`, `devJsx`, `tooLarge`, `missingStyle`, `notBuilt`, `load` (the bundle threw or its default export is wrong), `appearance` (theme values). |
| `data.warnings[]` | `i18n` (no French), `toolName`, `toolDescription`, `actionId`, `nav` (entry without a route), `empty`, `dependency`, `toolCall` (a tool failed when called with `{}` on demo data), `author`, `ignored`. |
| `data.registered` | routes, navItems, slots (ids per slot), settingsPage, i18n key counts, aiTools, automationActions, hooks. |
| `data.toolCalls` | each AI tool without required inputs, called once on a demo CRM (`--no-call` skips). |
| `data.theme` | a theme's resolved values and CSS size. |

The check runs the bundle in Node with the real loader and runtime, in a throw-away demo CRM (30 companies, 80 people, 40 deals): nothing reaches a real site. It does not render React components; open the admin for that (below).

## Pack and install

```bash
npx -y @fleox-agent-crm/agentcrm@0.7.0 ext pack . --json                         # → <id>-<version>.zip
npx -y @fleox-agent-crm/agentcrm@0.7.0 ext install acme-quotes-0.1.0.zip --site acme --json
npx -y @fleox-agent-crm/agentcrm@0.7.0 ext install acme-quotes-0.1.0.zip --site acme --yes --json
npx -y @fleox-agent-crm/agentcrm@0.7.0 ext list --site acme --json
```

- The plan (`needsConfirmation: true`) shows `id`, `kind`, `name`, `version`, `author`, `mode` (`install` / `upgrade` with `from`), `dependsOn`, `size`, `warnings` and the trust warning. **Show it to the user and ask before `--yes`.**
- Before anything else, `ext install` loads the bundle in a throw-away CRM like `ext check`: when it fails the command answers `invalid-package` and nothing is installed (the current version keeps running). Fix it and run `ext check`; `--force` skips the trial load (only for bundles that can't load in Node on purpose).
- `warnings` also flag a downgrade or a re-install of the same version: bump `version` instead.
- After `--yes`, `data.load.status` is `loaded` when the bundle ran in the CLI session. `error` comes with `data.load.error`.
- A module whose dependencies are off is installed disabled (see `warnings`); enable them first or `ext enable <id> --cascade`.
- `ext install <dir>` works on a built project too (no ZIP needed).
- The admin alternative: Settings, Modules, Installed extensions, drop the ZIP, review, tick "I trust the author".

## Upgrade

Bump `version` in `manifest.json`, build, check, install again: `mode: "upgrade"`, `from: "<old>"`. The enabled state and the module config are kept; open admins reload the new bundle live.

## Use it

```bash
npx -y @fleox-agent-crm/agentcrm@0.7.0 tools list --site acme --json             # its AI tools (source: "extension")
npx -y @fleox-agent-crm/agentcrm@0.7.0 tools call acme_quotes_list --site acme --input '{}' --json
npx -y @fleox-agent-crm/agentcrm@0.7.0 modules list --site acme --json           # appears as a module (source: "extension")
npx -y @fleox-agent-crm/agentcrm@0.7.0 automations run --site acme --json        # its automation actions run here too
```

To see the UI, open the CRM's admin (its hosted URL, see `site show`, or `npx -y @fleox-agent-crm/agentcrm@0.7.0 serve` for a local copy), and check the page, the tabs and widgets in light and dark mode and in French (language switcher in the user menu or the Cmd+K palette).

## Disable, uninstall, export

```bash
npx -y @fleox-agent-crm/agentcrm@0.7.0 ext disable acme-quotes --site acme --yes --json
npx -y @fleox-agent-crm/agentcrm@0.7.0 ext enable acme-quotes --site acme --yes --json
npx -y @fleox-agent-crm/agentcrm@0.7.0 ext uninstall acme-quotes --site acme --yes --json
npx -y @fleox-agent-crm/agentcrm@0.7.0 ext export acme-quotes --site acme --out backup.zip --json
```

Disabling keeps the package and its config; uninstalling keeps the config (a re-install restores it). Data the module created (records, objects, notes) is never deleted by either.

## When it breaks

| Symptom | Cause / fix |
|---|---|
| `imports` error: `react-router-dom`, `date-fns`… | Only react, react/jsx-runtime, react-dom, react-dom/client, react-i18next, lucide-react and @agent-crm/runtime are external. Use the runtime's router (`Link`, `useNavigate`, `paths`) and formatters (`formatDate`…), or let Vite bundle the library (remove it from `external`). |
| `load`: "bundle id … doesn't match manifest id" | The default export's `id` must equal `manifest.json`'s. Same for `apiVersion`. |
| `load`: "AI tool … already exists" | Tool names are global: prefix them with the module id. |
| `devJsx` / "jsxDEV is not a function" | Build in production mode (the scaffold's `vite.config.ts` does). |
| Hooks are invalid / "Invalid hook call" | A second React got bundled: keep `react` external. |
| The admin is blank after installing | Open it with `?safe=1` (or hold Shift while it loads), then `ext disable <id> --yes`. |
| A tool works in the admin but not in the CLI | The CLI has no DOM: keep `document` / `window` / `localStorage` out of AI tools, automation actions and hooks. |
| `ext list` says `load: error` | `ext check` the same package; the error is in `loadError`. |
