# doctor checks

| id | What it proves | Typical fix |
|---|---|---|
| credential-data / -hosting / -passphrase | The accounts the site references are stored on this computer | The user runs `credentials set <account>` in their own terminal |
| encryption | The journal is encrypted | Keep the location private; migrate with `export json` into a new encrypted install |
| data-repo | The git data repo is private and writable | Make the repo private; check the token's Contents permission |
| data-access | The dataset opens (keys, passphrase, network) | Follow the hint (passphrase-required / passphrase-wrong / storage) |
| dataset | Standard objects, a pipeline, settings, an active admin exist | `doctor --repair` |
| cli-user | The CLI acts as an admin | `site credentials <alias> --user <admin email>` |
| purge | Soft-deleted records still stored | `compact` (plan, then `--yes`) |
| journal | Segments since the last snapshot (loading speed) | `compact --yes` |
| firestore-reads | Firebase: Firestore reads of this load (full / incremental from `~/.agentcrm/cache/`) | Informational; a full read happens on the first command and once a week |
| https | The admin is served over HTTPS | CDN / custom domain with TLS / Pages |
| admin | The admin page is served | `deploy-admin --yes`; Pages: wait a minute |
| admin-version | Hosted admin vs this release | `deploy-admin` (plan, then `--yes`) |
| config-js | config.js exists, matches the backend and holds no secret | `deploy-admin --yes`; revoke leaked keys first |
| cors-data | The data bucket answers a CORS preflight for the admin origin | Apply the printed CORS JSON to the bucket |
| data-exposure | The dataset is not downloadable from the public site | Separate private bucket |
