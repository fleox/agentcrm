// Firestore security rules for the Firebase backend (src/data/firebase.ts).
// Pure: the setup wizard shows / copies the output, `agentcrm` can print
// it, docs/firebase.md explains it. The rules are the ONLY real access
// control in Firebase mode (the admin's checks are UX):
//
//   admin   everything (schema, pipelines, settings, config, users, forms…)
//   member  CRUD records / activities, own (non-shared) views, run
//           automations (lastRunAt), ingest the lead inbox
//   viewer  read only
//
//   - role = users/{uid}.role; disabled users have no access;
//   - the bootstrap admin is the email pinned below (verified address);
//   - first sign-in creates users/{uid}: as admin (bootstrap only), with
//     the role of an invitation (invites/{email}, written by admins), or
//     as member when sign-up is "open" / matches an allowed domain;
//   - nobody can change their own role / email / disabled flag;
//   - inbox/{id}: anyone (the public lead form) may CREATE a submission
//     of a strict shape and bounded size; only members read / delete it
//     and may mark it {status, error}.

import { COLLECTIONS, type CollectionName } from "../data/types";

export type FirebaseSignup = "invite" | "open" | "domain";

export interface FirestoreRulesOptions {
  // Bootstrap admin (the account that runs the setup).
  adminEmail: string;
  // Who may join without an invitation (default "invite": nobody).
  signup?: FirebaseSignup;
  // signup "domain": verified addresses of these domains join as members.
  allowedDomains?: string[];
  // Require a verified address (Google sign-ins are verified; password
  // accounts after the verification email). Default true — turning it
  // off lets anyone who creates a password account with an invited
  // address take that invitation.
  requireVerifiedEmail?: boolean;
}

// Public lead-form submissions (inbox collection), format shared with
// src/ops/forms.ts (see src/features/forms/INBOX.md):
//   { formId: string, data: map, createdAt: int (epoch ms), meta?: map }
// The rules bound the shape and sizes; ingestion validates the values.
export const INBOX_LIMITS = {
  maxFields: 60,
  maxMetaKeys: 10,
  formIdPattern: "^[A-Za-z0-9_-]{1,64}$",
  // Accepted clock skew of `createdAt` vs the server (visitors' clocks).
  clockSkewMs: 86_400_000,
} as const;

export interface InboxSubmission {
  formId: string;
  data: Record<string, unknown>;
  createdAt: number;
  meta?: Record<string, unknown>;
}

export function buildInboxSubmission(formId: string, data: Record<string, unknown>, extra: { meta?: Record<string, unknown>; now?: number } = {}): InboxSubmission {
  if (!new RegExp(INBOX_LIMITS.formIdPattern).test(formId)) throw new Error(`Invalid form id "${formId}".`);
  if (Object.keys(data).length > INBOX_LIMITS.maxFields) throw new Error(`Too many fields (> ${INBOX_LIMITS.maxFields}).`);
  const meta = extra.meta && Object.keys(extra.meta).length ? extra.meta : undefined;
  if (meta && Object.keys(meta).length > INBOX_LIMITS.maxMetaKeys) throw new Error("Too many meta keys.");
  return { formId, data, createdAt: Math.round(extra.now ?? Date.now()), ...(meta ? { meta } : {}) };
}

export function parseInboxSubmission(doc: Record<string, unknown>): InboxSubmission | null {
  if (typeof doc.formId !== "string" || !doc.data || typeof doc.data !== "object" || Array.isArray(doc.data)) return null;
  return {
    formId: doc.formId,
    data: doc.data as Record<string, unknown>,
    createdAt: typeof doc.createdAt === "number" ? doc.createdAt : 0,
    ...(doc.meta && typeof doc.meta === "object" ? { meta: doc.meta as Record<string, unknown> } : {}),
  };
}

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function normalizeRulesOptions(opts: FirestoreRulesOptions): Required<FirestoreRulesOptions> {
  const adminEmail = opts.adminEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(adminEmail)) throw new Error(`"${opts.adminEmail}" is not a valid admin email for the rules.`);
  const allowedDomains = (opts.allowedDomains ?? []).map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  for (const d of allowedDomains) if (!DOMAIN_RE.test(d)) throw new Error(`"${d}" is not a valid domain.`);
  const signup = opts.signup ?? (allowedDomains.length ? "domain" : "invite");
  if (signup === "domain" && !allowedDomains.length) throw new Error('Sign-up "domain" needs at least one allowed domain.');
  return { adminEmail, signup, allowedDomains, requireVerifiedEmail: opts.requireVerifiedEmail !== false };
}

// Collections only admins write; everyone active reads.
const ADMIN_WRITE: CollectionName[] = ["objects", "pipelines", "forms", "settings", "config"];
// Collections members (and admins) fully manage.
const MEMBER_WRITE: CollectionName[] = ["records", "activities"];

export function buildFirestoreRules(input: FirestoreRulesOptions): string {
  const o = normalizeRulesOptions(input);
  const verified = o.requireVerifiedEmail ? " && request.auth.token.email_verified == true" : "";
  const signupRule =
    o.signup === "open"
      ? "true"
      : o.signup === "domain"
        ? `callerEmail().matches('^[^@]+@(${o.allowedDomains.map((d) => d.replace(/\./g, "[.]")).join("|")})$')`
        : "false";
  const lines = [
    "rules_version = '2';",
    "",
    "// Generated by AgentCRM (src/ops/firebaseRules.ts) — see docs/firebase.md.",
    `// Sign-up: ${o.signup}${o.signup === "domain" ? ` (${o.allowedDomains.join(", ")})` : ""}. Re-generate rather than edit by hand.`,
    "service cloud.firestore {",
    "  match /databases/{database}/documents {",
    "",
    "    // ─── Identity & roles ─────────────────────────────────────────────",
    "    function bootstrapAdminEmail() {",
    `      return "${o.adminEmail}";`,
    "    }",
    "",
    "    function signedIn() {",
    "      return request.auth != null;",
    "    }",
    "",
    "    function hasEmail() {",
    `      return signedIn() && request.auth.token.email != null${verified};`,
    "    }",
    "",
    "    function callerEmail() {",
    "      return request.auth.token.email.lower();",
    "    }",
    "",
    "    function isBootstrapAdmin() {",
    "      return hasEmail() && callerEmail() == bootstrapAdminEmail();",
    "    }",
    "",
    "    function selfPath() {",
    "      return /databases/$(database)/documents/users/$(request.auth.uid);",
    "    }",
    "",
    "    // admin | member | viewer | none (no record / disabled).",
    "    function role() {",
    "      return isBootstrapAdmin() ? 'admin'",
    "        : !exists(selfPath()) ? 'none'",
    "        : get(selfPath()).data.get('disabled', false) == true ? 'none'",
    "        : get(selfPath()).data.get('role', 'none');",
    "    }",
    "",
    "    function isAdmin() {",
    "      return signedIn() && role() == 'admin';",
    "    }",
    "",
    "    function isMember() {",
    "      return signedIn() && role() in ['admin', 'member'];",
    "    }",
    "",
    "    function isActive() {",
    "      return signedIn() && role() in ['admin', 'member', 'viewer'];",
    "    }",
    "",
    "    function validRole(r) {",
    "      return r in ['admin', 'member', 'viewer'];",
    "    }",
    "",
    "    // ─── invites/{email} ──────────────────────────────────────────────",
    "    // Mirrored by the admin from the users it adds (Settings → Users).",
    "    function invitePath() {",
    "      return /databases/$(database)/documents/invites/$(callerEmail());",
    "    }",
    "",
    "    match /invites/{email} {",
    "      allow read: if isAdmin() || (hasEmail() && callerEmail() == email);",
    "      allow create, update: if isAdmin() && email == email.lower()",
    "        && validRole(request.resource.data.role);",
    "      allow delete: if isAdmin();",
    "    }",
    "",
    "    // ─── users/{uid} ──────────────────────────────────────────────────",
    "    function signupAllowed() {",
    `      return ${signupRule};`,
    "    }",
    "",
    "    // First sign-in: the caller creates its own record.",
    "    function selfCreate(uid) {",
    "      let d = request.resource.data;",
    "      return hasEmail() && request.auth.uid == uid",
    "        && d.email == callerEmail()",
    "        && d.get('authUid', '') == uid",
    "        && d.get('disabled', false) == false",
    "        && (",
    "          (isBootstrapAdmin() && d.role == 'admin')",
    "          || (exists(invitePath()) && d.role == get(invitePath()).data.role",
    "              && d.get('replaces', get(invitePath()).data.get('userId', '')) == get(invitePath()).data.get('userId', ''))",
    "          || (!exists(invitePath()) && signupAllowed() && d.role == 'member' && !('replaces' in d))",
    "        );",
    "    }",
    "",
    "    match /users/{uid} {",
    "      allow read: if isActive() || (signedIn() && request.auth.uid == uid);",
    "      allow create: if (isAdmin() && validRole(request.resource.data.role)) || selfCreate(uid);",
    "      // Nobody changes their own role / email / disabled flag.",
    "      allow update: if (isAdmin() && validRole(request.resource.data.role))",
    "        || (isActive() && request.auth.uid == uid",
    "            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name', 'avatarUrl', 'updatedAt']));",
    "      allow delete: if isAdmin();",
    "    }",
    "",
    "    // ─── CRM data ─────────────────────────────────────────────────────",
  ];
  for (const c of MEMBER_WRITE) {
    lines.push(`    match /${c}/{id} {`, "      allow read: if isActive();", "      allow create, update, delete: if isMember();", "    }", "");
  }
  lines.push(
    "    // Views: members manage their own private views; shared views are admin-only.",
    "    match /views/{id} {",
    "      allow read: if isActive();",
    "      allow create: if isAdmin()",
    "        || (isMember() && request.resource.data.get('ownerId', '') == request.auth.uid",
    "            && request.resource.data.get('shared', false) == false);",
    "      allow update: if isAdmin()",
    "        || (isMember() && resource.data.get('ownerId', '') == request.auth.uid",
    "            && request.resource.data.get('ownerId', '') == request.auth.uid",
    "            && request.resource.data.get('shared', false) == false);",
    "      allow delete: if isAdmin() || (isMember() && resource.data.get('ownerId', '') == request.auth.uid);",
    "    }",
    "",
    "    // Automations: admins edit; members running them may stamp lastRunAt.",
    "    match /automations/{id} {",
    "      allow read: if isActive();",
    "      allow create, delete: if isAdmin();",
    "      allow update: if isAdmin()",
    "        || (isMember() && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['lastRunAt', 'updatedAt']));",
    "    }",
    "",
    "    match /automationRuns/{id} {",
    "      allow read: if isActive();",
    "      allow create, update: if isMember();",
    "      allow delete: if isAdmin();",
    "    }",
    "",
  );
  for (const c of ADMIN_WRITE) {
    lines.push(`    match /${c}/{id} {`, "      allow read: if isActive();", "      allow write: if isAdmin();", "    }", "");
  }
  lines.push(
    "    // ─── inbox/{id}: public lead-form submissions ──────────────────────",
    "    function validSubmission(d) {",
    "      return d.keys().hasAll(['formId', 'data', 'createdAt'])",
    "        && d.keys().hasOnly(['formId', 'data', 'createdAt', 'meta'])",
    `        && d.formId is string && d.formId.matches('${INBOX_LIMITS.formIdPattern}')`,
    "        && exists(/databases/$(database)/documents/forms/$(d.formId))",
    `        && d.data is map && d.data.size() <= ${INBOX_LIMITS.maxFields}`,
    `        && (!('meta' in d) || (d.meta is map && d.meta.size() <= ${INBOX_LIMITS.maxMetaKeys}))`,
    "        && d.createdAt is int",
    `        && d.createdAt > request.time.toMillis() - ${INBOX_LIMITS.clockSkewMs}`,
    `        && d.createdAt < request.time.toMillis() + ${INBOX_LIMITS.clockSkewMs};`,
    "    }",
    "",
    "    match /inbox/{id} {",
    "      // Public: anyone (the static lead form) may create, nobody else reads.",
    "      allow create: if validSubmission(request.resource.data);",
    "      // Ingested (then deleted) by members — the admin or the CLI.",
    "      allow read, delete: if isMember();",
    "      // Failed submissions are only marked {status, error}.",
    "      allow update: if isMember()",
    "        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'error']);",
    "    }",
    "",
    "    // Anything else: closed.",
    "    match /{document=**} {",
    "      allow read, write: if false;",
    "    }",
    "  }",
    "}",
    "",
  );
  return lines.join("\n");
}

// Whole collections are read (no compound queries): no composite index
// is needed. Kept as a file for `firebase deploy --only firestore`.
export const FIRESTORE_INDEXES = { indexes: [], fieldOverrides: [] } as const;

export function buildFirestoreIndexes(): string {
  return JSON.stringify(FIRESTORE_INDEXES, null, 2) + "\n";
}

// `firebase.json` for `firebase deploy --only firestore`.
export function buildFirebaseJson(): string {
  return JSON.stringify({ firestore: { rules: "firestore.rules", indexes: "firestore.indexes.json" } }, null, 2) + "\n";
}

// Every CRM collection the rules cover (tests assert it is all of them).
export const RULED_COLLECTIONS: readonly string[] = [...MEMBER_WRITE, "views", "automations", "automationRuns", ...ADMIN_WRITE, "users"];
export const ALL_COLLECTIONS = COLLECTIONS;
