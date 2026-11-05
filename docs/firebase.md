# Firebase backend

AgentCRM can keep its data in **Cloud Firestore** with **Firebase Auth**
accounts, in a Firebase project that belongs to you. Nothing runs on an
AgentCRM server: the admin (and the `agentcrm` CLI) talk to Firestore
directly, and the **Firestore security rules** are the real access control.

Choose Firebase when several people work in the CRM at once and you want real
accounts and roles (admin / member / viewer), live updates and nothing to
host except the static admin.

Code: `src/data/firebase.ts` (store), `src/data/firebase/` (SDK adapter,
in-memory fake for tests), `src/ops/firebaseRules.ts` (rules generator).

## 1. Create the project

1. Open <https://console.firebase.google.com> → **Add project**. Google
   Analytics is not needed.
2. **Project settings → General → Your apps → Web (`</>`)**. Register an app
   (no Hosting needed). Copy the `firebaseConfig` snippet. It is **public**
   (it identifies the project, it grants nothing) and ends up in `config.js`.
3. **Build → Firestore Database → Create database**. Use production mode and
   pick a region close to your users. The region can't be changed later.

## 2. Authentication

**Build → Authentication → Get started**, then:

- **Sign-in method**: enable **Email/Password**. Also enable **Google** if
  you want "Continue with Google" (pick it in the setup wizard as well).
- **Users → Add user**: create the **admin account** with the email you will
  pin as bootstrap admin, and a strong password.
- **Settings → Authorized domains**: add the domain that serves the admin
  (`my-company.github.io`, `crm.example.com`…). `localhost` is there by
  default for `npm run dev`. Google sign-in fails on unlisted domains.

**Email verification.** The rules only accept a **verified** address.
Google accounts are verified by Google. A password account created in the
console is **not** verified: on the first sign-in AgentCRM sends a
verification email. Open the link, then click **Sign in & verify** again (in
the wizard) or **I've verified it** (on the login screen).

Why it matters: when Email/Password is enabled, anyone can create a password
account *with any address* from the browser. Without the verified check,
someone could register an invited address before its owner and take the
invitation.

## 3. Security rules

The setup wizard generates the rules from the admin email and the sign-up
mode. You can also copy them later from **Settings → Data backend → Firestore
security rules**, or build them in code:

```ts
import { buildFirestoreRules } from "./src/ops/firebaseRules";
buildFirestoreRules({ adminEmail: "you@example.com", signup: "invite" });
```

Paste them in **Firestore Database → Rules → Publish** before you finish the
wizard. You can also deploy them with the Firebase CLI using the three files
the wizard offers for download (`firestore.rules`, `firestore.indexes.json`,
`firebase.json`):

```bash
npm i -g firebase-tools && firebase login
firebase use <project-id>
firebase deploy --only firestore
```

### What the rules enforce

| | admin | member | viewer | not invited / disabled |
|---|---|---|---|---|
| Read the CRM (every collection) | ✓ | ✓ | ✓ | ✗ |
| Records, activities (notes, tasks, calls, emails, meetings) | CRUD | CRUD | — | ✗ |
| Views | all | own private views (`ownerId` = self, `shared: false`) | — | ✗ |
| Automations | edit | stamp `lastRunAt` when running them | — | ✗ |
| Automation runs | all | create / update | — | ✗ |
| Objects & fields, pipelines, forms, settings, config | write | — | — | ✗ |
| Users | write (roles, disable) | own `name` / `avatarUrl` / `prefs` only | own `name` / `avatarUrl` / `prefs` only | ✗ |
| Invitations (`invites/{email}`) | write | — | — | read own |
| Lead inbox (`inbox/{id}`) | read / delete / mark | read / delete / mark | — | **create only** (anyone) |
| Tombstones (`deletions/{id}`, written with each delete) | write / purge | write | — | ✗ |
| Anything else | ✗ | ✗ | ✗ | ✗ |

- **Roles** live in `users/{uid}.role`. A user with `disabled: true` loses all
  access. Nobody can change their own `role`, `email` or `disabled` flag.
- **Bootstrap admin**: the email pinned in `bootstrapAdminEmail()` is always
  admin (verified address required). That is how the first admin exists
  before any user record. It keeps the email out of the public `config.js`.
- **Joining**, on the first sign-in of an account, in order:
  1. AgentCRM tries to create `users/{uid}` as **admin**. Only the bootstrap
     admin is accepted.
  2. Else, with the role of an **invitation**. An admin adds the person in
     **Settings → Users**, and AgentCRM mirrors that into `invites/{email}`.
  3. Else, as **member**, if the sign-up mode allows it.

  Otherwise the person sees "No access to this CRM". Once someone joins, an
  admin's browser folds the placeholder user into the real account
  (assignments and owners are rewritten).
- **Sign-up modes**: `invite` (default: invited people only), `domain`
  (verified addresses of the listed domains join as members), `open` (any
  account joins as member: **don't**, your CRM would be readable by anyone
  with a Google account).
- **Inbox**: anyone may **create** a lead-form submission
  `{ formId, data, createdAt, meta? }`. `formId` must be an existing form,
  `data` holds at most 60 fields, `meta` at most 10 keys, and `createdAt` is
  an integer of epoch ms within ±24 h of the server time. Nobody outside the
  team can read it. Members ingest and delete submissions, or mark them
  `{ status, error }`. See `src/features/forms/INBOX.md`.

Re-generate and re-publish the rules whenever you change the admin email or
the sign-up mode, and when a release says so in its changelog `actions`
(0.11.0: users keep their own `prefs`; with older rules the list layouts
stay in each browser instead of following the user).

### Indexes

AgentCRM reads whole collections and filters in memory, so **no composite
index is needed**. `firestore.indexes.json` is just
`{ "indexes": [], "fieldOverrides": [] }`.

### Files: Firebase Storage + storage.rules

Photos, logos and attachments go to **Firebase Storage** (`files/<id>`),
their metadata to the Firestore collection `files` (active users read,
members create / update, admins delete — compaction). To use them:

1. Console → **Build → Storage** → *Get started*; the web config you paste in
   the wizard must contain `storageBucket`.
2. Download **storage.rules** from the wizard (next to `firestore.rules`;
   generated by `buildStorageRules()` in `src/ops/firebaseRules.ts`) and
   deploy it — `firebase.json` from the wizard references both files:

   ```bash
   firebase deploy --only firestore,storage
   ```

   The rules read the caller's role from Firestore `users/{uid}`: active users
   **read**, admins and members **write** (bounded size, path-safe ids),
   admins **delete**. The first deploy asks to let Storage read Firestore —
   accept.
3. Allow the admin's origin to download bytes (`getBytes()` needs CORS):

   ```bash
   echo '[{"origin":["https://crm.example.com"],"method":["GET"],"maxAgeSeconds":3600}]' > cors.json
   gsutil cors set cors.json gs://<your-bucket>
   ```

Without Storage the CRM works normally; uploads fail with "Firebase Storage
isn't enabled for this project…". Details: [files.md](files.md).

## 4. Run the setup wizard

Open the admin, pick **Firebase**, paste the config snippet, then enter the
admin email and password, the sign-in methods and the sign-up mode. Publish
the rules and click **Sign in & verify**. The wizard:

- signs you in and checks you are the bootstrap admin. This creates your own
  `users/{uid}` record, the only write before Install;
- detects an existing CRM in the project. You then join it instead of
  creating one;
- on **Install**, seeds the standard objects, the Sales pipeline, the
  settings and (optionally) demo data, and saves the runtime config.

## Data layout

One Firestore collection per CRM collection, with the same names: `objects`,
`records` (all objects, with an `object` field), `activities`, `pipelines`,
`views`, `automations`, `forms`, `users`, `settings`, `config`,
`automationRuns`, `extensions`, `files` (file metadata; bytes in Firebase
Storage `files/<id>`). Plus `invites` and `inbox`. The document id is the CRM id.
Dates are epoch milliseconds.

- Each user action is one write. Batches are split in chunks of 500 (the
  Firestore limit). A multi-batch write that fails halfway (very large
  imports) is re-synchronised by the live listener.
- Field edits are `update`s with dot paths (`fields.email`). Two people
  editing different fields of the same record never overwrite each other.
- Live updates use `onSnapshot` on every collection while the admin is open.

## Costs

Firestore bills every document read. Since 0.4.0 each client keeps a local
copy of the dataset (the admin in IndexedDB, the CLI in
`~/.agentcrm/cache/`, mode 0600, one per project and signed-in user):

- the first open of a browser / CLI home reads every document once;
- every later open, and every CLI command, reads only the documents written
  since the previous one: one query per collection, about 15 reads when
  nothing changed (an empty query is billed 1 read);
- live updates listen to those same queries, so they read only changes;
- once a week the copy is read in full again, to catch what tombstones
  can't see (documents deleted from the console).

How it works: every write stamps a server time (`_ts`) on the document, and
every delete leaves a tombstone in `deletions/{collection}__{id}` in the
same batch. Clients ask for `_ts > the last one they saw`. Signing out of
the admin clears that account's copy.

Check what an open cost: `agentcrm doctor --site <alias>` (CLI, check
`firestore-reads`), or `__AGENTCRM_FIRESTORE__` in the browser console.

With that, the free Spark plan (50k reads / 20k writes a day) holds a CRM of
several thousand records used by a team every day: the full read happens
once per browser per week. On Blaze, set a budget alert anyway.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Firestore refused the admin" in the wizard | Rules not published, or published with another admin email. Firestore database not created. |
| "Your email address is not verified" | Open the verification email, then retry. |
| Google popup: "unauthorized domain" | Add the admin's domain in Authentication → Settings → Authorized domains. |
| A teammate sees "No access to this CRM" | Add their email in Settings → Users (role = their role), and check sign-up mode / domains. |
| Viewer edits fail with "permission-denied" | Expected: viewers are read-only. The UI rolls the change back. |
| "Firebase Storage isn't enabled for this project" | Enable Storage, add `storageBucket` to the web config, deploy storage.rules. |
| Images don't load (CORS error in the console) | Set the bucket CORS for the admin's origin (`gsutil cors set`). |
