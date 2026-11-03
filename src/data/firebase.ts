// Firebase backend: Firestore + Firebase Auth. Built on createStoreCore:
//
//   - one Firestore collection per CRM collection (same names; records
//     carry their `object` field), doc id = document id, data = the doc
//     without `id`;
//   - load = read every collection; watch = onSnapshot on each (live
//     updates from teammates, started with the first subscriber);
//   - persist = Firestore batches of ≤ 500 ops: `set` → set, `patch` →
//     update with dot paths (undefined → deleteField()), `delete` →
//     delete. The core applies writes optimistically and rolls back on
//     a failure (a multi-batch write that fails halfway is re-synced by
//     the next snapshot);
//   - identity = Firebase Auth user + role from users/{uid}. First
//     sign-in creates users/{uid}: as admin first (only the bootstrap
//     admin pinned in the rules is accepted), else with the role of the
//     invitation an admin created (invites/{email}, mirrored here from
//     the users an admin adds), else as member when the rules allow
//     open / domain sign-up. Otherwise → no access.
//
// Security is enforced by the Firestore rules (src/ops/firebaseRules.ts,
// docs/firebase.md) — the client checks are only UX.

import { registerAuthAdapter } from "../app/AuthContext";
import type { FirebaseRuntimeConfig, RuntimeConfig } from "../lib/runtimeConfig";
import { createStoreCore, emptySnapshot, type Snapshot } from "./core";
import {
  chunk,
  DELETE_FIELD,
  FIRESTORE_BATCH_LIMIT,
  isPermissionDenied,
  type FirebaseApi,
  type FirebaseAuthUser,
  type FirestoreDocData,
  type FirestoreWriteOp,
} from "./firebase/api";
import { normalizeDoc, plainCopy } from "./patch";
import type { BackendOptions } from "./registry";
import { COLLECTIONS, type CollectionName, type DataStore, type DocMutation, type StoreIdentity, type StoredDoc } from "./types";

export * from "./firebase/api";

export const INVITES_COLLECTION = "invites";
export const INBOX_COLLECTION = "inbox";
type Role = StoreIdentity["role"];
const ROLES: readonly Role[] = ["admin", "member", "viewer"];

export type FirebaseAccessReason = "unverified" | "notInvited" | "error";

export class FirebaseAccessError extends Error {
  constructor(
    public readonly reason: FirebaseAccessReason,
    message: string,
    public readonly email?: string,
  ) {
    super(message);
    this.name = "FirebaseAccessError";
  }
}

export interface FirebaseStoreOptions {
  api: FirebaseApi;
  // Require a verified address (must match the rules; default true).
  requireVerifiedEmail?: boolean;
  now?: () => number;
}

export interface FirebaseDataStore extends DataStore {
  readonly kind: "firebase";
  readonly api: FirebaseApi;
  // Why the signed-in Firebase user has no CRM access (null when fine).
  accessError(): FirebaseAccessError | null;
  // Forget the cached identity (after a sign-in / verification).
  resetSession(): void;
}

export function isFirebaseStore(store: DataStore): store is FirebaseDataStore {
  return store.kind === "firebase" && typeof (store as Partial<FirebaseDataStore>).accessError === "function";
}

function toData(doc: StoredDoc): Record<string, unknown> {
  const { id: _id, ...rest } = plainCopy(doc) as StoredDoc;
  return rest;
}

function fromData(d: FirestoreDocData): StoredDoc {
  return normalizeDoc({ ...d.data, id: d.id });
}

function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

export function emailKey(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

// ─── Invitations (mirrored from the users an admin adds) ─────────────────

// A user doc an admin created for someone who hasn't signed in yet
// (no `authUid`): its email is invited with its role.
function isPlaceholder(doc: StoredDoc | undefined): doc is StoredDoc {
  return !!doc && !doc.authUid && !!emailKey(doc.email);
}

export function inviteOps(mutations: DocMutation[], before: (id: string) => StoredDoc | undefined, after: Snapshot): FirestoreWriteOp[] {
  const ops = new Map<string, FirestoreWriteOp>();
  for (const m of mutations) {
    if (m.collection !== "users") continue;
    const id = m.op === "set" ? m.doc.id : m.id;
    const prev = before(id);
    const next = after.users.get(id);
    const prevEmail = isPlaceholder(prev) ? emailKey(prev.email) : "";
    const nextEmail = isPlaceholder(next) ? emailKey(next.email) : "";
    if (prevEmail && prevEmail !== nextEmail) ops.set(prevEmail, { type: "delete", collection: INVITES_COLLECTION, id: prevEmail });
    if (nextEmail && next) {
      if (next.disabled) ops.set(nextEmail, { type: "delete", collection: INVITES_COLLECTION, id: nextEmail });
      else ops.set(nextEmail, { type: "set", collection: INVITES_COLLECTION, id: nextEmail, data: { role: isRole(next.role) ? next.role : "member", userId: id, email: nextEmail } });
    }
  }
  return [...ops.values()];
}

// ─── Mutations → Firestore ops ───────────────────────────────────────────

export function mutationOps(mutations: DocMutation[], before: Snapshot): FirestoreWriteOp[] {
  const ops: FirestoreWriteOp[] = [];
  for (const m of mutations) {
    if (m.op === "set") ops.push({ type: "set", collection: m.collection, id: m.doc.id, data: toData(m.doc) });
    else if (m.op === "delete") ops.push({ type: "delete", collection: m.collection, id: m.id });
    else {
      // A patch on a missing doc is a no-op (Firestore update would fail).
      if (!before[m.collection].has(m.id)) continue;
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(m.fields)) {
        if (k === "id" || k.startsWith("id.")) continue;
        data[k] = v === undefined ? DELETE_FIELD : plainCopy(v);
      }
      if (Object.keys(data).length) ops.push({ type: "update", collection: m.collection, id: m.id, data });
    }
  }
  return ops;
}

// ─── Store ───────────────────────────────────────────────────────────────

export function createFirebaseStoreWith(opts: FirebaseStoreOptions): FirebaseDataStore {
  const api = opts.api;
  const requireVerified = opts.requireVerifiedEmail !== false;
  const now = opts.now ?? Date.now;
  let identityPromise: Promise<StoreIdentity | null> | null = null;
  let currentIdentity: StoreIdentity | null = null;
  let lastAccessError: FirebaseAccessError | null = null;
  // Raw users (placeholders included) — the snapshot hides replaced ones.
  let rawUsers = new Map<string, StoredDoc>();
  let reconciling = false;

  // A fresh sign-in / sign-out invalidates the cached identity.
  const offAuth = api.auth.onChange((u) => {
    if (!u || u.uid !== currentIdentity?.uid) {
      identityPromise = null;
      currentIdentity = null;
    }
  });

  function buildSnapshot(raw: Map<CollectionName, FirestoreDocData[]>): Snapshot {
    const s = emptySnapshot();
    for (const c of COLLECTIONS) for (const d of raw.get(c) ?? []) s[c].set(d.id, fromData(d));
    rawUsers = new Map(s.users);
    // Hide the placeholder of an invited user who has joined.
    for (const u of [...s.users.values()]) {
      if (typeof u.replaces === "string" && u.replaces !== u.id) s.users.delete(u.replaces);
    }
    return s;
  }

  async function readCollection(c: CollectionName): Promise<FirestoreDocData[]> {
    try {
      return await api.listCollection(c);
    } catch (err) {
      // Disabled / not-yet-allowed users: the rules deny — show empty.
      if (isPermissionDenied(err)) return [];
      throw err;
    }
  }

  async function ensureUserRecord(user: FirebaseAuthUser): Promise<Role> {
    const email = emailKey(user.email);
    let existing: Record<string, unknown> | null = null;
    try {
      existing = await api.getDoc("users", user.uid);
    } catch (err) {
      if (!isPermissionDenied(err)) throw err;
    }
    if (existing) return isRole(existing.role) ? existing.role : "viewer";
    if (requireVerified && !user.emailVerified) throw new FirebaseAccessError("unverified", "Verify your email address to continue.", email);
    const base = {
      email,
      name: user.displayName || email.split("@")[0] || "User",
      authUid: user.uid,
      createdAt: now(),
      updatedAt: now(),
      ...(user.photoURL ? { avatarUrl: user.photoURL } : {}),
    };
    const create = (role: Role, extra: Record<string, unknown> = {}) =>
      api.commit([{ type: "set", collection: "users", id: user.uid, data: { ...base, ...extra, role } }]);
    // 1. Bootstrap admin (the rules accept it only for the pinned email).
    try {
      await create("admin");
      return "admin";
    } catch (err) {
      if (!isPermissionDenied(err)) throw err;
    }
    // 2. Invited by an admin (role of the invitation).
    let invite: Record<string, unknown> | null = null;
    try {
      invite = email ? await api.getDoc(INVITES_COLLECTION, email) : null;
    } catch (err) {
      if (!isPermissionDenied(err)) throw err;
    }
    const role: Role = invite && isRole(invite.role) ? invite.role : "member";
    try {
      await create(role, invite && typeof invite.userId === "string" ? { replaces: invite.userId } : {});
      return role;
    } catch (err) {
      if (!isPermissionDenied(err)) throw err;
    }
    throw new FirebaseAccessError("notInvited", "This account has not been invited to this CRM. Ask an admin to add your email in Settings → Users.", email);
  }

  async function resolveIdentity(): Promise<StoreIdentity | null> {
    const user = await api.auth.currentUser();
    if (!user) {
      lastAccessError = null;
      return null;
    }
    try {
      const role = await ensureUserRecord(user);
      lastAccessError = null;
      return { uid: user.uid, email: emailKey(user.email), displayName: user.displayName || emailKey(user.email), role };
    } catch (err) {
      lastAccessError = err instanceof FirebaseAccessError ? err : new FirebaseAccessError("error", (err as Error).message, emailKey(user.email));
      return null;
    }
  }

  async function persist(mutations: DocMutation[], before: Snapshot, after: Snapshot): Promise<void> {
    const ops = mutationOps(mutations, before);
    // Invitations are written by admins only (the rules refuse others,
    // which would fail the whole batch).
    if (currentIdentity?.role === "admin") ops.push(...inviteOps(mutations, (id) => before.users.get(id) ?? rawUsers.get(id), after));
    for (const part of chunk(ops, FIRESTORE_BATCH_LIMIT)) await api.commit(part);
    for (const m of mutations) {
      if (m.collection !== "users") continue;
      const id = m.op === "set" ? m.doc.id : m.id;
      const doc = after.users.get(id);
      if (doc) rawUsers.set(id, doc);
      else rawUsers.delete(id);
    }
  }

  const core = createStoreCore({
    kind: "firebase",

    async load() {
      const raw = new Map<CollectionName, FirestoreDocData[]>();
      await Promise.all(COLLECTIONS.map(async (c) => raw.set(c, await readCollection(c))));
      const snap = buildSnapshot(raw);
      scheduleReconcile();
      return snap;
    },

    persist: (mutations, before, after) => persist(mutations, before, after),

    watch(onRemote) {
      const raw = new Map<CollectionName, FirestoreDocData[]>();
      const offs = COLLECTIONS.map((c) =>
        api.watchCollection(
          c,
          (docs) => {
            raw.set(c, docs);
            if (raw.size < COLLECTIONS.length) return;
            onRemote(buildSnapshot(raw));
            scheduleReconcile();
          },
          (err) => {
            if (isPermissionDenied(err)) raw.set(c, []);
            else console.warn(`[firebase] live updates of ${c} stopped:`, err);
          },
        ),
      );
      return () => offs.forEach((off) => off());
    },

    identity() {
      if (!identityPromise) {
        identityPromise = resolveIdentity().then((id) => {
          currentIdentity = id;
          // Never cache "no access" — a sign-in / invitation may follow.
          if (!id) identityPromise = null;
          return id;
        });
      }
      return identityPromise;
    },

    close() {
      offAuth();
    },
  });

  // Admins fold the placeholder of an invited user into their real
  // account (users/{uid}): references are rewritten, the placeholder
  // and its invitation deleted.
  function scheduleReconcile() {
    if (currentIdentity?.role !== "admin" || reconciling) return;
    const joined = [...rawUsers.values()].filter((u) => typeof u.replaces === "string");
    if (!joined.length) return;
    reconciling = true;
    setTimeout(() => {
      void reconcile(joined).finally(() => (reconciling = false));
    }, 0);
  }

  async function reconcile(joined: StoredDoc[]): Promise<void> {
    const mutations: DocMutation[] = [];
    const inviteDeletes: FirestoreWriteOp[] = [];
    const objects = core.list("objects");
    const userFields = new Map<string, string[]>(
      objects.map((o) => [o.id, ((o.fields as Array<{ id: string; type: string }>) ?? []).filter((f) => f.type === "user").map((f) => f.id)]),
    );
    for (const u of joined) {
      const from = u.replaces as string;
      const to = u.id;
      const placeholder = rawUsers.get(from);
      for (const r of core.list("records")) {
        const fields: Record<string, unknown> = {};
        if (r.ownerId === from) fields.ownerId = to;
        if (r.createdBy === from) fields.createdBy = to;
        for (const f of userFields.get(r.object as string) ?? []) {
          const v = (r.fields as Record<string, unknown> | undefined)?.[f];
          if (v === from) fields[`fields.${f}`] = to;
          else if (Array.isArray(v) && v.includes(from)) fields[`fields.${f}`] = v.map((x) => (x === from ? to : x));
        }
        if (Object.keys(fields).length) mutations.push({ op: "patch", collection: "records", id: r.id, fields });
      }
      for (const a of core.list("activities")) {
        if (a.assigneeId === from) mutations.push({ op: "patch", collection: "activities", id: a.id, fields: { assigneeId: to } });
      }
      const settings = core.get("settings", "general");
      if (settings?.ownerUserId === from) mutations.push({ op: "patch", collection: "settings", id: "general", fields: { ownerUserId: to } });
      if (placeholder) {
        mutations.push({ op: "delete", collection: "users", id: from });
        if (emailKey(placeholder.email)) inviteDeletes.push({ type: "delete", collection: INVITES_COLLECTION, id: emailKey(placeholder.email) });
      }
      mutations.push({ op: "patch", collection: "users", id: to, fields: { replaces: undefined, ...(placeholder && placeholder.role !== u.role && isRole(placeholder.role) ? { role: placeholder.role } : {}) } });
    }
    try {
      await core.write(mutations, { message: "Link invited users" });
      if (inviteDeletes.length) await api.commit(inviteDeletes);
    } catch (err) {
      console.warn("[firebase] could not link invited users:", err);
    }
  }

  return Object.assign(core as FirebaseDataStore, {
    api,
    accessError: () => lastAccessError,
    resetSession() {
      identityPromise = null;
      currentIdentity = null;
      lastAccessError = null;
    },
  });
}

// ─── Runtime wiring ──────────────────────────────────────────────────────

const apis = new Map<string, Promise<FirebaseApi>>();

// The SDK-backed api of a config (one per project, shared by the store,
// the login screen and the setup wizard).
export function firebaseApiFor(config: FirebaseRuntimeConfig): Promise<FirebaseApi> {
  const key = config.firebase.projectId ?? "default";
  let api = apis.get(key);
  if (!api) {
    api = import("./firebase/sdk").then((m) => m.createSdkFirebaseApi(config.firebase));
    apis.set(key, api);
    api.catch(() => apis.delete(key));
  }
  return api;
}

let activeApi: FirebaseApi | null = null;

registerAuthAdapter("firebase", {
  async signOut() {
    await activeApi?.auth.signOut();
  },
});

// The DataStore factory is synchronous in the registry contract but the
// SDK loads lazily, so this returns a promise (the registry accepts it).
export async function createFirebaseStore(config: RuntimeConfig, _opts: BackendOptions = {}): Promise<FirebaseDataStore> {
  const cfg = config as FirebaseRuntimeConfig;
  if (!cfg.firebase?.apiKey || !cfg.firebase.projectId) throw new Error("The Firebase web config (apiKey, projectId) is missing.");
  const api = await firebaseApiFor(cfg);
  activeApi = api;
  return createFirebaseStoreWith({ api });
}
