# Images & attachments

AgentCRM stores **record images** (a person's photo, a company's logo, the image field of any custom object) and **attachments** (images, PDFs, Office documents, anything) on notes, tasks, calls, emails, meetings and records. Like the rest of the data, files go to storage **you** own — there is still no server of ours.

## What you get

- **Photo / logo** — `people.avatar` and `companies.logo` (field type `image`), shown next to the name everywhere: record header, tables, kanban cards, relation chips, the search palette. Click (or drop an image on) the avatar in the record header, adjust the square crop (zoom + drag), save; *Replace* / *Remove* from the same menu. Initials are shown when there is no image. Any object gets an avatar by adding a field of type **Image** (Settings → Data model; the first image field becomes the object's *image field*, changeable in the object settings) — or uses a URL field, see [below](#record-images-from-a-url).
- **Attachments** — the activity composer and the task editor take files from the *Attach* button, drag & drop or paste (screenshots). Pasted images are inserted inline in the Markdown body as `![name](file:<id>)`; other images can be inserted with the image button of their chip. Timeline items and task rows show image thumbnails (click → lightbox, ←/→, Esc) and document chips (icon by type, size, open in a new tab, download, delete).
- **Files tab** on every record: its own files, its image / files fields and — toggle *Include files of activities and related records* — the attachments of its activities and of linked records (a company's people and deals). Drop zone, grid / list, sort (newest, oldest, name, size), search, preview, download, delete.
- **Custom fields** of type `image` (one file) and `files` (several).

### Record images from a URL

An object's image field can also be a **URL field** (Settings → Data model → object → *Image field*, or `"imageField"` in [`schema apply`](schema-as-code.md)). Its value — an `https://` URL of an image hosted elsewhere, such as a logo CDN or the source system you mirror — is shown in lists, kanban cards, the search palette and the record header like a stored image, without any upload and without file storage (handy on Firebase without Storage, or for thousands of [synced](sync.md) companies). An image that fails to load falls back to the initials; only `https://` values are displayed. The URL is fetched by each viewer's browser from that host (which therefore sees the viewer's IP address); nothing is copied into the CRM. Set it like any field (`records update <id> --set logoUrl=https://…`, or `records sync`); the crop / upload menu of the record header and `records image` apply to `image` fields only.

## Where the bytes live

| Backend | Bytes | Metadata |
|---|---|---|
| **Journal** (S3 / R2 / OVH bucket, git repo, local folder) | `<root>/files/<id>.bin` on the same connector, **encrypted with the dataset key** (AES-256-GCM, same format as the journal: `ACRMENC1 \| iterations \| salt \| iv \| ciphertext`); plain bytes only when the dataset itself is unencrypted | `files/<id>` documents, inside the encrypted journal like every other document |
| **This browser** (local) | IndexedDB database `agentcrm-local-files` | IndexedDB, with the rest |
| **git-json** | `files/<id>.bin` in the data folder of the repo — one commit per upload batch | `files/<id>.json` |
| **Firebase** | Firebase Storage, `files/<id>` of your project — or, with `files.endpoint` in the runtime config, an HTTP files endpoint you run (see below) | Firestore collection `files` |

Thumbnails are stored the same way as `<id>_t`. Metadata (`FileMeta`, `src/core/types.ts`): `{ id, name, mime, size, width?, height?, thumbId?, sha256, createdAt, createdBy?, targets: { kind: "record" | "activity", object?, id }[], deletedAt? }`. Activities list their files in `attachments` (file ids); `image` / `files` fields hold file ids.

The bucket / repo / folder is **never assumed to be public**: files are always read back through the connector with your credentials and decrypted in the browser (blob URLs, revoked after use). No public URL is ever generated.

### S3-compatible buckets

The journal already needs `GET`, `PUT`, `DELETE` and listing (`listPrefix`) on the bucket. Files use the same calls on `files/`, so an existing CORS rule that allows these methods for the admin's origin is enough:

```json
[{ "AllowedOrigins": ["https://crm.example.com"], "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"], "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
```

### git-json

Every upload is a commit (base64 blob). Git history keeps every file **forever**, even after deletion, and large binaries slow a repository down — the admin warns about it. Prefer the encrypted journal backend for many or personal files.

### Firebase Storage

1. Firebase console → **Build → Storage** → *Get started* (choose a location).
2. Make sure the Firebase web config the admin uses (pasted in the setup wizard, saved in `config.js`) has `storageBucket` (e.g. `acme-crm.appspot.com` / `acme-crm.firebasestorage.app`).
3. Deploy the generated **storage rules** (setup wizard → *storage.rules*, or `buildStorageRules()` in `src/ops/firebaseRules.ts`): active CRM users read, members upload, admins delete (compaction); size bounded; roles read from Firestore `users/{uid}`:

   ```bash
   firebase deploy --only storage   # firebase.json from the wizard references storage.rules
   ```

   The first deploy asks to grant Storage access to Firestore (cross-service rules) — accept.
4. The admin reads bytes with `getBytes()`, which needs **CORS** on the bucket for the admin's origin:

   ```bash
   echo '[{"origin":["https://crm.example.com"],"method":["GET"],"maxAgeSeconds":3600}]' > cors.json
   gsutil cors set cors.json gs://<your-bucket>
   ```

Without Storage, uploads fail with a clear message ("Firebase Storage isn't enabled for this project…"); everything else keeps working (demo data is installed without images).

### HTTP files endpoint (Firebase without Firebase Storage)

To keep Firestore and Firebase Auth but store the bytes elsewhere (your own S3 bucket, encrypted on your side), add a files endpoint to the runtime config:

```js
window.__AGENTCRM_CONFIG__ = { backend: "firebase", firebase: { … }, files: { endpoint: "files" } };
```

`endpoint` is an absolute URL, or a path relative to the admin page (`"files"` next to `/crm/` → `/crm/files`; relative paths work in the browser only — the CLI needs an absolute URL, see below). The admin and the CLI then send every file to it (`src/data/files/http.ts`) instead of Firebase Storage; no `storageBucket`, storage rules or bucket CORS are needed. Every request carries `Authorization: Bearer <Firebase ID token>` of the signed-in user (the CLI: its `firebase:<name>` login):

| Request | Answer |
|---|---|
| `PUT <endpoint>/<id>` (body = bytes, `Content-Type` = MIME, `X-File-Name` = URI-encoded name) | `2xx` |
| `GET <endpoint>/<id>` | `200` + bytes, or `404` |
| `DELETE <endpoint>/<id>` | `2xx`, also when already gone (`404` accepted) |
| `GET <endpoint>/` | `200 {"ids": [...]}` — every stored id, for the purge of orphans (admins) |

Ids match `^[A-Za-z0-9_-]{1,80}$` (thumbnails are `<id>_t`). `503` means the endpoint has no storage configured (shown as "storage unavailable"); other errors are shown with the endpoint's `{"error": "…"}` message.

**The endpoint is responsible for access control**: verify the ID token (signature with Google's public keys, `aud` = the project id, `iss` = `https://securetoken.google.com/<project>`, not expired), then read the caller's `users/<uid>` from Firestore — with their own token, which the rules allow — and apply the same roles as the storage rules: active users read, members and admins write and delete, admins list; disabled or unknown users get `403`. Keep the bucket keys and any encryption key on the server: the browser only ever holds the user's ID token.

Other notes:

- `files.endpoint` is read from the runtime config (`config.js`, or the CLI's site registry) and is public like the rest of it: it holds no secret. It only applies to the Firebase backend.
- The endpoint is called directly by the browser: when it is on another origin than the admin, answer CORS preflights (`Authorization`, `Content-Type`, `X-File-Name` request headers; `GET`, `PUT`, `DELETE`). Requests are sent with `cache: "no-store"` and `credentials: "same-origin"` (no cookies cross-origin).
- Bytes arrive as AgentCRM prepared them (images already resized / thumbnailed by the admin) and unencrypted over HTTPS: encrypt them at rest on the endpoint's side if you need to.
- The CLI has no page to resolve a relative endpoint against: file commands then fail with "…must be an absolute URL here". A site registered with `site add --admin-url` copies the admin's `config.js`; when it says `"files"`, give the CLI an absolute URL with `site runtime` (below).
- Uploads of a batch are sent one by one; there is no resumable upload, so keep `settings.maxUploadMb` in line with what the endpoint accepts.
- `compact` (admin login, in the admin or the CLI) lists the endpoint (`GET <endpoint>/`) and deletes the stored ids that no file metadata references.

For a CLI registered before the endpoint existed: `agentcrm site runtime <alias> --runtime <json|@file>` replaces its runtime config (same backend and project only):

```bash
agentcrm site runtime acme --runtime '{"backend":"firebase","firebase":{"apiKey":"…","projectId":"acme-crm"},"files":{"endpoint":"https://crm.acme.com/files"}}'
```

## Limits & processing

- **Max upload size**: 25 MB per file by default — Settings → General → *Files & images* (`settings.maxUploadMb`, 1–1024), enforced by the engine for every front door (admin, CLI, MCP). Firebase Storage rules add a hard cap (100 MB by default).
- **Images are processed in the browser** before upload (canvas / `createImageBitmap` / `OffscreenCanvas`, no dependency): photos larger than 2560 px (or heavier than 1.5 MB) are scaled down and re-encoded as WebP (JPEG where the browser can't encode WebP) at quality 0.85; every raster image gets a 320 px WebP thumbnail. GIFs (animation) and SVGs (vector) are kept as they are; documents are never touched. Avatars are cropped to a square (512 px).
- The **CLI** uploads files as they are (no resizing in Node); it reads the pixel size of PNG / JPEG / GIF / WebP from their headers.
- Opening in a new tab is limited to types that can't run scripts (images, PDF, plain text, audio / video); HTML and SVG are downloaded instead. Inline images in Markdown accept only `file:` and `https:` sources; everything else is dropped.

## Deleting & GDPR erasure

- **Delete** a file (timeline, task row, Files tab, `agentcrm files delete`) = soft delete: it disappears from its records / activities at once (references removed), the bytes stay until the next compaction.
- Hard-deleting a record (or its activities) removes them from the files' targets; a file left without any target is soft-deleted.
- **`compact`** (Settings → Danger zone, `agentcrm compact --yes`) physically deletes the bytes **and** metadata of deleted files, of files whose every target is gone and that nothing references any more, and stored blobs without metadata (an interrupted upload). A file uploaded but never attached survives one day (it may belong to a note being written).
- Merging records moves their files to the kept record.

## Backups

Settings → Export → **Download ZIP (data + files)** = `data.json` (the JSON export, file metadata included) + `files/<id>.bin` (decrypted bytes). Restore it from the same page (choose the `.zip`): the bytes go to the current backend's storage (re-encrypted there on the journal backend), then the data is restored. The ZIP itself is **not encrypted** — keep it safe. CLI: `agentcrm export zip --out backup.zip`, `agentcrm import zip backup.zip --yes`. CSV exports show file names only.

## CLI, MCP & AI

```bash
agentcrm records image <recordId> ./photo.jpg          # avatar / logo (--remove, --field <imageFieldId>)
agentcrm files upload ./a.pdf ./b.png --record <id>     # or --activity <id>
agentcrm notes add <recordId> --body "…" --attach ./contract.pdf
agentcrm tasks add --title "Review" --record <dealId> --attach ./quote.xlsx
agentcrm activities add --type meeting --title "Workshop" --record <id> --attach ./board.png
agentcrm files list --record <id> [--related] [--kind image|pdf|…] [--search name]
agentcrm files get <fileId> --out ./file.pdf [--thumb]
agentcrm files delete <fileId> --yes                    # then: agentcrm compact --yes
agentcrm files usage
```

AI tools (MCP + in-admin assistant): `list_files` and `describe_attachments` — **metadata only** (names, types, sizes, dimensions, what each file is attached to, inline images). There is deliberately no tool that fetches a URL into the CRM, and file contents are never sent to a model.

## Engine (for developers)

- `src/data/files/` — `FileStore { put, putMany?, get, delete, list? }` per backend, exposed as `DataStore.files` (`fileStoreOf(store)`).
- `src/ops/files.ts` — `uploadFile`, `attachFile`, `detachFile`, `listFiles(ctx, target, { includeActivities, includeRelated, kind, search })`, `getFile`, `getFileBytes`, `renameFile`, `deleteFile`, `restoreFile`, `purgeFiles`, `setRecordImage`, `clearRecordImage`, `fileUsage`; `src/ops/fileRefs.ts` keeps targets in sync on hard delete / merge; `src/ops/backup.ts` (ZIP); `src/ops/migrate.ts` adds the image fields to workspaces created before 0.3.0 (on boot for admins, and in writing CLI sessions).
- `src/components/ui/files/` — `useFileUrl(id, { thumb })` (blob URL cache with revoke), image processing, attachments, lightbox, uploads (drop zone, paste, picker, pending list), `RecordAvatar`, crop modal, `image` / `files` field renderers.
