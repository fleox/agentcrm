---
name: create-mr
description: Use when the user types `/create-mr`, asks to "open a PR", "create a pull request", "ship this work", "open the PR with what I just did", or any phrase meaning they want to push the current changes of the AgentCRM repository for review. Walks through a structured auto-review (repo checks + Claude-driven code review with interactive fixes), writes a commit message in the repository's own style, builds an English PR description, and pushes the branch to github.com/fleox/agentcrm. If `gh` CLI is installed and authenticated it opens the PR automatically; otherwise it prints a pre-filled GitHub "compare" URL the user clicks once in the browser (zero extra install, zero token). Asks the user at every destructive step. GitHub-only.
---

# create-mr — auto-review then open a GitHub Pull Request

This skill takes "I've finished a piece of work, ship it" and runs it through the
same checklist a careful colleague would: repo checks, code review, a commit
message in the house style, a structured PR description, issue linking, and
finally the actual push + PR open. Every destructive step is gated by
`AskUserQuestion`.

## Prerequisites

- Inside the AgentCRM repository, `origin` = `https://github.com/fleox/agentcrm.git`
  (default branch **`master`**). `git push` must already work (HTTPS credentials
  cached, or SSH key).
- **One of**:
  - `gh` CLI installed and authenticated (`gh auth status`) → fully automated PR creation, OR
  - Nothing extra → the skill prints a pre-filled GitHub "compare" URL that the
    user clicks once in their browser to finalize the PR. Zero install, zero token.
- Dependencies installed (`npm install --legacy-peer-deps`), `python3` for `check:hermes`.

`gh` isn't installed on the maintainer's machine, so expect `MODE = "compare-url"`.
Most work on this repo lands on `master` directly (often through a QA
integration branch fast-forwarded, see `agent-cli-internals`): use this skill
only when a PR is what the user wants. Never push to `master` from this skill.

## Workflow

### Step 1 — pre-flight

```bash
git rev-parse --is-inside-work-tree
git symbolic-ref --short HEAD
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'   # may be unset: default to master
git status --porcelain
git remote get-url origin
command -v gh >/dev/null && gh auth status -h github.com 2>&1
git fetch origin master
```

Capture: `currentBranch`, `defaultBranch` (`master`), the working-tree state, the
origin URL (to derive `<owner>/<repo>` = `fleox/agentcrm`), and whether `gh` is
available + authenticated.

Set `MODE = "gh"` if `gh` is installed AND authenticated; otherwise
`MODE = "compare-url"`. Both modes are first-class — only Step 11 differs.

When the session runs inside an agent worktree (`.claude/worktrees/…`, branch
`worktree-agent-…`), say so and offer to rename the branch to a descriptive name
before pushing.

### Step 2 — pick / create the working branch

- If `currentBranch !== defaultBranch` → keep it, just note in chat (`Working
  on <currentBranch> → target master`).
- If `currentBranch === defaultBranch` → we can't open `master → master`.
  Infer a **type** (`feat` / `fix` / `chore` / `refactor` / `docs` / `test`)
  from the staged + unstaged diff, then a 3–5 word kebab **slug**. Confirm via
  `AskUserQuestion`:

  ```
  header: "Branch name"
  question: "You're on master. Create a new branch?"
  options:
    - label: "<type>/<inferred-slug> (Recommended)"
      description: "Convention: <type>/<3-5-word-kebab-summary>."
    - label: "Let me type a name"
      description: "I'll provide the branch name in chat."
    - label: "Cancel"
      description: "Abort /create-mr."
  ```

  On approval: `git checkout -b <branch>` (uncommitted changes follow the branch;
  local commits ahead of `origin/master` do too — mention them).

### Step 3 — handle uncommitted changes

If `git status --porcelain` is non-empty, ask via `AskUserQuestion`:

```
header: "Uncommitted"
question: "There are uncommitted changes. How do you want to handle them?"
options:
  - label: "Commit them as part of this PR (Recommended)"
    description: "I'll stage everything, run the auto-review, and use a single commit message."
  - label: "Include without auto-committing"
    description: "Stage but don't commit; the user wants to review in another tool first."
  - label: "Cancel"
    description: "Abort /create-mr."
```

The default flow stages with `git add -A` **after** the auto-review fixes are
applied (Step 6). `dist/`, `node_modules/`, `.claude/worktrees/` and `.env*` are
git-ignored; if `git status` shows any of them, stop and ask.

### Step 4 — collect the diff

```bash
# Files outgoing vs master
git diff --name-only origin/master...HEAD

# Local uncommitted (working + staged)
git status --porcelain

# Patch text for review
git diff origin/master...HEAD
git diff            # unstaged
git diff --staged
```

If both outgoing AND working files are empty → "Nothing to ship." Stop.

### Step 5 — repo checks on what changed

Pick the checks from the changed paths:

| Changed | Run |
|---|---|
| Any `.ts` / `.tsx` | `npm run typecheck` (admin + `tsconfig.agent.json`) |
| `src/`, `agent/`, `scripts/*.test.ts` | `npx vitest run <related test files>`, then `npm test` before shipping |
| `src/features/**`, `src/app/**` | also `npx vitest run src/app/App.test.tsx` (whole-shell smoke test) and `src/i18n/parity.test.ts` when i18n bundles changed |
| `agent/`, `plugin/skills/`, `changelog.json`, `package.json` | `npm run build`, then `npm run check:skills` and `npx vitest run agent/bundle.test.ts` (nothing to commit: `dist/` is git-ignored) |
| `plugin/skills/`, `hermes/python/` | `npm run hermes:build`, then `npm run check:hermes` — commit the regenerated `hermes/skills/` (never edit it by hand) |
| `src/extensions/`, `public/runtime/`, `types/agentcrm-runtime.d.ts`, `external/` | `npx vitest run src/extensions scripts/docs.test.ts`; `npm run build:examples` + `node dist/agent/agentcrm.mjs ext check dist/extensions/<zip>` (`extension-internals`) |
| `src/ops/firebaseRules.ts` | the emulator harness of `firebase-internals` |

Don't run `npm run build` while another agent is running tests against `dist/`.
Never start `npm run dev` (the owner may be running it on 5180).

For each check that reports errors, list the findings and ask the user (via
`AskUserQuestion`) whether to fix them as part of this PR. Tell the user which
checks you skipped and why.

### Step 6 — Claude auto-review

Read each modified file with surrounding context, classify findings into five
buckets (see [`reference/review-checklist.md`](reference/review-checklist.md)):

1. **Bugs** — null deref, unhandled rejections, races between an optimistic write
   and the next snapshot, several `store.write()` calls for one user action.
2. **Architecture** — "one engine, four front doors": business rules only in
   `src/ops/`, AI tools only in `src/ai/`, feature folders don't edit each other,
   contracts in [CLAUDE.md](../../../CLAUDE.md) keep their signatures.
3. **Style / conventions** — `strict` TypeScript, naming, dead code, matching the
   surrounding code; UI strings through `t()` in `en` and `fr`.
4. **Documentation** — comments in English, only when the *why* is non-obvious;
   skills, `docs/cli.md` and `changelog.json` follow the code (AGENTS.md).
5. **Security** — secrets in `config.js`, the data, a plan, a log or a `--json`
   answer; encryption; GDPR purge; Firestore / Storage rules; extension safety.

For each finding, ask via `AskUserQuestion` (single-select):

```
header: "Apply fix?"
question: "<file>:<line> — <one-line summary of the finding>"
options:
  - label: "Apply the proposed fix (Recommended)"
    description: "<short description of what changes>"
  - label: "Skip this finding"
    description: "Leave the code as-is."
  - label: "Discuss in chat"
    description: "Propose a different approach in chat first."
```

Process findings sequentially. After applying, **re-run the Step 5 checks** for
the touched files to confirm nothing regressed.

#### Tests are a suggestion, not a blocker

CLAUDE.md asks for a Vitest test next to every op and store. If the diff adds or
modifies logic without touching tests:

```
header: "Tests?"
question: "No tests cover the new logic in <file>. Add a test?"
options:
  - label: "Yes, add a Vitest test (Recommended for non-trivial logic)"
    description: "Next to the code (`*.test.ts`, `setupTestCrm()` for ops), or an `agent/e2e-*.test.ts` on the fakes for a CLI behaviour."
  - label: "Skip"
    description: "Open the PR without test coverage."
```

### Step 7 — build the commit message

The repository's history uses `<Area>: <subject>` (see
[`reference/commit-messages.md`](reference/commit-messages.md)):

```
<Area>: <subject, imperative or descriptive, ≤ 72 chars>

<body — why the change, what reviewers must know, wrapped at 72>
```

Never add `Co-Authored-By: Claude` or a "Generated with Claude Code" line, in the
commit or the PR body.

Infer `<Area>` and `<subject>` from the diff. Show the draft in chat, then
confirm via `AskUserQuestion`:

```
header: "Commit msg"
question: "Use this commit message?"
options:
  - label: "Use as-is (Recommended)"
    description: "Commit with the message above."
  - label: "Let me edit it"
    description: "I'll provide a different message in chat."
```

### Step 8 — ask about the related issue

```
header: "Related"
question: "Is this work linked to an issue?"
options:
  - label: "GitHub issue"
    description: "I'll close it automatically via `Closes #N` in the PR body."
  - label: "None / other"
    description: "Skip the linking. You can edit the PR later if needed."
```

### Step 9 — build the PR description

Use the [`reference/pr-template.md`](reference/pr-template.md) template, in
**English**: Summary, Motivation, Changes, How to test, Related, Risk & rollback
(+ "Changelog" when the change is user-visible: the line proposed for
`changelog.json`, which maintainers add at release time). Skip sections that
don't apply.

### Step 10 — final confirmation

Show the user a single block:

- Source branch → `master`
- Commit message (full)
- PR title (= first line of the commit message)
- PR body (rendered)

Ask via `AskUserQuestion`:

```
header: "Ship it?"
question: "Commit, push, and open the GitHub Pull Request?"
options:
  - label: "Yes, ship it (Recommended)"
    description: "Run the full sequence in one go."
  - label: "Show me the diff once more"
    description: "Print `git diff origin/master...HEAD` again in chat."
  - label: "Cancel"
    description: "Abort. Branch + commits remain local."
```

### Step 11 — execute

Common prelude (regardless of mode):

```bash
# Stage every modification (auto-fixes from review + any user edits)
git add -A

# Commit with the message from Step 7 (HEREDOC keeps multi-line bodies intact)
git commit -m "$(cat <<'EOF'
<full message from Step 7>
EOF
)"

# Push the branch (no force, ever)
git push -u origin "<currentBranch>"

# Persist the PR body so both modes can read it
BODY_FILE="$(mktemp "${TMPDIR:-/tmp}/create-mr-body.XXXXXX")"
cat > "$BODY_FILE" <<'EOF'
<full PR body from Step 9>
EOF
```

Then branch on `MODE`:

#### MODE = "gh" — auto-create via `gh` CLI

```bash
gh pr create \
  --repo fleox/agentcrm \
  --base master \
  --head "<currentBranch>" \
  --title "<PR title — first line of the commit message>" \
  --body-file "$BODY_FILE"
```

`gh pr create` prints the PR URL on success. Share it with the user.

#### MODE = "compare-url" — pre-filled GitHub PR page

```bash
# Derive owner/repo from the origin URL (https or ssh). Separate -e
# expressions keep it portable between GNU and BSD (macOS) sed.
OWNER_REPO=$(git remote get-url origin \
  | sed -e 's|^https://github\.com/||' \
        -e 's|^git@github\.com:||' \
        -e 's|\.git$||')

# URL-encode title and body with python3 (no jq needed)
TITLE_ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "<PR title>")
BODY_ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(open(sys.argv[1]).read()))" "$BODY_FILE")

PR_URL="https://github.com/${OWNER_REPO}/compare/master...<currentBranch>?expand=1&title=${TITLE_ENC}&body=${BODY_ENC}"
echo "Open this URL to finalize the PR (title + body are pre-filled, just click 'Create pull request'):"
echo "  ${PR_URL}"
```

Print the URL in chat and ask the user to click "Create pull request" on the
page that opens. The skill considers the work done at this point.

> GitHub also prints a `https://github.com/fleox/agentcrm/pull/new/<branch>` line
> during `git push`. It works too but doesn't pre-fill the title / body.

### Step 12 — final summary

```
✓ Branch:     fix/journal-poll-backoff (new) → master
✓ Checks:     typecheck ✓, tests ✓, build ✓, check:skills ✓, check:hermes ✓
✓ Review:     3 findings, 3 applied
✓ Commit:     Journal: back off polling after storage errors
✓ Pushed:     origin/fix/journal-poll-backoff
✓ PR:         https://github.com/fleox/agentcrm/compare/master...fix/journal-poll-backoff (click to create)
```

## Things to ask the user before doing

- Creating a new branch when on `master` (Step 2).
- How to handle uncommitted changes (Step 3).
- Whether to fix check failures (Step 5).
- Every individual auto-review finding (Step 6).
- Whether to add a test (Step 6).
- Whether the commit message is OK (Step 7).
- Which issue to link (Step 8).
- The final "Ship it?" gate (Step 10).

## Things to never do

- `git push --force` — neither directly nor through any flag — or a push to `master`.
- `git commit --no-verify` unless the user explicitly chose to skip a failing hook.
- Merge the PR after creating it. The skill **only opens** the PR.
- Modify `.env*`, or `package.json` beyond what the user's diff already touches.
- Edit `hermes/skills/` by hand (generated) or commit `dist/` (git-ignored, built at publish).
- Run `npm version`, create or push a `v*` tag, or `npm publish`: that releases to npm.
- Add Claude attribution to a commit or PR.
- Edit files unrelated to the diff to "improve" them — stay scoped.
- Run destructive git operations (`reset --hard`, `clean -fd`, `checkout -- <file>`
  against modified files), or remove agent worktrees you didn't create.

## Reference

- [`reference/review-checklist.md`](reference/review-checklist.md) — what Claude checks in this repository, bucket by bucket.
- [`reference/pr-template.md`](reference/pr-template.md) — the canonical English PR body template.
- [`reference/commit-messages.md`](reference/commit-messages.md) — area / subject / body rules and branch names.
