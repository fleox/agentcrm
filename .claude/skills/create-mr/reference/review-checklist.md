# Auto-review checklist (AgentCRM)

What Claude looks for during Step 6 of `/create-mr`. Findings are sorted into
five buckets; each finding becomes a single `AskUserQuestion`. The hard rules
and contracts are in [CLAUDE.md](../../../../CLAUDE.md); what must stay in sync is
in [AGENTS.md](../../../../AGENTS.md).

## 1. Bugs

- One user action = one `store.write()` (with a `message`). A loop of writes
  breaks atomicity on every backend and makes one commit / segment / batch each.
- `patch` merges per field with dot paths (`fields.x`): a `set` where a `patch`
  was meant overwrites a teammate's concurrent edit (journal LWW per field,
  Firestore `update`).
- Reads after `ready()` are synchronous; code that awaits a `write()` and then
  reads must expect the optimistic value, and a rejected write rolls back.
- Ops must emit their plugin actions (`record.created`, `stage.changed`…) after
  the write, or automations and extension hooks silently miss the change.
- Automations: `ctx.depth` respected (`MAX_AUTOMATION_DEPTH`), no action that
  re-triggers itself forever.
- Dates are epoch ms everywhere (no `Date` objects in stored docs, no Firestore
  `Timestamp`).
- Relations: inverse lists are computed (`src/ops/relations.ts`), never written on
  both sides; hard delete / merge go through `rewriteReferences` and
  `src/ops/fileRefs.ts`.
- `deals`: `stage` and `pipeline` selects stay in sync with the pipelines
  (`src/ops/pipelines.ts`); moving a deal sets its probability.
- React: subscriptions cleaned up, `useSlot` (not `getSlot`) in components so
  module toggles re-render, virtualised grid row height via `useRowHeight()`.

## 2. Architecture

- **One engine, four front doors**: a business rule in a page, a CLI command, the
  MCP server or the assistant instead of `src/ops/`.
- **AI tools declared once** in `src/ai/` (`AI_TOOLS` + spread files); every door
  lists `listAiTools()`; `mutating` is correct.
- `src/ops/` stays pure TS over `DataStore`: no React, no DOM, no `window` (the
  CLI runs it in Node through `agent/browserEnv.ts`).
- Roles enforced in ops with `assertCan(ctx, action)`; new actions added to
  `PERMISSIONS` in `src/ops/context.ts`; `user: null` (system) only for
  maintenance paths.
- Contract signatures from CLAUDE.md unchanged — add optional fields / new
  exports instead.
- Feature folders don't edit each other; shared UI goes to `components/ui/`
  (additive). A new built-in feature = catalog entry in `src/core/modules.ts` +
  `module: moduleMeta(id)` + i18n keys (`src/ops/modules.test.ts`).
- Storage access through the connectors / `src/shared/siteFiles.ts`, never raw
  `fetch` to a bucket from a feature. New connector capabilities (like
  `listPrefix`) go in `SHARED.md` when they diverge from cms-ia.
- Extensions only reach the app through `@agent-crm/runtime`; a new runtime
  export follows the checklist in `extension-internals`.
- No server code, edge function or required third-party service (hard rule 1).

## 3. Style / conventions

- `strict` TypeScript: no needless `any`, domain types from `src/core/types.ts`.
- Code matches the surrounding naming, comment density and idiom.
- UI strings through `t()` in the feature's namespace, with **`en` and `fr`**
  (`src/i18n/parity.test.ts`).
- Every `<form>` has `data-form-type="other"`; submit buttons use the stable
  `<span>` icon wrapper of `Button` (never `{saving ? <A /> : <B />}` icon swaps).
- CLI: `--json` prints exactly one object, logs on stderr, exit codes 0 / 1 / 2,
  `CliError` with a `hint`, destructive commands plan unless `--yes`, writes take
  `lockSite`.
- Dead code, unused imports, magic numbers without a name.

## 4. Documentation

- Comments in English, only when the *why* is non-obvious. Never describe the
  current task or fix in a comment.
- **Skills follow the code**: a changed command, option, output field or error
  code updates `plugin/skills/` in the same change, then `npm run hermes:build`.
- New command: `agent/commands/index.ts` (usage, summary, options, subcommands),
  `docs/cli.md`, the skill, a test.
- User-visible change: proposed `changelog.json` line (maintainers add it at
  release time) with its `actions`.
- `docs/` and CLAUDE.md when the architecture or behaviour they describe
  changed; `docs/runtime-api-reference.md` for runtime exports
  (`scripts/docs.test.ts`); docs links use `blob/master` (`repo-presentation`).
- Code copied from or to cms-ia: `SHARED.md`.

## 5. Security

- Secrets (storage keys, git tokens, passphrases, Anthropic keys, Firebase
  passwords) in `config.js`, the dataset, module config, a plan, a log, a
  `--json` answer or a test fixture that looks real. They belong in per-browser
  storage (`src/lib/runtimeConfig.ts` secrets helpers) or
  `~/.agentcrm/credentials.json`. `buildConfigJsSource` and `setConfigDoc` refuse
  secrets — don't bypass them.
- Encryption of file backends: format `ACRMENC1`, fresh IV per write, salt kept
  in `keyinfo.json`, no code path that writes plain data to an encrypted dataset
  or files store.
- GDPR: deletions must stay purgeable by `compact` (records, activities and file
  bytes); nothing copies personal data somewhere `compact` can't reach.
- Firestore / Storage rules (`src/ops/firebaseRules.ts`): can an account grant
  itself a role? Is a new collection covered? Run the emulator harness of
  `firebase-internals`.
- Rendered HTML / Markdown goes through `src/components/ui/Markdown.tsx`
  (DOMPurify; only `file:` and `https:` images); SVG logos / favicons without
  scripts or handlers.
- Extensions: install stays admin-only, never an AI tool; packages validated by
  `src/extensions/package.ts`; ZIP paths and ids never used unchecked as file
  names.
- Lead forms / inbox: public input validated by the record engine; honeypot
  and timing checks kept.

## Severity grading

For each finding, pick one of:

- **Critical** — actively broken (bug bucket) or actively dangerous
  (security bucket). Default to "Apply".
- **Major** — design issue that will hurt soon (architecture bucket). Default
  to "Apply" unless the user objects.
- **Minor** — style nit, missing comment, magic number (style /
  documentation buckets). Surface as a batch at the end so the user can
  bulk-skip if pressed for time.

Always show the finding's line + the proposed fix in chat before asking —
the user must be able to evaluate the trade-off in seconds.
