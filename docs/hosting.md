# Where AgentCRM lives: data, admin, roles

AgentCRM has two halves:

- **the data**: in a place you own, which must be **private**;
- **the admin**: static files (HTML, JS, CSS) plus a `config.js` describing
  where the data is. They hold **no data and no secret**, so they can be
  public.

Keep them **separate**. Never put the admin in the bucket or repository that
holds the data, and never make the data location public.

Secrets (S3 keys, git tokens, passphrases) never go into `config.js`, the data
or git. Each browser enters its own once, and they are kept in that
browser's `localStorage`, under keys `agentcrm.secrets:<dataset>`. The CLI
keeps them in `~/.agentcrm/credentials.json` (mode 0600). **Settings →
Security** shows what a browser holds and can forget it.

## Data backends

| Backend | Where | Live sync | Accounts & roles | Personal-data erasure |
|---|---|---|---|---|
| **Encrypted file on my storage** (journal, default) | S3-compatible bucket, GitHub / GitLab repo, local folder | polling every 20 s | none: the storage keys + passphrase give full access | `compact` rewrites the snapshot and deletes old segments (git: history remains) |
| **Firebase** | your Firestore project | real time | Firebase Auth, roles enforced by rules ([firebase.md](firebase.md)) | deletes are physical |
| **Private git repository** (git-json) | GitHub / GitLab repo, local clone | polling every 30 s | each user's own token, repo permission → role | **git history keeps everything** |
| **This browser** | IndexedDB | — | single user | delete = gone |

You can move between them at any time: **Settings → Data backend → Move to
another backend** copies everything with ids preserved, then switches this
browser (and the hosted `config.js`) to the new one.

### Encrypted journal on any storage

Layout under the chosen folder (`agentcrm/` by default):

```
keyinfo.json          public: format, encryption on/off, PBKDF2 salt + iterations, encrypted check value
snapshot.bin          merged state (gzip → AES-256-GCM)
journal/<hlc>.bin     one encrypted file per change, never rewritten
```

- Encryption is **on by default**: AES-256-GCM, with a key derived from your
  passphrase by PBKDF2-SHA256 (600 000 rounds). The provider only ever sees
  random bytes. **A lost passphrase means lost data**: nobody can recover it.
- Change the passphrase, or turn encryption on or off, in **Settings → Data
  backend → Encryption**. AgentCRM compacts, then re-encrypts. Every other
  browser and the CLI must then enter the new passphrase. Do it while nobody
  else is editing.
- On a new browser, the access screen asks for the storage secrets (S3 keys
  or git token) and the passphrase. It checks them against `keyinfo.json`
  before saving anything.

#### S3-compatible bucket (AWS S3, Cloudflare R2, OVHcloud, Scaleway, MinIO)

1. Create a **private** bucket used only by this CRM. Leave public access
   blocked and add no website hosting.
2. Create an access key **limited to that bucket**, with `GetObject`,
   `PutObject`, `DeleteObject` and `ListBucket` (the journal lists its
   segments).
3. Add a **CORS** rule. The admin calls the bucket from the browser, so the
   bucket must allow the admin's origin. List every origin you open the admin
   from (`http://localhost:5180` for `npm run dev`).

**AWS S3**: Bucket → Permissions → CORS:

```json
[
  {
    "AllowedOrigins": ["https://crm.example.com", "http://localhost:5180"],
    "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
    "AllowedHeaders": ["authorization", "content-type", "cache-control", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

**Cloudflare R2**: R2 → bucket → Settings → CORS policy → Edit. It uses the
same JSON format. R2 does not support wildcard header patterns like
`x-amz-*`, so list the headers, or use `"*"`:

```json
[
  {
    "AllowedOrigins": ["https://crm.example.com", "http://localhost:5180"],
    "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, region `auto`,
path-style on. Create the R2 API token with **Object Read & Write** on this
bucket only.

**OVHcloud Object Storage** (S3 API) and **Scaleway**: set CORS through the S3
API, for example with the AWS CLI. Note the `CORSRules` wrapper:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://crm.example.com", "http://localhost:5180"],
      "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

```bash
# OVHcloud (region gra, sbg, de, …)
aws s3api put-bucket-cors --bucket my-crm-data --cors-configuration file://cors.json \
  --endpoint-url https://s3.gra.io.cloud.ovh.net
# Scaleway (fr-par, nl-ams, pl-waw)
aws s3api put-bucket-cors --bucket my-crm-data --cors-configuration file://cors.json \
  --endpoint-url https://s3.fr-par.scw.cloud
```

**MinIO**: `mc cors set alias/my-crm-data cors.xml`. Recent MinIO versions also
allow CORS origins server-wide with `MINIO_API_CORS_ALLOW_ORIGIN`.

Use **Test connection** in the wizard. It writes, reads, lists and deletes a
tiny `.agentcrm-probe.txt`. If listing fails, the key lacks `ListBucket` or
CORS blocks the request.

#### GitHub / GitLab repository (encrypted files)

Use a **private**, dedicated repository. The token needs Contents read &
write (GitHub fine-grained, this repo only) or `write_repository` (GitLab).
The encrypted segments are committed with `[skip ci]`. Note that git keeps
deleted segments in its history: they stay encrypted, but they don't
disappear.

#### Local folder

Chrome or Edge only (File System Access API). Point it at a folder synced by
Dropbox, iCloud, Syncthing or a NAS to share it. Browsers drop the folder
permission on reload, so a one-click **Reconnect the folder** screen appears.

### Private git repository (git-json)

One pretty-printed JSON file per document (`records/<object>/<id>.json`,
`activities/<id>.json`, `objects/<id>.json`, `users/<id>.json`,
`settings/general.json`, `config/<id>.json`…) under a folder of a
**private** repo, with one commit per change.

- If someone pushed in between, AgentCRM rebases. A conflict happens only when
  you both changed the same field. Your change is then rolled back and their
  version shows.
- Each person enters **their own token** on their browser (access screen),
  plus the email they are known by in the CRM.
- The wizard refuses a public repository.
- **History keeps every past version of personal data.** Erasing someone for
  good means rewriting the history. Prefer the encrypted journal if that
  matters to you.

## Roles

| Role | Can |
|---|---|
| **admin** | everything: data model (objects, fields), pipelines, settings, users & roles, automations, lead forms, hosting, compaction |
| **member** | create / edit / delete records, activities and tasks; own private views; import / export; run automations |
| **viewer** | read only |

The same matrix (`PERMISSIONS` in `src/ops/context.ts`) is checked by every op
(`assertCan`), so it applies to the admin, the CLI, MCP and the assistant
alike. How strongly it is enforced depends on the backend:

- **Firebase**: by the Firestore security rules, on every request
  ([firebase.md](firebase.md)). `users/{uid}.role` is the role.
- **git-json**: by the repository. The token's permission is a **ceiling**:
  GitHub admin or maintain (GitLab Maintainer+) → admin, write (Developer) →
  member, read → viewer. A CRM user marked admin whose token can only write
  acts as a member.
- **Journal**: whoever has the storage keys and the passphrase can read and
  write everything; the roles in Settings → Users are informative. Give keys
  only to people who should be admins, or use Firebase for real roles.
- **This browser**: single user, admin.

`useAuth()` (`role`, `isAdmin`) and `useCan(action)` / `useCurrentUser()`
expose the role to the UI. Settings sections and routes declare `roles`.

## Hosting the admin

The admin is a static build (`dist/admin`, relative paths, `HashRouter`), so
it works at any URL and in any sub-folder. The setup wizard (**Admin
hosting** step) and **Settings → Admin hosting** copy the running admin,
using the build's `admin-files.json` (written by
`scripts/write-admin-manifest.mjs`), plus a generated `config.js` into a
folder of:

| Target | Notes |
|---|---|
| **GitHub Pages** | A repo dedicated to the admin. Token: Contents read & write (+ Pages read & write to enable Pages automatically). Free plans need a public repo, which is fine: the admin holds no data. |
| **Cloudflare Pages** | Connect a (private) repo to a Pages project: no build command, output directory = the repo folder. Pair it with Cloudflare Access. |
| **GitLab Pages** | The admin goes under `public/`, and a minimal `.gitlab-ci.yml` is added. |
| **S3 static website** | A **different** bucket from the data, with static website hosting or a CDN, and public read on that bucket only. |
| **Local folder** | A folder served by your web server. |
| **ZIP** | Download the admin + `config.js` and upload them anywhere by hand. |

Or do it by hand: copy `dist/admin/*` to your host and put a `config.js`
next to `index.html`. Download it from the end of the wizard or from Settings
→ Admin hosting. `config.js` wins over the browser-local configuration.

Deploying copies **this** build. Run it from a built admin
(`npm run build && npm run preview`, or a hosted copy), not from
`npm run dev`, which has no `admin-files.json`.

### Protecting `/admin`

Without the right secrets, the admin shows nothing but its login / access
screen. You can still keep strangers from loading it at all:

- **Cloudflare Access** (Zero Trust, free up to 50 users): add a self-hosted
  application for `crm.example.com/admin*` with a policy such as "emails
  ending in @example.com" or one-time PIN. Works with Cloudflare Pages and
  with any origin proxied by Cloudflare.
- **Basic auth** on your own server. For nginx:

  ```nginx
  location /admin/ {
    auth_basic "AgentCRM";
    auth_basic_user_file /etc/nginx/agentcrm.htpasswd;   # htpasswd -c … alice
    try_files $uri $uri/ /admin/index.html;
  }
  ```

  Netlify (`_headers` + Basic-Auth) and Vercel (password protection) have
  equivalents.
- **Private bucket + presigned URL**: keep the admin in a private bucket and
  share time-limited presigned URLs to `index.html`. Assets are loaded
  relative to the page, so they need to be readable too. Simplest is a CDN
  with signed cookies (CloudFront) or Cloudflare Access in front of R2. Plain
  presigned URLs only suit occasional single-user access.

Whatever you choose, the **data location must stay private**. The admin
reaches it with each user's own keys or token, never with anything stored in
`config.js`.
