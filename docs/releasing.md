# Releasing

The package is published to npm as [`@fleox-agent-crm/agentcrm`](https://www.npmjs.com/package/@fleox-agent-crm/agentcrm) (public, scope `fleox-agent-crm`). `dist/` is not committed: every publish builds it.

## One-time setup

1. **npm organisation**: on npmjs.com → *Add Organization* → `fleox-agent-crm` (free plan, public packages).
2. **First publish by hand** (npm only allows trusted publishing on an existing package):
   ```bash
   npm login                # browser login, 2FA
   npm publish              # prepublishOnly runs typecheck, tests, build, check:skills
   ```
   `publishConfig.access` is `public`, so no `--access` flag is needed.
3. **Trusted publishing** (no npm token stored anywhere): npmjs.com → package `@fleox-agent-crm/agentcrm` → *Settings* → *Trusted Publisher* → GitHub Actions, owner `fleox`, repository `agentcrm`, workflow `release.yml`. Optionally then set *Publishing access* to "Require two-factor authentication and disallow tokens".

## Each release

1. Make sure `master` is green (typecheck, tests, build, `check:skills`, `check:hermes`).
2. Add the release to `changelog.json` (newest first): `version`, `date`, `breaking`, `changes[]` (user-facing), `actions[]` (what users must run after `deploy-admin`, e.g. `compact`).
3. Bump `package.json → agentcrm.dataSchema` if the stored format changed (older admins could no longer read new data), and `agentcrm.minSkillsVersion` if older skills no longer work with this CLI.
4. `npm version patch|minor|major`: the `version` hook runs `scripts/sync-version.mjs` (plugin.json, skills' `metadata.version`, every pinned `@fleox-agent-crm/agentcrm@x.y.z` in skills and docs), rebuilds, regenerates `hermes/skills`, and stages `plugin`, `hermes`, `.claude-plugin`.
5. `git push --follow-tags`. The `Release` workflow (`.github/workflows/release.yml`) checks that the tag matches `package.json`, runs every check, smoke-tests the packed tarball, publishes with provenance, and creates the GitHub Release from `changelog.json`. It skips the publish if that version is already on npm.

The package ships `dist/agent`, `dist/admin`, `dist/version.json`, `types/agentcrm-runtime.d.ts`, `plugin`, `changelog.json`, `README.md`, `LICENSE`.

Users get it with `npx -y @fleox-agent-crm/agentcrm@<version>`, `/plugin marketplace update agentcrm` (Claude Code) or `hermes skills update`; `agentcrm status` then proposes `deploy-admin` for each hosted admin.
