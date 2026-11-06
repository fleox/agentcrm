# Firebase backend

1. Create a Firebase project (console.firebase.google.com), add a Web app and copy its config (apiKey, authDomain, projectId, appId...). The web apiKey is public by design.
2. Enable Authentication → Sign-in method → Email/Password (and Google if wanted).
3. Create Firestore (production mode) and publish the AgentCRM security rules: `npx -y @fleox-agent-crm/agentcrm@0.12.1 options --firebase-rules <admin email> --json` prints them (paste into Firestore → Rules → Publish). Re-publish them after an update whose changelog asks for it.
4. Create the first admin account (Authentication → Users → Add user) and **verify its email address** (an unverified address is refused). The user stores its login: `! npx -y @fleox-agent-crm/agentcrm@0.12.1 credentials set firebase:<name>` (email + password at hidden prompts).
5. Files (images, attachments): either enable **Firebase Storage** (add `storageBucket` to the web config, publish the generated storage.rules, set the bucket CORS), or keep the bytes outside Firebase with an **HTTP files endpoint** the user runs (below).
6. Plan:

```json
{
  "alias": "team-crm",
  "owner": { "name": "Ada", "email": "ada@acme.com" },
  "data": { "backend": "firebase", "firebase": { "apiKey": "...", "authDomain": "acme.firebaseapp.com", "projectId": "acme", "appId": "1:..." }, "credential": "firebase:acme", "signInMethods": ["password", "google"] },
  "hosting": { "type": "github-pages", "settings": { "owner": "acme", "repo": "crm" }, "credential": "github:acme" }
}
```

Roles live in Firestore (`users/{uid}`) and are enforced by the rules.

## How the CLI signs in

- Every command signs in with the stored `firebase:<name>` login and acts as that user, through the rules (it is not an admin SDK). `install --dry-run` really checks access: it signs in, refuses an unverified address and reads through the rules — fix its errors (rules not published, wrong admin email) before installing.
- The session is kept between runs in `~/.agentcrm/sessions/` (mode 0600), so commands don't sign in with the password each time (Firebase rate-limits that: `auth/quota-exceeded`). `credentials set` / `credentials remove` of that login forget its session.
- Reads are incremental: the CLI keeps a local copy in `~/.agentcrm/cache/` (0600, per project and user) and only reads what changed since the last command (about 15 reads when nothing did; a full read once a week). That keeps a team CRM of a few thousand records on the free Spark plan. `doctor` reports the reads of a load (`firestore-reads`).
- `users add` from the CLI also writes the invitation, so the person can sign in to the admin with that email (Google or a password account created in Authentication).

## HTTP files endpoint (Firebase without Firebase Storage)

For users who want the file bytes on their own storage (e.g. encrypted on their S3 bucket) while keeping Firestore + Auth: the runtime config gets `"files": { "endpoint": "<url>" }`. The admin and the CLI then `PUT` / `GET` / `DELETE <endpoint>/<id>` (and `GET <endpoint>/` for admins) with the user's Firebase ID token; no `storageBucket`, storage rules or bucket CORS are needed. The endpoint is the user's own service: it must verify the token and apply the CRM roles. Protocol and access rules: https://github.com/fleox/agentcrm/blob/master/docs/files.md

- In the hosted `config.js` the endpoint may be relative to the admin page (`"files"` next to `/crm/`).
- For the CLI, give an **absolute** URL (a relative one can't be resolved outside the browser) and update the site's runtime config — same project only:

```bash
npx -y @fleox-agent-crm/agentcrm@0.12.1 site show team-crm --json
npx -y @fleox-agent-crm/agentcrm@0.12.1 site runtime team-crm --runtime @runtime.json --json
```

`runtime.json` = the `runtime` object of `site show` plus `"files": { "endpoint": "https://crm.acme.com/crm/files" }`. Then download one existing file (`files list --record <id>`, then `files get <fileId> --out /tmp/check.bin`) to prove the endpoint answers the CLI.
