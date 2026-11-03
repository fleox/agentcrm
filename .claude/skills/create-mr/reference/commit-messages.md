# Commit messages and branch names (AgentCRM)

The repository's history uses a short **area prefix**, not Conventional
Commits. Match it:

```
<Area>: <subject>

<body — optional: why, and what a reviewer must know>
```

Examples from `git log`:

```
CLI: --out creates folders, report/usage errors, CSV row count, import zip plan, hints
Records: translate the Space key hint of the table footer
Dashboard: legend on the lead sources chart

Each source shows two bars (people, customers) and nothing said what
the grey one was.
```

Never add a `Co-Authored-By: Claude` or "Generated with Claude Code" line.

## Area

One area, capitalised, naming what a user or contributor would recognise:

| Area | What |
|---|---|
| `Records`, `Dashboard`, `Reports`, `Tasks`, `Search`, `Settings`, `Setup` | admin feature folders (`src/features/<id>/`) |
| `UI` | the shared kit (`src/components/ui/`) and the shell (`src/app/`) |
| `Schema`, `Pipelines`, `Automations`, `Forms`, `Files`, `Demo data` | engine areas in `src/ops/` / `src/core/` |
| `Journal`, `Firebase`, `git-json`, `Local` | data backends (`src/data/`) |
| `Extensions`, `Modules`, `Appearance`, `Customisation` | `src/extensions/`, modules, `src/appearance/`, `features/customize` |
| `AI tools`, `Assistant`, `MCP` | `src/ai/`, `features/assistant`, `agent/mcp/` |
| `CLI` (or `CLI / MCP` when both) | `agent/` |
| `Install skill`, `Skills`, `Hermes` | `plugin/skills/`, `hermes/` |
| `Docs`, `CI`, `npm publishing`, `Changelog` | `docs/`, `.github/workflows/`, release plumbing |

A commit that spans several areas is usually two commits. Omit the prefix only
when no area fits (e.g. "Ignore agent worktrees").

Release commits belong to the maintainer, not to a PR (for 0.3.1:
`Changelog 0.3.1` with the entry, then the bare `0.3.1` written by
`npm version`).

## Subject

- Says what changed, in the present: "refuse unknown keys", "legend on the
  lead sources chart". No trailing period.
- ≤ 72 characters including the prefix.
- Lower case after the colon, except names, commands and acronyms
  (`CLI: objects get returns the object`).
- Commands, options, file names in backticks only in the body.

## Body

Optional, encouraged when the *why* isn't obvious from the subject:

- Wrap at 72 characters.
- Explain the problem before the fix; mention user-visible effects and
  anything a reviewer must test.
- Reference issues with a trailing `Closes #N` or `Refs #N`.

## Branch names

`<type>/<3-5-word-kebab-summary>` with `type` = `feat`, `fix`, `refactor`,
`docs`, `test` or `chore` (e.g. `fix/journal-poll-backoff`). Agent worktrees
create `worktree-agent-<id>` branches: rename them before pushing a PR.

## What to AVOID

- Generic subjects: "fix bug", "update files", "wip".
- Describing the request ("as asked…") instead of the code change.
- Mixing an unrelated fix into a feature commit.
