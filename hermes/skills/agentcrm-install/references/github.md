# GitHub / GitLab for AgentCRM

## Token

Fine-grained personal access token: https://github.com/settings/personal-access-tokens/new

- Repository access: only the data repository (PRIVATE) and, if used, the admin hosting repository.
- Permissions: Contents read and write; Metadata read-only; Pages read and write (optional, lets the CLI enable Pages).

The user stores it: `! npx -y @fleox-agent-crm/agentcrm@0.9.0 credentials set github:<login>`, or reuses the GitHub CLI login: `npx -y @fleox-agent-crm/agentcrm@0.9.0 credentials set github:<login> --from-gh --json`.

GitLab: project → Settings → Access tokens, scope `api`, role Developer; store as `gitlab:<name>`.

## Data repository

Must be private: the install refuses a public data repository. Journal files are committed with `[skip ci]`. With `git-json`, every past value stays in the history (deleting a record does not erase it from git): tell the user.

## Admin on GitHub Pages

A second repository (it may be public: it only holds the app and a `config.js` without secrets). Plan: `"hosting": { "type": "github-pages", "settings": { "owner": "acme", "repo": "acme-crm" } }` - the credential defaults to the data one when both are on GitHub. Pages takes about a minute to serve a new commit; re-run `doctor` after that.
