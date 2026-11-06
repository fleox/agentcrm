---
name: repo-presentation
description: How the AgentCRM public presentation is built and kept true — the README (GitHub page and npm page), docs/ layout and index, pinned commands in docs, screenshots of the admin, the Claude Code marketplace entry, community files and wording rules (licence, no planned features, no Claude attribution). Invoke when changing the README, adding or restructuring a page in docs/, adding an image or demo, or editing the plugin / marketplace descriptions in this repository.
---

# GitHub and npm presentation — contributor notes (this repo)

Read [CLAUDE.md](../../../CLAUDE.md) first. Don't commit or push unless asked. Everything public is in English.

## The README is two pages

`README.md` is both the GitHub page and the npm page of `@fleox-agent-crm/agentcrm` (it is in `package.json → files`). So:

- npm renders it away from the repository. Use **absolute** links for anything new: `https://github.com/fleox/agentcrm/blob/master/…` for files, `https://raw.githubusercontent.com/fleox/agentcrm/master/…` for images. The branch is `master`: `blob/main` links are 404s (fixed once, in 0.3.1). Every link in the README is absolute; keep it that way.
- The README ships with a release: a README fix reaches npm only with the next published version.
- It is a landing page, same shape as AgentCMS's: logo + tagline + badges → demo video poster → Why (three columns) → Quick start (agent with the real-session GIFs, then without an agent) → Features (screenshot grid + grouped bullets) → Make it yours (presets gallery, modules, extensions + GIF) → How it works (diagram + backends table) → Compared → CLI (GIFs + collapsed command table) → MCP → Documentation → Contributing → License. Details belong in `docs/`; link them.
- Pinned commands (`npx -y @fleox-agent-crm/agentcrm@x.y.z …`) in the README, `docs/*.md` and `docs/templates/agentcrm-cron.yml` are bumped by `scripts/sync-version.mjs` at `npm version`. Write them with the **current** version; never write an unpinned `npx @fleox-agent-crm/agentcrm`. The `version` script stages `README.md` and `docs` too (since 0.12.1), so the npm README of a release pins that release.
- The "How it works" picture is `how-it-works-{light,dark}.png` ("one engine, four front doors"); keep it in step with `docs/architecture.md`.

## Layout

| Path | Content |
|---|---|
| `docs/README.md` | Index of the documentation: add every new page there |
| `docs/architecture.md`, `data-model.md`, `cli.md`, `mcp.md`, `hosting.md`, `firebase.md`, `files.md`, `import-export.md`, `automations.md`, `modules.md`, `appearance.md`, `extensions.md` | User guides |
| `docs/creating-a-module.md`, `creating-a-theme.md`, `runtime-api-reference.md`, `releasing.md` | Developers / maintainers |
| `docs/templates/agentcrm-cron.yml` | GitHub Actions template for scheduled automations + form ingestion |
| `hermes/README.md` | The Hermes Agent page (skills table, Python scripts) |
| `.claude-plugin/marketplace.json`, `plugin/.claude-plugin/plugin.json` | Claude Code marketplace + plugin descriptions (the version lives in `plugin.json` only; `check:skills` enforces it) |
| `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `AGENTS.md`, `SHARED.md`, `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md` | Community and maintenance files |

Docs that describe contracts contributors change often: `docs/data-model.md` (field options `drilldown` / `rollup`, URL image fields, `fieldUpdates`, `users.prefs`), `docs/files.md` (the HTTP files endpoint protocol), `docs/firebase.md` (rules, incremental loading), `docs/cli.md` (`schema apply`, `records sync`, `site runtime`) — keep them in the same commit as the code.

Docs that are also test inputs: `docs/runtime-api-reference.md` must list every runtime export and exported type (`scripts/docs.test.ts`); see [`extension-internals`](../extension-internals/SKILL.md). Docs linked from the app or the CLI use absolute `blob/master` URLs (`EXTENSIONS_DOCS_URL` in `src/features/customize/ModulesSection.tsx`, the scaffold README in `agent/ops/extScaffold.ts`): renaming a doc breaks them.

## Images, demos and the video

Everything lives in `.github/` and is referenced from the README with absolute `raw.githubusercontent.com/fleox/agentcrm/master/…` URLs, so an image fix reaches GitHub **and** the npm page with a push to `master` (no release needed — only README *text* waits for a release).

| Path | Content |
|---|---|
| `.github/assets/logo.svg`, `logo.png` | The mark (same identity as `public/favicon.svg`; the admin's favicon is separate) |
| `.github/assets/social-preview.png` | 1280×640; the maintainer uploads it in GitHub → Settings → Social preview |
| `.github/assets/how-it-works-{light,dark}.png` | The architecture diagram (HTML/CSS rendered with headless Chrome; keep it true to `docs/architecture.md`) |
| `.github/assets/admin-<screen>-{light,dark}.jpg` | Real admin screenshots (dashboard, kanban, record, table, reports, search; modules / appearance light only) |
| `.github/assets/preset-<id>.jpg` | The same kanban under each appearance preset + the `midnight` example theme |
| `.github/assets/demo-{cli,schema,extension,mcp}.gif` | Scripted VHS terminal demos (`.github/demos/*.tape`) |
| `.github/assets/demo-{install,agent}.gif` | Real Claude Code sessions (`.github/demos/install.tape`, `agent.tape`) |
| `.github/assets/agentcrm-demo.mp4`, `video-poster.jpg` | The ~2 min demo film and its README poster |
| `.github/demos/` | `setup.sh` (throw-away encrypted local-folder CRM with demo data in `/tmp/acrm-cli-demo`), `render.sh <cli\|schema\|extension\|mcp>`, the tapes, `compose.sh` + `speed-label-*.png` for real sessions |

### Screenshots

Real output only, never mock-ups: the **published** package outside the repo (`cd /tmp/x && npx -y @fleox-agent-crm/agentcrm@<v> serve --port <free> --no-open` — inside the repo, npx resolves the local package and fails), setup wizard → **This browser** + demo data, headless Chrome over the DevTools protocol at 1440×900 CSS px, deviceScaleFactor 2, downscaled to 1600 px JPG (~85). Dark versions: set `localStorage["agentcrm.theme"]` before loading (headless Chrome defaults to dark). Demo user "Alex Morgan <alex@example.com>"; nothing personal. Look at every image before using it. Never use port 5180 / `npm run dev` (the owner's).

### Terminal demos

`vhs`, `ttyd`, `ffmpeg`, `jq` (Homebrew). Look: 1200×680, Padding 24, FontSize 18, Catppuccin Mocha, WindowBar Colorful, purple `❯` prompt, setup hidden. `.github/demos/render.sh <name>` runs `setup.sh` then vhs. Tapes run the **published** CLI: re-render after a release that changes the output, then push (the README picks it up immediately).

Real agent sessions (install, day-to-day work) are recorded once with VHS around a real `claude` run in a clean folder (`claude --setting-sources project,local`, plugin enabled in the folder's `.claude/settings.json`, isolated `AGENTCRM_HOME`, everything local — no online resources), then `compose.sh` keeps real time until the prompt is sent, speeds up the agent's work with a visible ×8 / ×16 label and holds the answer. Never present sped-up footage as real time; no tokens, passphrases, account names or `/Users/…` paths on screen.

### The demo film

Built like cms-ia's: Kokoro TTS (`kokoro-onnx`, voice `af_heart`, speed 0.95, espeak-ng from Homebrew) with an IPA dictionary for acronyms (AgentCRM, CRM, CLI, MCP, AI, S3, CSV, GitHub…), Chrome-rendered title cards and slides, real admin footage recorded over CDP with a drawn cursor, the real agent sessions, burned-in subtitles, assembled with ffmpeg (1920×1080, H.264 + AAC, faststart, ≤ 25 MB). The working files are not in the repo; the result is `.github/assets/agentcrm-demo.mp4`. When the owner uploads it to YouTube, point the README poster at the YouTube URL.

## Writing rules

- Say what the product does today; describe nothing planned.
- The licence is **PolyForm Noncommercial 1.0.0**: say "source available", never "open source"; commercial use needs written authorization.
- "No server of ours, ever": never describe a hosted AgentCRM service, account or subscription.
- Security claims must match the code (AES-256-GCM, PBKDF2-SHA256 600k, `compact` purge, secrets never in `config.js`); see `SECURITY.md`.
- No Claude attribution anywhere (commits, PRs, docs).
