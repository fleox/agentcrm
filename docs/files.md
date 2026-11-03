# Images & attachments

AgentCRM stores **record images** (a person's photo, a company's logo, the image field of any custom object) and **attachments** (images, PDFs, Office documents, anything) on notes, tasks, calls, emails, meetings and records. Like the rest of the data, files go to storage **you** own — there is still no server of ours.

## What you get

- **Photo / logo** — `people.avatar` and `companies.logo` (field type `image`), shown next to the name everywhere: record header, tables, kanban cards, relation chips, the search palette. Click (or drop an image on) the avatar in the record header, adjust the square crop (zoom + drag), save; *Replace* / *Remove* from the same menu. Initials are shown when there is no image. Any object gets an avatar by adding a field of type **Image** (Settings → Data model; the first image field becomes the object's *image field*, changeable in the object settings).
- **Attachments** — the activity composer and the task editor take files from the *Attach* button, drag & drop or paste (screenshots). Pasted images are inserted inline in the Markdown body as `![name](file:<id>)`; other images can be inserted with the image button of their chip. Timeline items and task rows show image thumbnails (click → lightbox, ←/→, Esc) and document chips (icon by type, size, open in a new tab, download, delete).
- **Files tab** on every record: its own files, its image / files fields and — toggle *Include files of activities and related records* — the attachments of its activities and of linked records (a company's people and deals). Drop zone, grid / list, sort (newest, oldest, name, size), search, preview, download, delete.
- **Custom fields** of type `image` (one file) and `files` (several).

## Where the bytes live

| Backend | Bytes | Metadata |
|---|---|---|
| **Journal** (S3 / R2 / OVH bucket, git repo, local folder) | `<root>/files/<id>.bin` on the same connector, **encrypted with the dataset key** (AES-256-GCM, same format as the journal: `ACRMENC1 \| iterations \| salt \| iv \| ciphertext`); plain bytes only when the dataset itself is unencrypted | `files/<id>` documents, inside the encrypted journal like every other document |
| **This browser** (local) | IndexedDB database `agentcrm-local-files` | IndexedDB, with the rest |
| **git-json** | `files/<id>.bin` in the data folder of the repo — one commit per upload batch | `files/<id>.json` |
| **Firebase** | Firebase Storage, `files/<id>` of your project | Firestore collection `files` |

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
