---
name: repo-presentation
description: How the AgentCRM public presentation is built and kept true — the README (GitHub page and npm page), docs/ layout and index, pinned commands in docs, screenshots of the admin, the Claude Code marketplace entry, community files and wording rules (licence, no planned features, no Claude attribution). Invoke when changing the README, adding or restructuring a page in docs/, adding an image or demo, or editing the plugin / marketplace descriptions in this repository.
---

# GitHub and npm presentation — contributor notes (this repo)

Read [CLAUDE.md](../../../CLAUDE.md) first. Don't commit or push unless asked. Everything public is in English.

## The README is two pages

`README.md` is both the GitHub page and the npm page of `@fleox-agent-crm/agentcrm` (it is in `package.json → files`). So:

- npm renders it away from the repository. Use **absolute** links for anything new: `https://github.com/fleox/agentcrm/blob/master/…` for files, `https://raw.githubusercontent.com/fleox/agentcrm/master/…` for images. The branch is `master`: `blob/main` links are 404s (fixed once, in 0.3.1). The current README still has relative links (`docs/…`, `LICENSE`, `plugin/skills`): check how they render on npmjs.com before relying on them, and convert the ones you touch.
- The README ships with a release: a README fix reaches npm only with the next published version.
- It is a landing page — Why → Quick start (agent, then by hand) → Features → Customisation → How it works → Data backends → Hosting → CLI → MCP → AI assistant → Automations → Security & GDPR → Compared with… → Development → License. Details belong in `docs/`; link them.
- Pinned commands (`npx -y @fleox-agent-crm/agentcrm@x.y.z …`) in the README, `docs/*.md` and `docs/templates/agentcrm-cron.yml` are bumped by `scripts/sync-version.mjs` at `npm version`. Write them with the **current** version; never write an unpinned `npx @fleox-agent-crm/agentcrm`. The `version` script stages only `plugin hermes .claude-plugin`, so the README / docs pins it rewrites must be committed by hand (0.12.0: a separate `docs: pin 0.12.0` commit after the tag, so the npm README of 0.12.0 still pins 0.11.0) — see `agent-cli-internals` → Releases.
- The mermaid diagram under "How it works" is the architecture picture ("one engine, four front doors"); keep it in step with `docs/architecture.md`.

## Layout

| Path | Content |
|---|---|
| `docs/README.md` | Index of the documentation: add every new page there |
| `docs/architecture.md`, `data-model.md`, `cli.md`, `mcp.md`, `hosting.md`, `firebase.md`, `files.md`, `import-export.md`, `automations.md`, `modules.md`, `appearance.md`, `extensions.md` | User guides |
| `docs/creating-a-module.md`, `creating-a-theme.md`, `runtime-api-reference.md`, `releasing.md` | Developers / maintainers |
| `docs/templates/agentcrm-cron.yml` | GitHub Actions template for scheduled automations + form ingestion |
| `hermes/README.md` | The Hermes Agent page (skills table, Python scripts) |
| `.claude-plugin/marketplace.json`, `plugin/.claude-plugin/plugin.json` | Claude Code marketplace + plugin descriptions (the version lives in `plugin.json` only; `check:skills` enforces it) |
| `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `AGENTS.md`, `SHARED.md` | Community and maintenance files |

Docs that describe contracts contributors change often: `docs/data-model.md` (field options `drilldown` / `rollup`, URL image fields, `fieldUpdates`, `users.prefs`), `docs/files.md` (the HTTP files endpoint protocol), `docs/firebase.md` (rules, incremental loading), `docs/cli.md` (`schema apply`, `records sync`, `site runtime`) — keep them in the same commit as the code.

Docs that are also test inputs: `docs/runtime-api-reference.md` must list every runtime export and exported type (`scripts/docs.test.ts`); see [`extension-internals`](../extension-internals/SKILL.md). Docs linked from the app or the CLI use absolute `blob/master` URLs (`EXTENSIONS_DOCS_URL` in `src/features/customize/ModulesSection.tsx`, the scaffold README in `agent/ops/extScaffold.ts`): renaming a doc breaks them.

## Screenshots and images

The repository has no screenshots or GIFs yet. When adding some:

- Put them under `.github/assets/` and reference them with absolute `raw.githubusercontent.com` URLs; `<picture>` with `prefers-color-scheme` for light / dark pairs.
- Use real output, never mock-ups: run the built admin with `node dist/agent/agentcrm.mjs serve --port <free port> --no-open`, pick **This browser** + demo data (deterministic, `seedDemoData`: generated portraits, logos, a chart and a PDF), and capture it with headless Chrome over the DevTools protocol (`--headless=new --remote-debugging-port=<free port>`), using emulated `prefers-color-scheme: dark` for the dark version. Don't start `npm run dev` if the owner runs it on 5180.
- Look at every image before using it. Nothing personal: no real contacts, tokens, private paths or accounts — demo data only.
- JPG or WebP for screenshots, PNG only where transparency matters; keep files small (the README loads them all).

## Writing rules

- Say what the product does today; describe nothing planned.
- The licence is **PolyForm Noncommercial 1.0.0**: say "source available", never "open source"; commercial use needs written authorization.
- "No server of ours, ever": never describe a hosted AgentCRM service, account or subscription.
- Security claims must match the code (AES-256-GCM, PBKDF2-SHA256 600k, `compact` purge, secrets never in `config.js`); see `SECURITY.md`.
- No Claude attribution anywhere (commits, PRs, docs).
