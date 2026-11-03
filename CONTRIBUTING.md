# Contributing to AgentCRM

Thanks for helping! AgentCRM is source-available under the PolyForm Noncommercial license; by contributing you agree your contribution is licensed the same way.

## Setup

```bash
npm install --legacy-peer-deps
npm run dev              # admin at http://localhost:5180 — pick "This browser" + demo data
npm run typecheck
npm test
npm run build            # dist/admin + dist/agent/agentcrm.mjs + dist/version.json
npm run check:skills     # after the build
npm run check:hermes     # needs python3
```

## Rules of the road

- Read `CLAUDE.md` (architecture and hard rules) and `AGENTS.md` (what must stay in sync).
- Business logic goes in `src/ops/` with Vitest tests next to it; UI in `src/features/<name>/`; CLI in `agent/`.
- No server code, ever. If something "needs a server", it runs in the browser, in the CLI (cron via GitHub Actions), or on a service the user owns.
- Never put a secret in `config.js`, the data, a plan file or a test fixture that looks real.
- English everywhere in code, docs and skills; UI strings through `t()` with `en` and `fr`.
- Keep the CLI JSON contract (one object on stdout, hints on errors, plans before destructive changes).

## Pull requests

- One topic per PR, with tests. CI runs typecheck, tests, build, `check:skills` and `check:hermes`.
- If you change a command, update `docs/cli.md`, the skills and regenerate Hermes (`npm run hermes:build`).
- Describe user-visible changes; maintainers add them to `changelog.json` at release time.
