# Releasing

1. Make sure `main` is green (typecheck, tests, build, `check:skills`, `check:hermes`).
2. Add the release to `changelog.json` (newest first): `version`, `date`, `breaking`, `changes[]` (user-facing), `actions[]` (what users must run after `deploy-admin`, e.g. `compact`).
3. Bump `package.json → agentcrm.dataSchema` if the stored format changed (older admins could no longer read new data), and `agentcrm.minSkillsVersion` if older skills no longer work with this CLI.
4. `npm version patch|minor|major` — the `version` hook runs `scripts/sync-version.mjs` (plugin.json, skills' `metadata.version`, every pinned `@agent-crm/agentcrm@x.y.z` in skills and docs), rebuilds, regenerates `hermes/skills`, and stages `plugin`, `hermes`, `.claude-plugin`.
5. `npm run check:skills && npm run check:hermes`.
6. `git push --follow-tags`, then `npm publish --access public` (the package ships `dist/agent`, `dist/admin`, `dist/version.json`, `plugin`, `changelog.json`, `README.md`, `LICENSE`).
7. Users get it with `/plugin marketplace update agentcrm` (Claude Code) or `hermes skills update`; `agentcrm status` then proposes `deploy-admin` for each hosted admin.
