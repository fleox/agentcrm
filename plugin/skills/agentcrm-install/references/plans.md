# Install plan examples

## Encrypted journal in a private GitHub repo, admin on GitHub Pages

```json
{
  "alias": "acme",
  "owner": { "name": "Ada Lovelace", "email": "ada@acme.com" },
  "data": { "backend": "journal", "location": { "type": "github", "settings": { "owner": "acme", "repo": "acme-crm-data" }, "credential": "github:acme" } },
  "hosting": { "type": "github-pages", "settings": { "owner": "acme", "repo": "acme-crm" } }
}
```

## Local folder, no hosting (one computer)

```json
{
  "alias": "solo",
  "owner": { "name": "Me", "email": "me@example.com" },
  "data": { "backend": "journal", "location": { "type": "local-folder", "settings": { "path": "/Users/me/Documents/crm" } } },
  "hosting": false,
  "demo": true
}
```

Use it from the browser with `npx -y @fleox-agent-crm/agentcrm@0.9.2 serve --json` and the folder picker.

## git-json in a private repo

```json
{
  "alias": "team",
  "owner": { "name": "Ada", "email": "ada@acme.com" },
  "data": { "backend": "git-json", "git": { "provider": "github", "owner": "acme", "repo": "crm-json", "branch": "main" }, "credential": "github:acme" },
  "hosting": { "type": "cloudflare-pages", "settings": { "provider": "github", "owner": "acme", "repo": "crm-admin", "siteUrl": "https://crm-admin.pages.dev" } }
}
```

## Fields

- `alias`: lower-case letters, digits, dashes.
- `owner`: first admin (email required).
- `data.encryption`: omitted = encrypted with a new passphrase `passphrase:<alias>`; `{ "credential": "passphrase:<name>" }` = existing passphrase (reuse a dataset); `false` = plain (discouraged).
- `hosting.folder`: admin folder on the hosting, default `admin`.
- `currency`, `locale`: defaults for money and dates.
