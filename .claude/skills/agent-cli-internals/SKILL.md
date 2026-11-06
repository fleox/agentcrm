---
name: agent-cli-internals
description: Contributor notes for the agentcrm CLI and MCP server (agent/), the AI tool catalog they expose (src/ai/), the distributed agent skills (plugin/skills), the generated Hermes skills + Python scripts (hermes/), releases to npm, and how to QA the whole product with parallel AI agents against the published package. Invoke when changing agent/ commands or ops, the MCP server, an AI tool, a skill, hermes/, the release flow, or when asked to test / validate AgentCRM end to end in this repository.
---

# agentcrm CLI, MCP, skills and QA — contributor notes (this repo)

Read [CLAUDE.md](../../../CLAUDE.md) ("CLI & MCP", "Contracts for parallel agents") and [AGENTS.md](../../../AGENTS.md) first. Don't commit, push or publish unless the user asked in this conversation: pushing a `v*` tag publishes to npm. For extension code (runtime API, loader, ZIP format, `ext *` commands) see [`extension-internals`](../extension-internals/SKILL.md); for the Firebase backend and its generated rules see [`firebase-internals`](../firebase-internals/SKILL.md); for `schema apply`, `records sync`, `fieldUpdates` and the other data-model features see [`data-model-internals`](../data-model-internals/SKILL.md).

## One engine, four front doors

The admin (`src/features/`), the CLI (`agent/commands/`), the MCP server (`agent/mcp/server.ts`) and the in-admin assistant (`src/features/assistant/`) all call `src/ops/` over the `DataStore` API. A business rule in a command or a page is a bug: move it to an op, test it there (`src/ops/*.test.ts`, `setupTestCrm()` from `src/ops/testing.ts`), and call it from every door.

- **AI tools** are declared once: `src/ai/tools.ts` (`AI_TOOLS`) plus the files it spreads in (`customizeTools.ts`, `fileTools.ts`, `automationTools.ts`). Extensions add theirs with `registerAiTool`. Every door lists `listAiTools()`, never `AI_TOOLS` alone: MCP computes `tools/list` per request, `agentcrm tools list` tags each tool `source: builtin|extension`.
- A new tool needs a precise description, a JSON schema (inputs are validated against it before the handler runs) and `mutating` set right: read-only MCP mode and the assistant's confirmation depend on it. Installing extension code is deliberately not a tool.

## Three audiences, one source

| Folder | For | Rule |
|---|---|---|
| `agent/` | the `agentcrm` CLI (npm `@fleox-agent-crm/agentcrm`, bundled by `vite.agent.config.ts` to `dist/agent/agentcrm.mjs` + `dist/agent/chunks/`) | every command `--json` → one `{ok,data}` / `{ok:false,error:{code,message,hint}}` on stdout, logs on stderr |
| `plugin/skills/` | Claude Code plugin (`.claude-plugin/marketplace.json` → `plugin/`) + any agent | **the source of truth**: 5 skills (`agentcrm-install`, `agentcrm-manage`, `agentcrm-admin`, `agentcrm-sales`, `agentcrm-extensions`), 100% English, pinned `npx -y @fleox-agent-crm/agentcrm@<version>` |
| `hermes/` | Hermes Agent / Python agents | **generated** by `scripts/build-hermes.mjs` from `plugin/skills/` + `hermes/python/*.py` — never edit `hermes/skills/` |

A behaviour change in `agent/` or `src/ops/` that a skill describes → update `plugin/skills/` (and `docs/cli.md`) in the same change → `npm run hermes:build`. A new command goes in `agent/commands/index.ts` with `usage`, `summary`, `options` and `subcommands`, plus a test. `npm run check:skills` (needs a fresh `npm run build`) fails when a skill calls a command or action missing from `help --json`, pins another version, uses non-portable frontmatter, or reads as French.

## CLI architecture you must know

- **State**: `~/.agentcrm` or `$AGENTCRM_HOME` (`agent/home.ts`): `sites.json` (registered CRMs, never secrets), `credentials.json` (mode 0600, `agent/credentials.ts`; types `s3`, `github`, `gitlab`, `firebase`, `passphrase`, `anthropic`), `locks/<alias>.lock` (`lockSite` in `agent/sites.ts`; writes take it, reads don't), and for Firebase sites `sessions/<account>.json` (the Firebase Auth session of a `firebase:<name>` login, `agent/firebaseSession.ts`, dropped by `credentials set|remove`) and `cache/firebase-<project>-<uid>.json` (the dataset copy for incremental loads, `agent/firebaseCache.ts`). Both hold a refresh token or CRM data: mode 0600 like `credentials.json` (`writeJsonFile(…, 0o600)`; the default mode is 0644). `$AGENTCRM_DIST` points the CLI at another `dist/` (tests), `$AGENTCRM_SITE` picks the default site.
- **Sessions** (`agent/ops/session.ts` `openSession`): activate the site's runtime config (`setRuntimeConfigOverride`), merge the CLI's credentials, open the `DataStore` (`openStore`: for Firebase, `prepareFirebaseSession` before the store and `fileFirebaseCache()` as `BackendOptions.firebaseCache`; the store signs in with the login secrets), act as the site's CRM user (roles enforced; `system` context for maintenance), subscribe the automations engine to the plugin actions, load the enabled extensions (`agent/ops/extensions.ts`, skipped with `--safe` / `AGENTCRM_SAFE=1`), flush and close at the end. The session registry is chained to the default registry so extension hooks see CLI writes.
- **Browser code in Node**: `agent/browserEnv.ts` installs the browser globals the shared modules expect; `tsconfig.agent.json` keeps the DOM lib. The bundle must run with Node alone: `agent/bundle.test.ts` fails on any import outside Node built-ins (generated sources in `agent/ops/extScaffold.ts` start import lines with `${IMPORT}` for that reason).
- **Errors**: throw `CliError(code, message, hint)`; engine errors (`OpsError`, `PassphraseError`, `FieldValidationError`, `DocConflictError`, `StorageError`) are mapped in `knownError` (`agent/output.ts`). Exit 0 ok, 1 failure, 2 usage / validation. An `internal` code reaching an agent is a bug: map it, with a hint that says what to do.
- **Plans**: destructive or workspace-wide commands answer `{ needsConfirmation: true, plan }` unless `--yes`. Plans run the op on an in-memory copy of the dataset (`agent/ops/dryRun.ts`), so conflicts and validation errors surface before `--yes`. Skills test `needsConfirmation`, never the human "re-run with --yes" text. Idempotent commands answer without `needsConfirmation` when nothing would change (`schema apply` → `upToDate: true`, `records sync` with no created / updated / archived row), so an agent can re-run them safely.
- **stdout stays clean**: extension console output is routed to stderr (`routeConsoleToStderr`), or `--json` and the MCP stream break.
- **Exit only once stdout has flushed**: `agent/bin.ts` ends with `exitWhenFlushed(code)` (an empty `write` callback on stdout and stderr, then `process.exit`). A bare `process.exit()` after printing truncated large `--json` results read through a pipe (fixed in 0.10.1). Never add a `process.exit` on a path that has printed; return an exit code from `main` instead.
- **MCP** (`agentcrm mcp`): stdio JSON-RPC 2.0, protocol `2025-06-18` (older `2025-03-26` / `2024-11-05` accepted, `SUPPORTED_PROTOCOLS`), tools = `listAiTools()`, resources `agentcrm://modules`, `agentcrm://appearance` (+ the others in `docs/mcp.md`); re-syncs extensions after a mutating tool so disabled modules drop their tools.
- Commands added since 0.3.1: `schema apply <file|-> [--yes]` (`agent/commands/schema.ts` `schemaCommand`, `src/ops/schemaApply.ts`), `records sync` (`agent/commands/records.ts`, `src/ops/syncRecords.ts`; `--rows` JSON / `@file` / `-` through `readTextValue`), `site runtime <alias> --runtime <json|@file>` (same `datasetId` only, else `config-mismatch`), the `firestore-reads` check of `doctor`. `records list|get` also print `createdBy`, `updatedBy`, `fieldUpdates`. `install --dry-run` on Firebase now signs in and checks the rules (`checkFirebaseAccess`).
- `serve` serves `dist/admin` on 127.0.0.1 from port 4173 (next free one up to +20) and opens a browser unless `--no-open`.

## Tests

- Fakes: `agent/testing/fakeS3.ts`, `agent/testing/fakeGithub.ts`, helpers in `agent/testing/cli.ts` (`cli()`, `siteCli()`, `fakeDist()`, `writePlan()`). E2E files `agent/e2e-*.test.ts` (`local` — incl. `site runtime`, `s3`, `customize`, `files`) run real commands through `main()`; `agent/mcp/server.test.ts` speaks the protocol; `agent/cli.test.ts` pins the `records` subcommand list (update it with a new subcommand). The Firebase CLI paths (login, access check, invitations, incremental loads) are tested at the store level in `src/data/firebase.test.ts` on the memory api.
- Tests never touch the network: stub `fetch` with the fakes, point `AGENTCRM_HOME` / `AGENTCRM_DIST` at `os.tmpdir()` folders, and set `AGENTCRM_KDF_ITERATIONS=1000` so new encrypted datasets don't run 600k PBKDF2 rounds.
- Python: `hermes/tests/` with `fake_engine.py` (`AGENTCRM_CMD` → records calls, scripted answers), stdlib only.
- Before handing over: `npm run typecheck`, `npm test`, `npm run build`, `npx vitest run agent/bundle.test.ts` (skips without `dist/agent`), `npm run check:skills`, `npm run check:hermes` — what CI (`.github/workflows/ci.yml`) runs.
- `dist/` is git-ignored here (unlike AgentCMS): every publish builds it. Never run `npm run build` while other agents run tests against `dist/` (they read half-written bundles).

## Hermes (hermes/)

- `hermes/python/agentcrm.py`: stdlib-only wrapper (Python 3.9+): `run(*args, site=)` → `data`, raises `AgentcrmError(code, message, hint)`, `needs_confirmation(data)`. Engine = `$AGENTCRM_CMD` or `npx -y @fleox-agent-crm/agentcrm@<VERSION>` (placeholder `__AGENTCRM_VERSION__` filled by the generator).
- Task helpers (`import_csv.py`, `pipeline_report.py`, `add_lead.py`) chain CLI commands; keep them stdlib-only with one JSON object on stdout, and add tests with the fake engine. Which skill ships which helper: `HELPERS` in `scripts/build-hermes.mjs` (tags: `TAGS`).
- The generator rewrites commands (`npx …` → `python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py …` in SKILL.md, `python3 <skill dir>/scripts/agentcrm.py …` in references) and adds the Hermes frontmatter. New Claude-specific wording in a skill may need a rewrite rule there.

## Releases

**Each release needs the user's explicit go.** Full reference: [docs/releasing.md](../../../docs/releasing.md).

1. Add the `changelog.json` entry (English, newest first): `version`, `date`, `breaking`, `changes[]` (user-facing), `actions[]` (free text: what users run after updating, e.g. redeploy the admin, update the skills, Firebase rule redeploys — 0.4.0 and 0.11.0 had one). `check:skills` refuses a release without it. Since 0.4.0 the entry is written **in the feature commit itself** (one feature commit per release, with its docs and skills), not in a separate changelog commit (`Changelog 0.8.0` was the exception).
2. Bump `package.json → agentcrm.dataSchema` when an older admin could no longer read new data (`deploy-admin` refuses downgrades below it), `agentcrm.minSkillsVersion` when older skills no longer work.
3. Checks green; commit everything. The tree must be clean.
4. `npm version patch|minor` runs the `version` script: `scripts/sync-version.mjs` (plugin.json, skills' `metadata.version`, every pinned `@fleox-agent-crm/agentcrm@x.y.z` in skills, README, `docs/*.md`, `docs/templates/agentcrm-cron.yml`), `npm run build`, `scripts/build-hermes.mjs`, stages `plugin hermes .claude-plugin`; npm then commits (message = the bare version, e.g. `0.12.0`) and tags `vX.Y.Z`. **The README / `docs/` pins it rewrote are not staged**: they stay modified. 0.3.2 – 0.11.0 carried them in the version commit; 0.12.0 committed them afterwards as `docs: pin 0.12.0`, which leaves the tagged tree (and the npm README) one version behind. Before pushing, prefer `git add README.md docs && git commit --amend --no-edit && git tag -f vX.Y.Z` (nothing is pushed yet, so this rewrites only local history); otherwise commit `docs: pin X.Y.Z`. The tree must be clean before the push.
5. `git push --follow-tags origin master` triggers `.github/workflows/release.yml`: tag = `package.json` version, typecheck, tests, build, bundle test, `check:skills`, `check:hermes`, smoke test of the packed tarball, `npm publish --provenance` through **trusted publishing** (OIDC, no npm token anywhere), then the GitHub Release from `changelog.json`. The publish step is skipped when the version is already on npm: the very first version was published by hand (`npm publish`, `prepublishOnly` runs the checks), since npm only allows trusted publishing on an existing package.
6. Verify **from outside the repo**: `cd /tmp && npx -y @fleox-agent-crm/agentcrm@<v> version --json`. Inside the repo npx resolves the local package of the same name and proves nothing. Allow a few minutes for npm.
7. Check CI and the Release run. `gh` isn't installed on the maintainer's machine: poll `https://api.github.com/repos/fleox/agentcrm/actions/runs` and tolerate empty answers.

Traps:

- Commits and PRs carry **no Claude attribution** (no `Co-Authored-By`, no "Generated with").
- Version numbers are embedded in many generated files (hermes scripts, docs snippets): a release diff touching dozens of files is normal (≈ 40 files per release since 0.3.2).
- Every minor feature has been its own minor release (0.4.0 … 0.12.0, fixes as patches): don't batch unrelated features into one version without the maintainer's say.

## QA with AI agents (how 0.3.1 was validated)

When asked to test everything, run **one background agent per area** (install + data backends, records / import / reports, automations / forms, customisation: modules + appearance + extensions, files, admin UI…), each in its **own git worktree** (`isolation: "worktree"`, under `.claude/worktrees/`, git-ignored) so fixes never collide:

- **Test the published package like a user**: `npx -y @fleox-agent-crm/agentcrm@<released version> …` run from a folder **outside the repo** (`/tmp/<agent>/`), or npx picks the local package. Use only the distributed skills as instructions.
- **Isolated state per agent**: `export AGENTCRM_HOME=/tmp/qa-<agent>/home` (sites, credentials, locks), CRMs (data and admin hosting) on local folders under `/tmp/qa-<agent>/` unless the scenario needs a real bucket or repo, never the maintainer's `~/.agentcrm`. Always pass `--site <alias>`: `site use` is global to one home.
- **Admin UI checks**: `agentcrm serve --port <unique port> --no-open` (or `--dir <folder>` for a local-folder hosting), then headless Chrome driven over the DevTools protocol (`--headless=new --remote-debugging-port=<unique port> --user-data-dir=/tmp/qa-<agent>/chrome`). Give every agent its own pair of ports. **Never run `npm run dev`**: the owner runs it on 5180 (`vite.config.ts`).
- Shared rules for the agents: never print secrets; only their own CRMs; look at every screenshot before reporting; final report = what was tested, bugs (command, output, expected), doc / skill problems, impossible things.
- Then: verify each reported bug in the code before fixing; fix in `src/ops/` / `agent/` / skills with tests (e2e on the fakes for CLI behaviour); delegate independent fixes to agents with **disjoint file ownership** and "no version bump, no `npm run build`, no push".
- **Integration**: merge every agent branch (`worktree-agent-…`) into one integration worktree (branch `qa-integration`), resolve conflicts there, run `npm run typecheck && npm test && npm run build && npm run check:skills && npm run check:hermes`, then fast-forward `master` to it. Release only after the user's go.
