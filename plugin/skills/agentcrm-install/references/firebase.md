# Firebase backend

1. Create a Firebase project (console.firebase.google.com), add a Web app and copy its config (apiKey, authDomain, projectId, appId...). The web apiKey is public by design.
2. Enable Authentication → Sign-in method → Email/Password (and Google if wanted).
3. Create Firestore (production mode) and publish the AgentCRM security rules (see docs/firebase.md in the repository).
4. Create the first admin account (Authentication → Users → Add user). The user stores its login: `! npx -y @fleox-agent-crm/agentcrm@0.9.2 credentials set firebase:<name>` (email + password at hidden prompts).
5. Plan:

```json
{
  "alias": "team-crm",
  "owner": { "name": "Ada", "email": "ada@acme.com" },
  "data": { "backend": "firebase", "firebase": { "apiKey": "...", "authDomain": "acme.firebaseapp.com", "projectId": "acme", "appId": "1:..." }, "credential": "firebase:acme", "signInMethods": ["password", "google"] },
  "hosting": { "type": "github-pages", "settings": { "owner": "acme", "repo": "crm" }, "credential": "github:acme" }
}
```

Roles live in Firestore (`users/{uid}`) and are enforced by the rules.
