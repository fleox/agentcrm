# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories ("Report a vulnerability" on the repository's Security tab), or by opening an issue asking for a private contact if advisories are unavailable. Don't include exploit details in public issues. We aim to acknowledge within 72 hours.

## Security model

AgentCRM has no server: the admin runs in the user's browser and the CLI on the user's computer. The trust boundaries are:

- **Storage you own** (bucket, repo, folder, Firebase project) holds the data. With the default journal backend every file is encrypted client-side: passphrase → PBKDF2-SHA256 (600 000 iterations, per-dataset salt) → AES-256-GCM, payloads gzipped first. `keyinfo.json` (public) holds the salt, iteration count and an encrypted check value only.
- **Secrets** (storage keys, git tokens, Firebase passwords, passphrases, the Claude API key) stay in the browser's localStorage (scoped per dataset) or in `~/.agentcrm/credentials.json` (mode 0600, re-tightened on read). They never go into `config.js`, the data, plans or logs; the CLI never prints them.
- **The hosted admin** is public static code plus a `config.js` with public settings only. `agentcrm doctor` fails when `config.js` contains a secret-looking key.
- **Roles** (admin / member / viewer) are enforced by the engine in every front door. On storage backends anyone holding the keys and passphrase has full access; per-user enforcement against a malicious client needs the Firebase backend and its security rules.

## What users should do

- Use a private bucket / repository for the data, separate from the public admin hosting.
- Scope keys to the CRM buckets / repos only; rotate them if a device is lost.
- Save the passphrase in a password manager (`agentcrm credentials copy` / `verify`).
- Serve the admin over HTTPS.
- Run `agentcrm compact` to physically erase deleted personal data (GDPR). The git-json backend keeps history: rewriting git history is the only way to erase there.

## Supported versions

Security fixes go to the latest release; update with `npx -y @fleox-agent-crm/agentcrm@latest status` and `deploy-admin`.
