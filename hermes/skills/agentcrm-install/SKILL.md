---
name: agentcrm-install
description: "Install a new AgentCRM (static, AI-drivable CRM) for the user - ask where the CRM data lives (encrypted files on an S3-compatible bucket, a private GitHub / GitLab repo or a local folder, or Firebase / a private git repo as JSON), then where the admin app is hosted (S3, GitHub / GitLab / Cloudflare Pages, local folder), help create the keys and tokens without ever asking for secrets in the chat, write the install plan, install and verify with doctor. Use when the user wants to create, set up or install a CRM with AgentCRM."
version: 0.7.0
author: AgentCRM
license: PolyForm-Noncommercial-1.0.0
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [AgentCRM, CRM, Install, S3, Encryption]
    related_skills: [agentcrm-manage, agentcrm-admin, agentcrm-sales, agentcrm-extensions]
---

# Install an AgentCRM

AgentCRM is a HubSpot / Twenty-style CRM (companies, people, deals, pipelines, activities, tasks, custom objects, views, automations, lead forms, reports) that is 100% static: there is no AgentCRM server. The data lives on storage the user owns (encrypted by default); the admin is a static web app hosted anywhere; the `agentcrm` CLI and its MCP server drive the same engine headless.

**Language:** talk to the user in their language; keep commands, files and plans in English.

Every command is `npx -y @fleox-agent-crm/agentcrm@0.7.0 <command> --json` (Node.js 20+). Each prints ONE JSON object: `{"ok": true, "data": ...}` or `{"ok": false, "error": {"code", "message", "hint"}}`. When `ok` is false, read `error.hint` and act on it. Exit code 2 = a usage error in your command.

## Running the commands (Hermes)

Every `agentcrm <command>` below runs through this skill's Python wrapper: `python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py <command> …`. It adds `--json`, prints the CLI's JSON object (`{"ok": true, "data": …}` or `{"ok": false, "error": {code, message, hint}}`) and exits with the CLI's code. In the reference files, `python3 <skill dir>/scripts/agentcrm.py` means the same command with this skill's directory.

- **Requirements:** Python 3.9+ (stdlib only) and **Node.js 20.6+**: the AgentCRM engine is the `@fleox-agent-crm/agentcrm` npm package, fetched by `npx` on first use and pinned to the version of these skills. Without Node.js the wrapper answers `node-missing` with how to install it. `AGENTCRM_CMD` overrides the engine command (e.g. `node /path/to/agentcrm.mjs` from a clone).
- **From Python:** `sys.path.insert(0, "${HERMES_SKILL_DIR}/scripts")`, then `from agentcrm import run, AgentcrmError` — `run("records", "list", "--object", "deals", site="acme")` returns `data` and raises `AgentcrmError(code, message, hint)` when `ok` is false.
- **Plans:** a command that needs `--yes` and didn't get it writes nothing and answers `needsConfirmation: true` on `data` — test it with `needs_confirmation(data)` from the wrapper. The sentence "re-run with --yes" only exists in the human output, never match on text.
- **Secrets** never go through the chat. The user either types them in their own terminal (`python3 ${HERMES_SKILL_DIR}/scripts/agentcrm.py credentials set <account>` asks at a hidden prompt), or puts them in environment variables (e.g. in `~/.hermes/.env`) that you pass by name: `credentials set <account> --from-env VAR` (`--from-env KEY_ID,SECRET` for S3).

## 1. Start with status and options

```bash
npx -y @fleox-agent-crm/agentcrm@0.7.0 status --json
npx -y @fleox-agent-crm/agentcrm@0.7.0 options --json
```

`status` shows CRMs this computer already manages (maybe the user wants `agentcrm-manage` instead). `options` lists backends, data locations, hostings, credential types and the plan format.

## 2. Ask about the DATA first

The CRM holds personal data (contacts, emails, phone numbers). Ask, in this order, and recommend the first answer:

1. **Encrypted files on storage the user owns** (backend `journal`, the default). Where?
   - an **S3-compatible bucket** (AWS S3, Cloudflare R2, OVHcloud, Scaleway, Backblaze, MinIO) - best for teams and speed. Must be a PRIVATE bucket, separate from the hosting bucket.
   - a **private GitHub or GitLab repository** - simple if the user already lives on GitHub; one commit per write.
   - a **folder on this computer** - single computer, no account. Advise backing it up.
2. **Firebase** (backend `firebase`) - real-time teams with logins and per-user roles. See references/firebase.md.
3. **A private git repo as readable JSON** (backend `git-json`) - readable history, but deleted records stay in the git history: warn the user.
4. **This browser only** - for trying it: `npx -y @fleox-agent-crm/agentcrm@0.7.0 serve --json`, then "This browser" in the wizard. The CLI can't reach it.

Encryption: the journal is encrypted with AES-256-GCM by default. A passphrase is generated at install and stored only on this computer. Never offer to turn it off unless the user insists and the location is strictly private.

## 3. Then ask where the ADMIN is hosted

The admin app holds no data and no secret (its `config.js` is public by design):

- `s3` - a public bucket with static website hosting, behind HTTPS (CDN or the bucket's https endpoint).
- `github-pages` - a GitHub repo served by Pages (`https://<owner>.github.io/<repo>`).
- `gitlab-pages`, `cloudflare-pages` - same idea.
- `local-folder` - a folder of this computer (serve it with `serve --dir`).
- no hosting (`"hosting": false`) - the user runs `serve` when needed.

HTTPS is required: browsers only allow the admin's request signing and encryption on secure pages.

## 4. Credentials - never in the chat

Secrets (keys, tokens, passwords, passphrases) are NEVER typed into the conversation and never written in a plan. The user stores each one in their own terminal; in their own terminal they run `! npx -y @fleox-agent-crm/agentcrm@0.7.0 credentials set s3:main` (hidden prompt). Alternatives that keep secrets out of the chat:

- `--from-env KEY_ID,SECRET` - variables the user already exported (CI, `.env`).
- `--from-aws-profile <profile>` - an existing aws CLI profile (s3).
- `--from-gh` - the token of the signed-in GitHub CLI (github).

```bash
npx -y @fleox-agent-crm/agentcrm@0.7.0 credentials list --json
npx -y @fleox-agent-crm/agentcrm@0.7.0 credentials types --json
```

How to create each key with least privilege: references/s3.md, references/github.md, references/firebase.md. One account can serve several CRMs (`s3:main` for both the data bucket and the hosting bucket is fine).

## 5. Write the plan, dry-run, install

Write `plan.json` (no secrets, only account ids):

```json
{
  "alias": "acme-crm",
  "name": "Acme CRM",
  "owner": { "name": "Ada Lovelace", "email": "ada@acme.com" },
  "data": {
    "backend": "journal",
    "location": { "type": "s3", "settings": { "endpoint": "https://s3.gra.io.cloud.ovh.net", "region": "gra", "bucket": "acme-crm-data" }, "credential": "s3:main" },
    "root": "agentcrm"
  },
  "hosting": { "type": "s3", "settings": { "endpoint": "https://s3.gra.io.cloud.ovh.net", "region": "gra", "bucket": "acme-crm-admin", "siteUrl": "https://crm.acme.com", "publicRead": true }, "credential": "s3:main" },
  "demo": false
}
```

More examples (GitHub repo data + GitHub Pages, local folder, Firebase): references/plans.md. `owner` becomes the first CRM admin, and the CLI acts as that user. `demo: true` adds a realistic sample dataset - offer it for a first look, not for a production CRM.

```bash
npx -y @fleox-agent-crm/agentcrm@0.7.0 install --plan plan.json --dry-run --json
npx -y @fleox-agent-crm/agentcrm@0.7.0 install --plan plan.json --json
```

The dry run checks every access and writes nothing. Fix `check-failed` errors with their hint (permissions, names, CORS) before installing. An existing dataset in the same place is kept; only what's missing is seeded.

## 6. Save the passphrase - blocking step

When the result has `savePassphrase`, stop and do it with the user before anything else:

1. `npx -y @fleox-agent-crm/agentcrm@0.7.0 credentials copy passphrase:<alias> --json` puts it on the clipboard (never print it).
2. The user pastes it into their password manager now.
3. The user proves it: in their own terminal, `! npx -y @fleox-agent-crm/agentcrm@0.7.0 credentials verify passphrase:<alias>`, pasting FROM the password manager. It must say "verified".

Without the passphrase nobody can read the data, ever.

## 7. Verify

```bash
npx -y @fleox-agent-crm/agentcrm@0.7.0 doctor --site <alias> --json
```

Every failing check has a `fix`. The most common one on buckets is CORS: the result prints the exact JSON rule for the data bucket - help the user apply it (references/s3.md). Then give the user the admin URL (`data.adminUrl` of the install) and explain: each new browser asks once for the storage keys and the passphrase, which stay in that browser.

Next: run the CRM with the `agentcrm-admin` skill, sales workflows with `agentcrm-sales`, health and updates with `agentcrm-manage`. To let Claude Desktop / Claude Code / Cursor use the CRM directly, see references/mcp.md.
