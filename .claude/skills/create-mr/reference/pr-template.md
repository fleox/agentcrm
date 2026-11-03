# PR description template

The canonical body written to the temporary body file and passed to
`gh pr create --body-file …` (or URL-encoded into the compare URL). Fill every
applicable section in **English**.

```markdown
## Summary

<1–2 sentences: what this PR does and the user-visible effect.>

## Motivation

<Why this change is needed. Reference the issue or bug report.
Explain the problem before the solution.>

## Changes

- <bullet 1: imperative voice — "Add `records list --filter` validation…">
- <bullet 2>
- <bullet 3>

## How to test

- [ ] <reproducible step 1, e.g. `npx vitest run src/ops/records.test.ts`>
- [ ] <reproducible step 2, e.g. `node dist/agent/agentcrm.mjs records list --object deals --json` on a test CRM>
- [ ] <expected output / behaviour>

## Changelog

<One user-facing line for `changelog.json` → `changes[]`, and any `actions[]`
users must run after updating (redeploy the admin, update the skills,
re-publish the Firebase rules…).>

## Related

- Closes #N                                ← if GitHub issue

## Risk & rollback

<One short paragraph: what could break? Data format (dataSchema)? Firebase
rules users must republish? How to revert (`git revert <sha>` is the default).>
```

## When to omit sections

| Section            | Skip when                                                     |
|--------------------|---------------------------------------------------------------|
| `Motivation`       | Trivial fix where the motivation is in the subject line       |
| `How to test`      | Pure docs / typo fix that needs no manual verification        |
| `Changelog`        | Nothing user-visible (tests, refactors, contributor docs)     |
| `Related`          | No linked issue                                               |
| `Risk & rollback`  | Truly trivial change (one-line typo, comment, doc-only)       |

`Summary` and `Changes` are **mandatory** — a reviewer must be able to grasp
what changed without reading the diff.

## Style rules

- Bullet list under `Changes` — imperative voice, no trailing period.
- `How to test` uses GitHub checkboxes (`- [ ]`) so the reviewer can tick
  them off. Commands run against a test CRM or the fakes, never a real
  customer CRM.
- Numbers should be precise where the diff allows ("journal poll: 1 request
  instead of 3 per cycle" beats "fewer requests").
- Link external context inline next to the bullet it motivated.

## What NEVER goes in the PR body

- Personal context or journaling.
- Speculation about future work — open a follow-up issue instead.
- Credentials, passphrases, API keys, bucket names or repos of real users,
  personal data from a CRM (contacts, emails).
- Claude attribution (`Co-Authored-By`, "Generated with Claude Code").
- Long copy-pasted shell sessions — a tight `<details><summary>` block at most.
