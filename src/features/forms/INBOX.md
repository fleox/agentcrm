# Lead form inboxes

An AgentCRM lead form is a **static page** (or an embed snippet) that sends
each submission straight from the visitor's browser to an **inbox you own**.
There is no AgentCRM server. The admin, while it is open, or the
`agentcrm forms ingest --yes` CLI (from a cron or GitHub Action) reads the
inbox, creates or updates the records, logs a "Form submission" note, fires
the `record.created` automations and removes the processed submissions.

| Inbox | Where submissions go | Who reads them |
|---|---|---|
| S3 bucket | `PUT <uploadUrl><formId>/<timestamp>-<random>.json` | the admin with the hosting (or data) credentials; the CLI with its credentials |
| Firestore | a document in the `inbox` collection: `{ formId, data, createdAt }` | the signed-in admin through the Firestore REST API |
| Webhook | `POST` to your Formspree / Web3Forms / Make / Zapier / n8n URL | your service: submissions do not come back to the CRM |

Every submission is JSON:

```json
{
  "formId": "01J…",
  "data": { "firstName": "Ada", "email": "ada@example.com" },
  "createdAt": 1718445600000,
  "meta": { "page": "https://example.com/contact", "referrer": "", "elapsedMs": 8123, "lang": "en-US" }
}
```

## Anti-spam

- **Honeypot**: a hidden `_hp` input. Bots fill it, people never see it. The page
  then pretends to succeed and sends nothing, and ingestion drops any
  submission that has it set anyway.
- **Minimum fill time**: a submission sent less than 2.5 s after the page
  loaded is refused with a "take a second" message.
- **Ingestion**: only the form's own fields are kept, required fields are
  checked, values are validated by the record engine, and duplicates are
  merged on the email.

Spam that gets through ends up in your inbox prefix only. It can never reach
your data without going through ingestion.

## S3 inbox (AWS S3, Cloudflare R2, OVHcloud, Scaleway, MinIO…)

Use a dedicated prefix, `inbox/` by default, in the bucket that hosts the
admin or in a separate one. Visitors may **only create objects under that
prefix**: no read, no list, no delete.

### 1. Bucket policy (AWS S3)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AgentCrmLeadInboxWriteOnly",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::YOUR-BUCKET/inbox/*"
    }
  ]
}
```

On AWS, "Block public access" must allow bucket policies. Turn off
*Block public access to buckets and objects granted through new public bucket
or access point policies*. Keep the ACL blocks on.

The statement grants `PutObject` only. Anonymous visitors can't list or read
the inbox, so one submitter can't see another's data. They also can't
overwrite the admin: the `Resource` is limited to `inbox/*`.

Optional hardening:

- add a `Condition` `{"StringEquals": {"s3:x-amz-server-side-encryption": "AES256"}}`
  only if you also make the page send that header (not done by default);
- add a lifecycle rule that expires `inbox/` and `inbox-failed/` objects after
  30 days, in case ingestion stops running;
- add an S3 Object Lambda or AWS WAF rate limit if you get flooded.

On other providers:

- **Cloudflare R2** has no anonymous PutObject. Use a Worker or a
  presigned-URL service, or the Firebase / webhook inbox instead.
- **OVHcloud and Scaleway** accept the same policy JSON (Scaleway:
  `"Principal": "*"`, `"Action": ["s3:PutObject"]`, `"Resource": ["YOUR-BUCKET/inbox/*"]`).
- **MinIO**: `mc anonymous set-json policy.json alias/YOUR-BUCKET`.

### 2. CORS

The page sends `PUT` with `Content-Type: application/json`, which triggers a
CORS preflight. Allow your website origins, plus the admin origin if you
host the admin elsewhere. The admin also needs GET, DELETE and LIST for
ingestion with its signed credentials:

```json
[
  {
    "AllowedOrigins": ["https://www.example.com", "https://example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  },
  {
    "AllowedOrigins": ["https://admin.example.com"],
    "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
    "AllowedHeaders": ["authorization", "content-type", "cache-control", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

If you embed the form on many sites, `"AllowedOrigins": ["*"]` in the first
rule is acceptable: the rule only lets browsers PUT into the write-only prefix.

### 3. In the form builder

- **Public upload URL**: `https://YOUR-BUCKET.s3.YOUR-REGION.amazonaws.com/inbox/`
  (virtual-hosted style), or `https://ENDPOINT/YOUR-BUCKET/inbox/` (path style:
  OVHcloud, MinIO…).
- **Inbox prefix**: `inbox/`, the same prefix as a path inside the bucket
  (relative to the connector's own prefix, if it has one).
- **Read with**: *Hosting credentials* when the bucket is the admin's hosting
  target (Settings, then Hosting). *Data storage credentials* when it is the
  bucket of the encrypted journal backend. These credentials need `GetObject`,
  `PutObject`, `DeleteObject` and `ListBucket` on the bucket. They stay in the
  browser (or in the CLI credentials file) and are never in the page.

Invalid submissions are moved to `inbox-failed/` with an `_error` field, so
they are not retried forever. Delete them when you have looked at them.

## Firestore inbox

When the CRM uses the Firebase backend, the default inbox is the `inbox`
collection of the same project. The page calls the Firestore REST API with
the **public web API key** and no Firebase SDK:

```
POST https://firestore.googleapis.com/v1/projects/PROJECT/databases/(default)/documents/inbox?key=API_KEY
{ "fields": { "formId": {"stringValue": "…"}, "data": {"mapValue": {…}}, "createdAt": {"integerValue": "1718445600000"} } }
```

`createdAt` is epoch milliseconds (an integer), like every date in AgentCRM.
The security rules generated by `ops/firebaseRules.ts` (see `docs/firebase.md`)
must allow **public create only**, with a shape check, and admin read and
delete:

```
match /inbox/{id} {
  allow create: if request.resource.data.keys().hasOnly(["formId", "data", "createdAt"])
    && request.resource.data.formId is string
    && request.resource.data.data is map
    && request.resource.data.createdAt is int
    && request.resource.data.size() <= 3;
  allow read, delete: if isAdmin() || isMember();
  allow update: if isAdmin() || isMember(); // marks failed submissions {status, error}
}
```

The admin reads the inbox with your signed-in Firebase ID token. If an update
is refused, invalid submissions are deleted instead.

## Webhook inbox

Any endpoint that accepts a cross-origin `POST` works:

- **Formspree**: `https://formspree.io/f/<id>`, format JSON.
- **Web3Forms**: `https://api.web3forms.com/submit`, extra fields
  `{"access_key": "<your public access key>"}`.
- **Make, Zapier, n8n**: a "catch hook" URL. Choose **Form-encoded** if the
  service doesn't answer the CORS preflight that a JSON body triggers.

The payload is flat:

```json
{ "firstName": "…", "email": "…", "_formId": "…", "_submittedAt": "ISO date", "_page": "https://…" }
```

plus your extra fields.

Submissions stay in that service, and `ingest` skips webhook forms. To bring
them back into the CRM, have your scenario write the same JSON to an S3
inbox, or call `agentcrm` from it (`records create`, or the `create_record`
MCP tool).

## Publishing

**Publish** uploads `forms/<name>/index.html` (or the path you chose) through
the admin's hosting connector: GitHub, GitLab or Cloudflare Pages, S3, a local
folder. **Embed code** gives a `<form>` + `<script>` snippet with scoped styles,
for any CMS HTML block. **Download HTML** gives the standalone page to host
anywhere.
