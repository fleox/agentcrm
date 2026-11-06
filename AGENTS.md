# AGENTS.md — maintenance rules for AI agents working on AgentCRM

Read `CLAUDE.md` first (architecture, hard rules, contracts). This file lists what must stay in sync when you change something.

## One engine, four front doors

- Business rules live in `src/ops/` only. The admin (`src/features/`), the CLI (`agent/commands/`), the MCP server (`agent/mcp/`) and the assistant call ops — never re-implement a rule in a command or a page.
- AI tools are declared once in `src/ai/tools.ts` (+ the files it spreads in). MCP `tools/list`, `agentcrm tools list` and the assistant expose exactly `listAiTools()` (`AI_TOOLS` + tools registered by extensions). A new tool needs: a precise description, a JSON schema, `mutating` set right (read-only MCP mode and the assistant's confirmation depend on it).

## Engine invariants

- Record writes go through `createRecord` / `recordPatchMutation` (`src/ops/records.ts`): with a known actor they stamp `updatedBy` and `fieldUpdates.<fieldId> = { by, at }` for every field they change. A hand-built record mutation must do the same.
- `syncRecords` and `applySchema` (`src/ops/syncRecords.ts`, `src/ops/schemaApply.ts`) keep their promises: sync = one `store.write()`, diff-only, no plugin actions, archive instead of delete; schema apply = additive and idempotent (never deletes, never changes a field type, never removes an option or a stage). A second run of the same input must report nothing to do.
- Firebase: every batch goes through `withChangeTracking` (`_ts` server stamp on writes, `deletions/` tombstone with each delete, same batch). Rules with a narrow `affectedKeys().hasOnly([...])` must list `_ts`. A new collection needs its rule (`RULED_COLLECTIONS`), and changed rules need a `changelog.json` action telling Firebase users to re-publish them.

## Skills follow the code

- `plugin/skills/` is the single source of the agent skills. When a CLI command, option, output field or error code changes, update every skill / reference that mentions it **in the same change**.
- `npm run check:skills` (CI, after the build) fails when a skill calls a command or action missing from `help --json`, pins another version than `package.json`, uses non-portable frontmatter, or contains non-English prose.
- Skills are 100% English; agents translate for the user at runtime.
- Commands in skills are always pinned: `npx -y @fleox-agent-crm/agentcrm@<version> <command> --json`. `npm version` runs `scripts/sync-version.mjs`, which bumps every pin.
- Never write a skill step that asks the user to paste a secret in the chat. Secrets go through `credentials set` (hidden prompt in the user's terminal) or `--from-env` / `--from-gh` / `--from-aws-profile`.

## Hermes is generated

- `hermes/skills/` is generated from `plugin/skills/` + `hermes/python/` by `npm run hermes:build`. Never edit it by hand; regenerate and commit.
- `npm run check:hermes` fails when it is stale and runs the Python tests (`hermes/tests/`, fake engine, stdlib only).
- Python helpers stay stdlib-only, Python 3.9+, and print one JSON object.

## CLI contract

- `--json` → exactly one `{ ok, data }` or `{ ok: false, error: { code, message, hint } }` on stdout; logs on stderr.
- Exit 0 ok, 1 failure, 2 usage error (bad arguments, invalid plan, validation).
- Destructive commands print `{ needsConfirmation: true, plan }` unless `--yes`. Agents must show the plan and get the user's agreement.
- Every error a user can hit has a `hint` saying what to do (`agent/output.ts` maps engine errors).
- Writes take the site lock (`lockSite`); reads don't.
- New command: add it to `agent/commands/index.ts` with `usage`, `summary`, `options` and `subcommands`; add a test (`agent/*.test.ts`); document it in `docs/cli.md` and the relevant skill.

## Versions and releases

- `package.json` version = plugin version = skills' `metadata.version` = pinned commands. `dist/version.json` (built) carries `minSkillsVersion` and `dataSchema` from `package.json → agentcrm`.
- Bump `agentcrm.dataSchema` when an older admin could no longer read data written by the new one; `deploy-admin` refuses downgrades below it.
- Every release has a `changelog.json` entry (newest first) with `changes[]` and `actions[]` (what `deploy-admin` users must run after updating), committed with the feature it describes. See `docs/releasing.md`.

## Tests

- `npx vitest run agent` — CLI contract, e2e on a fake S3 (`agent/testing/fakeS3.ts`) and a local folder, MCP protocol, bundle (when `dist/agent` exists).
- After any change to `src/ops/firebaseRules.ts`: the emulator harness in `.claude/skills/firebase-internals/rules-test/` (Java 21).
- `npx tsc --noEmit -p tsconfig.agent.json` — the CLI typechecks with the DOM lib (it reuses browser-written modules through `agent/browserEnv.ts`).
- Tests never touch the network: stub `fetch` with the fakes; point `AGENTCRM_HOME` and `AGENTCRM_DIST` at temp folders; `AGENTCRM_KDF_ITERATIONS=1000` keeps new test datasets fast.

## Contributor skills

`.claude/skills/` holds Claude Code skills for working **on** this repository (not shipped in the npm package nor checked by `check:skills`): `agent-cli-internals`, `data-model-internals` (schema apply, records sync, drilldowns, rollups, fieldUpdates, view prefs), `extension-internals`, `firebase-internals` (with an emulator harness for the generated Firestore / Storage rules in `rules-test/`), `repo-presentation`, `create-mr`. Keep them true when the code they describe changes.
