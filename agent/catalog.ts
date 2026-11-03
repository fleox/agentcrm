// What `agentcrm options` tells an agent: where the data can live, where
// the admin can be hosted, and every field an install plan needs. Ask the
// user about the DATA first (it holds personal data), then the hosting.

export interface FieldSpec {
  key: string;
  required: boolean;
  description: string;
  example?: string;
  default?: string | boolean;
}

export interface BackendSpec {
  id: "journal" | "git-json" | "firebase" | "local";
  summary: string;
  goodFor: string;
  cli: boolean;
  fields: FieldSpec[];
  credentialTypes: string[];
  notes: string[];
}

export interface LocationSpec {
  id: "s3" | "github" | "gitlab" | "local-folder";
  connectorId: string;
  summary: string;
  fields: FieldSpec[];
  credentialTypes: string[];
  notes: string[];
}

export interface HostingSpec {
  id: "s3" | "github-pages" | "gitlab-pages" | "cloudflare-pages" | "local-folder" | "zip";
  connectorId: string;
  summary: string;
  cli: boolean;
  fields: FieldSpec[];
  credentialTypes: string[];
  notes: string[];
}

export const DATA_BACKENDS: BackendSpec[] = [
  {
    id: "journal",
    summary: "Encrypted files (snapshot + append-only journal) on storage you own: an S3-compatible bucket, a private GitHub / GitLab repo, or a folder of this computer.",
    goodFor: "Default. Personal data stays encrypted (AES-256-GCM) on your own storage; several users / computers work at the same time without conflicts.",
    cli: true,
    fields: [
      { key: "location", required: true, description: "Where the files live: { type, settings, credential } — see `locations`." },
      { key: "root", required: false, description: "Folder of the dataset on the location.", default: "agentcrm" },
      {
        key: "encryption",
        required: false,
        description: 'Default: encrypted with a passphrase generated at install and stored as passphrase:<alias>. { "credential": "passphrase:<name>" } uses an existing one; false stores plain JSON (not recommended: personal data).',
      },
    ],
    credentialTypes: ["s3", "github", "gitlab", "passphrase"],
    notes: [
      "Losing the passphrase means losing the data: right after install the user saves it in a password manager (`agentcrm credentials copy passphrase:<alias>`).",
      "No login screen: anyone with the storage keys and the passphrase can open the CRM; each browser asks for them once.",
      "`agentcrm compact` rewrites the snapshot and physically purges deleted records (GDPR erasure).",
    ],
  },
  {
    id: "git-json",
    summary: "One JSON file per record in a PRIVATE GitHub / GitLab repository; every change is a commit.",
    goodFor: "Small teams who want a readable history; each user signs in with their own token (repo permission = role).",
    cli: true,
    fields: [
      { key: "git.provider", required: true, description: "github | gitlab", example: "github" },
      { key: "git.owner", required: false, description: "GitHub user or organisation (github).", example: "acme" },
      { key: "git.repo", required: false, description: "GitHub repository (github), private.", example: "acme-crm-data" },
      { key: "git.project", required: false, description: "GitLab project path (gitlab).", example: "acme/crm-data" },
      { key: "git.branch", required: false, description: "Branch.", default: "main" },
      { key: "git.dir", required: false, description: 'Folder inside the repo ("" = root).', default: "" },
      { key: "credential", required: true, description: "github:<name> / gitlab:<name> token account." },
    ],
    credentialTypes: ["github", "gitlab"],
    notes: ["Git history keeps every past value: deleting a record does not erase it from the history (warn the user about personal data)."],
  },
  {
    id: "firebase",
    summary: "Firestore + Firebase Auth in the user's own Firebase project.",
    goodFor: "Real-time teams with email / Google logins and per-user roles enforced by Firestore rules.",
    cli: true,
    fields: [
      { key: "firebase", required: true, description: "The web app config (apiKey, authDomain, projectId, appId…) from Firebase console → Project settings → Your apps." },
      { key: "credential", required: true, description: "firebase:<name> — email + password of the first admin (Authentication → Users)." },
      { key: "signInMethods", required: false, description: 'Login buttons: ["password"] (default) and/or "google".' },
    ],
    credentialTypes: ["firebase"],
    notes: ["Publish the security rules first (see docs/firebase.md)."],
  },
  {
    id: "local",
    summary: "This browser only (IndexedDB), single user, no login.",
    goodFor: "Trying AgentCRM. Not reachable from the CLI.",
    cli: false,
    fields: [],
    credentialTypes: [],
    notes: ["Use `agentcrm serve` and pick “This browser” in the setup wizard."],
  },
];

export const LOCATIONS: LocationSpec[] = [
  {
    id: "s3",
    connectorId: "s3",
    summary: "Any S3-compatible bucket (AWS S3, Cloudflare R2, OVHcloud, Scaleway, Backblaze B2, MinIO). Use a PRIVATE bucket.",
    fields: [
      { key: "endpoint", required: false, description: "S3 API endpoint (omit for AWS).", example: "https://s3.gra.io.cloud.ovh.net" },
      { key: "region", required: true, description: "Region.", example: "eu-west-3" },
      { key: "bucket", required: true, description: "Bucket name.", example: "acme-crm-data" },
      { key: "prefix", required: false, description: "Key prefix inside the bucket.", default: "" },
      { key: "forcePathStyle", required: false, description: "Path-style URLs (default: on outside AWS)." },
    ],
    credentialTypes: ["s3"],
    notes: ["The bucket needs a CORS rule for the admin's origin (GET, PUT, DELETE, HEAD; headers authorization, content-type, x-amz-*): `agentcrm doctor` prints it."],
  },
  {
    id: "github",
    connectorId: "git-pages",
    summary: "A PRIVATE GitHub repository (files committed with [skip ci], never published).",
    fields: [
      { key: "owner", required: true, description: "User or organisation.", example: "acme" },
      { key: "repo", required: true, description: "Private repository.", example: "acme-crm-data" },
      { key: "branch", required: false, description: "Branch.", default: "main" },
      { key: "apiBaseUrl", required: false, description: "GitHub Enterprise API URL." },
    ],
    credentialTypes: ["github"],
    notes: ["One commit per write: fine for small teams; a bucket is faster."],
  },
  {
    id: "gitlab",
    connectorId: "git-pages",
    summary: "A PRIVATE GitLab project.",
    fields: [
      { key: "project", required: true, description: "Project path.", example: "acme/crm-data" },
      { key: "branch", required: false, description: "Branch.", default: "main" },
      { key: "apiBaseUrl", required: false, description: "Self-hosted GitLab API URL." },
    ],
    credentialTypes: ["gitlab"],
    notes: [],
  },
  {
    id: "local-folder",
    connectorId: "local-folder",
    summary: "A folder on this computer (absolute path). The browser admin opens the same folder with its folder picker (Chrome / Edge).",
    fields: [{ key: "path", required: true, description: "Absolute folder path (created if missing).", example: "/Users/me/Documents/acme-crm" }],
    credentialTypes: [],
    notes: ["Back the folder up (or put it in a synced drive): it is the only copy."],
  },
];

export const HOSTINGS: HostingSpec[] = [
  {
    id: "s3",
    connectorId: "s3",
    summary: "An S3-compatible bucket with static website hosting (or a CDN in front).",
    cli: true,
    fields: [
      { key: "endpoint", required: false, description: "S3 API endpoint (omit for AWS)." },
      { key: "region", required: true, description: "Region." },
      { key: "bucket", required: true, description: "Bucket serving the admin." },
      { key: "prefix", required: false, description: "Key prefix.", default: "" },
      { key: "siteUrl", required: true, description: "Public HTTPS URL of the bucket / CDN root.", example: "https://crm.acme.com" },
      { key: "publicRead", required: false, description: "Send x-amz-acl: public-read (OVH / Scaleway buckets without a bucket policy)." },
    ],
    credentialTypes: ["s3"],
    notes: ["Use HTTPS: the admin signs storage requests with WebCrypto, which browsers only allow on secure pages."],
  },
  {
    id: "github-pages",
    connectorId: "git-pages",
    summary: "GitHub Pages (a public repo on free plans).",
    cli: true,
    fields: [
      { key: "owner", required: true, description: "User or organisation." },
      { key: "repo", required: true, description: "Repository served by Pages." },
      { key: "branch", required: false, description: "Branch.", default: "main" },
      { key: "dir", required: false, description: "Folder served (\"\" or docs).", default: "" },
      { key: "siteUrl", required: false, description: "Pages URL.", default: "https://<owner>.github.io/<repo>" },
    ],
    credentialTypes: ["github"],
    notes: ["The admin holds no data: a public repo only exposes the app code and config.js (no secrets)."],
  },
  {
    id: "gitlab-pages",
    connectorId: "git-pages",
    summary: "GitLab Pages (a .gitlab-ci.yml is added when missing).",
    cli: true,
    fields: [
      { key: "project", required: true, description: "Project path." },
      { key: "branch", required: false, description: "Branch.", default: "main" },
      { key: "dir", required: false, description: "Folder published.", default: "public" },
      { key: "siteUrl", required: true, description: "Pages URL." },
    ],
    credentialTypes: ["gitlab"],
    notes: [],
  },
  {
    id: "cloudflare-pages",
    connectorId: "git-pages",
    summary: "Cloudflare Pages connected to a GitHub / GitLab repo (works with private repos on the free plan).",
    cli: true,
    fields: [
      { key: "provider", required: false, description: "github | gitlab", default: "github" },
      { key: "owner", required: false, description: "GitHub owner." },
      { key: "repo", required: false, description: "GitHub repo." },
      { key: "project", required: false, description: "GitLab project." },
      { key: "branch", required: false, description: "Branch.", default: "main" },
      { key: "siteUrl", required: true, description: "The *.pages.dev or custom domain URL." },
    ],
    credentialTypes: ["github", "gitlab"],
    notes: ["Create the Pages project in the Cloudflare dashboard (no build command, output directory = the repo root)."],
  },
  {
    id: "local-folder",
    connectorId: "local-folder",
    summary: "A folder on this computer (serve it with `agentcrm serve` or any static server).",
    cli: true,
    fields: [
      { key: "path", required: true, description: "Absolute folder path." },
      { key: "siteUrl", required: false, description: "URL the folder is served at, if any.", example: "http://localhost:4173" },
    ],
    credentialTypes: [],
    notes: [],
  },
  {
    id: "zip",
    connectorId: "browser-mirror",
    summary: "Download the admin as a ZIP and upload it anywhere by hand.",
    cli: false,
    fields: [],
    credentialTypes: [],
    notes: ["Setup wizard only (`agentcrm serve`). From the CLI, use `hosting: false` and copy dist/admin yourself."],
  },
];

export function findBackend(id: string): BackendSpec | undefined {
  return DATA_BACKENDS.find((b) => b.id === id);
}

export function findLocation(id: string): LocationSpec | undefined {
  return LOCATIONS.find((l) => l.id === id);
}

export function findHosting(id: string): HostingSpec | undefined {
  return HOSTINGS.find((h) => h.id === id);
}
