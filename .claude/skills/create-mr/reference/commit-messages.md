# Commit messages and branch names (AgentCRM)

The history has used two styles. Since 0.10.0 feature and fix commits use
**Conventional Commits with a scope**; match that for new work:

```
<type>(<scope>): <subject>

<body — optional: why, and what a reviewer must know>
```

Examples from `git log` (0.10.0 – 0.12.0):

```
feat(records): fieldUpdates, who last wrote each field and when
fix(cli): exit once stdout has flushed, a large --json result was cut short
feat(views): each user's list layout and last view are remembered, per view, across reloads and devices
feat(files): Firebase CRMs can store files through an HTTP files endpoint instead of Firebase Storage

The runtime config's files.endpoint sends the bytes of attachments and images
to an endpoint the deployment runs (e.g. encrypted on its own S3 bucket),
authenticated with the user's Firebase ID token. site runtime updates the
runtime config of a registered CRM.
```

Before that (0.1 – 0.9.3) commits used a short **area prefix**, sometimes the
feature or command name itself, and some had none:

```
Firebase: incremental loading (local cache, server-time stamps, tombstones), reads reported by doctor
schema apply: schema as code (objects, fields, pipelines, views), additive and idempotent
records sync: mirror an external source by key (diff-only writes, relations by key, archive instead of delete)
Scoped rollups: child select values rolled up by label
Record images from a URL field (remote logos without file storage), imageField in schema apply
```

Don't rewrite old commits; just use the current style.

Never add a `Co-Authored-By: Claude` or "Generated with Claude Code" line.

## Type

| Type | When |
|---|---|
| `feat` | user-visible capability (admin, CLI, MCP, skills, data model) |
| `fix` | a bug a user could hit |
| `docs` | docs / README only (`docs: pin 0.12.0` after a release) |
| `refactor`, `test`, `chore`, `ci` | no behaviour change; tests only; tooling; `.github/workflows/` |

## Scope

One lower-case scope naming what a user or contributor would recognise. Used so
far: `records`, `views`, `files`, `cli`. Pick from the same vocabulary:

| Scope | What |
|---|---|
| `records`, `views`, `dashboard`, `reports`, `tasks`, `search`, `settings`, `setup` | admin features (`src/features/<id>/`) and their ops |
| `ui` | the shared kit (`src/components/ui/`) and the shell (`src/app/`) |
| `schema`, `sync`, `pipelines`, `automations`, `forms`, `files`, `demo` | engine areas in `src/ops/` / `src/core/` |
| `journal`, `firebase`, `git-json`, `local` | data backends (`src/data/`) and their rules |
| `extensions`, `modules`, `appearance` | `src/extensions/`, modules, `src/appearance/`, `features/customize` |
| `ai`, `assistant`, `mcp` | `src/ai/`, `features/assistant`, `agent/mcp/` |
| `cli` | `agent/` |
| `skills`, `hermes` | `plugin/skills/`, `hermes/` |

A feature that spans engine + CLI + docs + skills (the usual case) takes the
scope of what the user sees (`feat(files): …` touched `src/data/`, `agent/`,
`docs/` and the changelog). Unrelated changes are separate commits.

Release commits belong to the maintainer, not to a PR: the bare version
(`0.12.0`) written by `npm version`, then possibly `docs: pin 0.12.0` (see
`agent-cli-internals` → Releases). The `changelog.json` entry goes in the
feature commit.

## Subject

- Says what changed, from the user's point of view, in the present: "exit once
  stdout has flushed", "each user's list layout … is remembered". No trailing
  period. A comma may add the reason ("…, a large --json result was cut short").
- Aim for ≤ 72 characters; recent subjects run up to ~100 when the feature
  needs it — never more.
- Lower case after the colon, except names, commands, identifiers and acronyms
  (`fieldUpdates`, `Firebase`, `--json`). No backticks in the subject.

## Body

Optional, encouraged when the *why* isn't obvious from the subject:

- Plain prose wrapped at ~80 characters.
- Explain the problem before the fix; mention user-visible effects, new
  options / config keys, and anything a reviewer must test.
- Reference issues with a trailing `Closes #N` or `Refs #N`.

## Branch names

`<type>/<3-5-word-kebab-summary>` with the same `type` (e.g.
`fix/cli-stdout-flush`). The maintainer commits straight to `master`; agent
worktrees create `worktree-agent-<id>` branches: rename them before pushing a
PR.

## What to AVOID

- Generic subjects: "fix bug", "update files", "wip".
- Describing the request ("as asked…") instead of the change.
- Mixing an unrelated fix into a feature commit.
