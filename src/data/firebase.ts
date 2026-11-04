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
  DELETE_FIELD,
  errorCode,
  chunkForCommit,
  DELETIONS_COLLECTION,
  setTrackedCollections,
  isPermissionDenied,
  type FirebaseApi,
  type FirebaseAuthUser,
  type FirestoreDocData,
  type FirestoreWriteOp,
} from "./firebase/api";
import { FIREBASE_CACHE_VERSION, firebaseCacheKey, indexedDbFirebaseCache, isUsableCache, type FirebaseCache } from "./firebase/cache";
import { assertFileId, FileStoreUnavailableError, withFileStore } from "./files";
import { normalizeDoc, plainCopy } from "./patch";
import type { BackendOptions } from "./registry";
import { COLLECTIONS, type CollectionName, type DataStore, type DocMutation, type FileStore, type StoreIdentity, type StoredDoc } from "./types";

export * from "./firebase/api";

export const INVITES_COLLECTION = "invites";
// Large extension bundles are split over this collection (a Firestore
// document holds ≤ 1 MiB): extensions/{id} keeps `chunks: { file: n }`
// and extensionChunks/{id}__{file}__{i} = { ext, file, index, data }.
export const EXTENSION_CHUNKS_COLLECTION = "extensionChunks";
export const EXTENSION_CHUNK_CHARS = 300_000;
export const INBOX_COLLECTION = "inbox";
// What the store keeps in memory and in its local cache (change-tracked).
const TRACKED: readonly string[] = [...COLLECTIONS, EXTENSION_CHUNKS_COLLECTION];
setTrackedCollections(TRACKED);
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
  // Local copy of the dataset (incremental loads). Absent: every open
  // reads everything.
  cache?: FirebaseCache | null;
  // Project the cache entry belongs to (with the signed-in uid).
  projectId?: string;
}

export interface FirebaseDataStore extends DataStore {
  readonly kind: "firebase";
  readonly api: FirebaseApi;
  // Why the signed-in Firebase user has no CRM access (null when fine).
  accessError(): FirebaseAccessError | null;
  // Forget the cached identity (after a sign-in / verification).
  resetSession(): void;
  // Documents read from Firestore by this store's api so far (billed reads).
  readCount(): number;
  // How the last load went: from the local cache + changes, or a full read.
  lastLoad(): { mode: "full" | "incremental"; reads: number } | null;
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

// ─── Extension chunks ────────────────────────────────────────────────────

const chunkId = (ext: string, file: string, i: number) => `${ext}__${file}__${i}`;

function chunkCounts(doc: StoredDoc | undefined): Record<string, number> {
  const files = (doc?.files ?? {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(files)) if (typeof v === "string") out[k] = Math.ceil(v.length / EXTENSION_CHUNK_CHARS);
  return out;
}

function extensionSetOps(doc: StoredDoc, previous: StoredDoc | undefined): FirestoreWriteOp[] {
  const files = (doc.files ?? {}) as Record<string, unknown>;
  const size = Object.values(files).reduce<number>((n, v) => n + (typeof v === "string" ? v.length : 0), 0);
  const ops: FirestoreWriteOp[] = [];
  const counts: Record<string, number> = {};
  const data = toData(doc);
  if (size > EXTENSION_CHUNK_CHARS) {
    for (const [file, v] of Object.entries(files)) {
      if (typeof v !== "string") continue;
      const n = Math.ceil(v.length / EXTENSION_CHUNK_CHARS);
      counts[file] = n;
      for (let i = 0; i < n; i++) {
        ops.push({ type: "set", collection: EXTENSION_CHUNKS_COLLECTION, id: chunkId(doc.id, file, i), data: { ext: doc.id, file, index: i, data: v.slice(i * EXTENSION_CHUNK_CHARS, (i + 1) * EXTENSION_CHUNK_CHARS) } });
      }
    }
    data.files = {};
    data.chunks = counts;
  }
  // Chunks of the previous version that are no longer used.
  for (const [file, n] of Object.entries(chunkCounts(previous))) {
    for (let i = counts[file] ?? 0; i < n; i++) ops.push({ type: "delete", collection: EXTENSION_CHUNKS_COLLECTION, id: chunkId(doc.id, file, i) });
  }
  ops.unshift({ type: "set", collection: "extensions", id: doc.id, data });
  return ops;
}

// Rebuilds chunked extension docs from their chunks.
export function assembleExtensionDocs(docs: FirestoreDocData[], chunks: FirestoreDocData[]): FirestoreDocData[] {
  const byExt = new Map<string, FirestoreDocData[]>();
  for (const c of chunks) {
    const ext = String(c.data.ext ?? "");
    byExt.set(ext, [...(byExt.get(ext) ?? []), c]);
  }
  return docs.map((d) => {
    const counts = d.data.chunks as Record<string, number> | undefined;
    if (!counts || typeof counts !== "object") return d;
    const files: Record<string, string> = {};
    const parts = byExt.get(d.id) ?? [];
    for (const [file, n] of Object.entries(counts)) {
      const pieces = parts.filter((p) => p.data.file === file).sort((a, b) => Number(a.data.index) - Number(b.data.index));
      // Incomplete (a write in flight): leave the file out; the loader skips it.
      if (pieces.length !== n) continue;
      files[file] = pieces.map((p) => String(p.data.data ?? "")).join("");
    }
    const { chunks: _chunks, ...rest } = d.data;
    return { id: d.id, data: { ...rest, files } };
  });
}

// ─── Mutations → Firestore ops ───────────────────────────────────────────

export function mutationOps(mutations: DocMutation[], before: Snapshot): FirestoreWriteOp[] {
  const ops: FirestoreWriteOp[] = [];
  for (const m of mutations) {
    if (m.op === "set" && m.collection === "extensions") ops.push(...extensionSetOps(m.doc, before.extensions.get(m.doc.id)));
    else if (m.op === "set") ops.push({ type: "set", collection: m.collection, id: m.doc.id, data: toData(m.doc) });
    else if (m.op === "delete") {
      ops.push({ type: "delete", collection: m.collection, id: m.id });
      if (m.collection === "extensions") {
        for (const [file, n] of Object.entries(chunkCounts(before.extensions.get(m.id)))) for (let i = 0; i < n; i++) ops.push({ type: "delete", collection: EXTENSION_CHUNKS_COLLECTION, id: chunkId(m.id, file, i) });
      }
    }
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

// ─── Files (Firebase Storage) ────────────────────────────────────────────

export const STORAGE_FILES_DIR = "files";
export const STORAGE_NOT_ENABLED =
  "Firebase Storage isn't enabled for this project: enable it in the Firebase console (Build → Storage), add `storageBucket` to the web config and deploy the storage rules (docs/files.md).";

// FileStore over Firebase Storage: files/<id>. Access control = the
// storage rules (src/ops/firebaseRules.ts buildStorageRules).
export function firebaseFileStore(api: FirebaseApi): FileStore {
  const storage = () => {
    if (!api.storage) throw new FileStoreUnavailableError(STORAGE_NOT_ENABLED);
    return api.storage;
  };
  const path = (id: string) => {
    assertFileId(id);
    return `${STORAGE_FILES_DIR}/${id}`;
  };
  const wrap = async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      const code = errorCode(err);
      if (code === "storage/unknown" || code === "storage/bucket-not-found" || code === "storage/no-default-bucket") throw new FileStoreUnavailableError(STORAGE_NOT_ENABLED);
      throw err;
    }
  };
  return {
    kind: "firebase",
    put: (id, bytes, meta) => wrap(() => storage().put(path(id), bytes, meta?.mime)),
    async putMany(items) {
      for (const it of items) await wrap(() => storage().put(path(it.id), it.bytes, it.meta?.mime));
    },
    get: (id) => wrap(() => storage().get(path(id))),
    delete: (id) => wrap(() => storage().delete(path(id))),
  };
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

  function buildSnapshot(raw: Map<CollectionName, FirestoreDocData[]>, chunks: FirestoreDocData[]): Snapshot {
    const s = emptySnapshot();
    for (const c of COLLECTIONS) {
      const docs = c === "extensions" ? assembleExtensionDocs(raw.get(c) ?? [], chunks) : raw.get(c) ?? [];
      for (const d of docs) s[c].set(d.id, fromData(d));
    }
    rawUsers = new Map(s.users);
    // Hide the placeholder of an invited user who has joined.
    for (const u of [...s.users.values()]) {
      if (typeof u.replaces === "string" && u.replaces !== u.id) s.users.delete(u.replaces);
    }
    return s;
  }

  async function readCollection(c: string): Promise<FirestoreDocData[]> {
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

  function getIdentity(): Promise<StoreIdentity | null> {
    if (!identityPromise) {
      identityPromise = resolveIdentity().then((id) => {
        currentIdentity = id;
        // Never cache "no access" — a sign-in / invitation may follow.
        if (!id) identityPromise = null;
        return id;
      });
    }
    return identityPromise;
  }

  async function persist(mutations: DocMutation[], before: Snapshot, after: Snapshot): Promise<void> {
    const ops = mutationOps(mutations, before);
    // A user change needs the caller's role to mirror invitations: the CLI
    // may write before anything asked for the identity (a site with a
    // recorded --user never does), and then added users got no invitation.
    if (!currentIdentity && mutations.some((m) => m.collection === "users")) await getIdentity();
    // Invitations are written by admins only (the rules refuse others,
    // which would fail the whole batch).
    if (currentIdentity?.role === "admin") ops.push(...inviteOps(mutations, (id) => before.users.get(id) ?? rawUsers.get(id), after));
    for (const part of chunkForCommit(ops)) await api.commit(part);
    for (const m of mutations) {
      if (m.collection !== "users") continue;
      const id = m.op === "set" ? m.doc.id : m.id;
      const doc = after.users.get(id);
      if (doc) rawUsers.set(id, doc);
      else rawUsers.delete(id);
    }
  }

  // ─── Incremental loading ───────────────────────────────────────────────
  // `docs` mirrors every tracked collection as read from Firestore; the
  // snapshot is rebuilt from it. With a cache, an open restores `docs`
  // and reads only documents written after `cursor` (+ tombstones).
  const docs = new Map<string, Map<string, FirestoreDocData>>(TRACKED.map((c) => [c, new Map()]));
  let cursor = 0;
  let fullAt = 0;
  let cacheKey: string | null = null;
  let loadInfo: { mode: "full" | "incremental"; reads: number } | null = null;
  let markLoaded: () => void = () => undefined;
  const loadedOnce = new Promise<void>((resolve) => (markLoaded = resolve));
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const advance = (d: FirestoreDocData) => {
    if (typeof d.ts === "number" && d.ts > cursor) cursor = d.ts;
  };

  function upsert(c: string, list: FirestoreDocData[]) {
    const m = docs.get(c)!;
    for (const d of list) {
      m.set(d.id, d);
      advance(d);
    }
  }

  function applyTombstones(list: FirestoreDocData[]) {
    for (const t of list) {
      advance(t);
      const c = t.data.collection;
      const id = t.data.id;
      if (typeof c === "string" && typeof id === "string") docs.get(c)?.delete(id);
    }
  }

  function snapshotFromDocsMap(): Snapshot {
    const raw = new Map<CollectionName, FirestoreDocData[]>(COLLECTIONS.map((c) => [c, [...docs.get(c)!.values()]]));
    return buildSnapshot(raw, [...docs.get(EXTENSION_CHUNKS_COLLECTION)!.values()]);
  }

  async function saveCache(): Promise<void> {
    if (!opts.cache || !cacheKey) return;
    const collections = Object.fromEntries(TRACKED.map((c) => [c, [...docs.get(c)!.values()]]));
    await opts.cache.write(cacheKey, { v: FIREBASE_CACHE_VERSION, cursor, fullAt, collections });
  }

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveCache();
    }, 1000);
    (saveTimer as { unref?: () => void }).unref?.();
  }

  // Denied collections (viewer, not invited) are empty, as before.
  async function readSince(c: string, since: number): Promise<FirestoreDocData[] | null> {
    try {
      return await api.listSince(c, since);
    } catch (err) {
      if (isPermissionDenied(err)) return null;
      throw err;
    }
  }

  const core = createStoreCore({
    kind: "firebase",

    async load() {
      const readsBefore = api.readCount();
      const user = await api.auth.currentUser();
      cacheKey = opts.cache && opts.projectId && user ? firebaseCacheKey(opts.projectId, user.uid) : null;
      const cached = cacheKey ? await opts.cache!.read(cacheKey) : null;
      let mode: "full" | "incremental" = "full";
      if (isUsableCache(cached, now())) {
        mode = "incremental";
        cursor = cached.cursor;
        fullAt = cached.fullAt;
        for (const c of TRACKED) docs.set(c, new Map((cached.collections[c] ?? []).map((d) => [d.id, d])));
        const since = cursor;
        const changed = await Promise.all(TRACKED.map(async (c) => [c, await readSince(c, since)] as const));
        for (const [c, list] of changed) {
          if (list === null) docs.set(c, new Map());
          else upsert(c, list);
        }
        applyTombstones((await readSince(DELETIONS_COLLECTION, since)) ?? []);
      } else {
        cursor = 0;
        const all = await Promise.all(TRACKED.map(async (c) => [c, await readCollection(c)] as const));
        for (const [c, list] of all) {
          docs.set(c, new Map());
          upsert(c, list);
        }
        fullAt = now();
      }
      loadInfo = { mode, reads: api.readCount() - readsBefore };
      // Read it from the browser console to check the cost of an open.
      (globalThis as { __AGENTCRM_FIRESTORE__?: unknown }).__AGENTCRM_FIRESTORE__ = { ...loadInfo, cursor, totalReads: api.readCount };
      await saveCache();
      markLoaded();
      const snap = snapshotFromDocsMap();
      scheduleReconcile();
      return snap;
    },

    persist: (mutations, before, after) => persist(mutations, before, after),

    // Live updates: one listener per collection on documents written after
    // the load's cursor — only changes are read (and billed).
    watch(onRemote) {
      let offs: Array<() => void> = [];
      let stopped = false;
      const emit = () => {
        onRemote(snapshotFromDocsMap());
        scheduleReconcile();
        scheduleSave();
      };
      void loadedOnce.then(() => {
        if (stopped) return;
        const since = cursor;
        offs = TRACKED.map((c) =>
          api.watchSince(
            c,
            since,
            (ch) => {
              upsert(c, ch.upserts);
              for (const id of ch.removed) docs.get(c)!.delete(id);
              emit();
            },
            (err) => {
              if (isPermissionDenied(err)) {
                docs.set(c, new Map());
                emit();
              } else console.warn(`[firebase] live updates of ${c} stopped:`, err);
            },
          ),
        );
        offs.push(
          api.watchSince(
            DELETIONS_COLLECTION,
            since,
            (ch) => {
              applyTombstones(ch.upserts);
              emit();
            },
            (err) => {
              if (!isPermissionDenied(err)) console.warn("[firebase] live deletions stopped:", err);
            },
          ),
        );
      });
      return () => {
        stopped = true;
        offs.forEach((off) => off());
      };
    },

    identity: getIdentity,

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

  // Persist what live updates brought before the store goes away.
  const closeCore = core.close?.bind(core);
  core.close = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      void saveCache();
    }
    closeCore?.();
  };

  withFileStore(core, firebaseFileStore(api));
  activeCacheClear = async () => {
    if (opts.cache && cacheKey) await opts.cache.clear(cacheKey);
  };
  return Object.assign(core as FirebaseDataStore, {
    api,
    readCount: () => api.readCount(),
    lastLoad: () => loadInfo,
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
let activeCacheClear: (() => Promise<void>) | null = null;

registerAuthAdapter("firebase", {
  async signOut() {
    // The local copy belongs to the account that signs out.
    await activeCacheClear?.();
    await activeApi?.auth.signOut();
  },
});

function loginOf(secrets: Record<string, unknown> | undefined): { email: string; password: string } | null {
  const email = typeof secrets?.email === "string" ? secrets.email.trim() : "";
  const password = typeof secrets?.password === "string" ? secrets.password : "";
  return email && password ? { email, password } : null;
}

// CLI / MCP front doors: the `firebase:<name>` login (email + password)
// arrives as backend secrets and signs the api in, unless a session of
// that same address is already restored. The admin passes no secrets: its
// login screen signs in. Without this the CLI read and wrote Firestore
// unauthenticated, and the rules denied everything.
export async function signInWithSecrets(api: FirebaseApi, secrets: Record<string, unknown> | undefined): Promise<FirebaseAuthUser | null> {
  const login = loginOf(secrets);
  if (!login) return null;
  const current = await api.auth.currentUser();
  if (current?.email && current.email.toLowerCase() === login.email.toLowerCase()) return current;
  if (current) await api.auth.signOut();
  return api.auth.signInWithPassword(login.email, login.password);
}

export interface FirebaseAccessCheck {
  ok: boolean;
  detail: string;
  existing: boolean;
}

// Install dry run: signs in with the login, then reads settings/general,
// which the generated rules only allow to a verified bootstrap admin or an
// active user. Side-effect free.
export async function checkFirebaseAccess(api: FirebaseApi, secrets: Record<string, unknown> | undefined, projectId: string): Promise<FirebaseAccessCheck> {
  const login = loginOf(secrets);
  if (!login) return { ok: false, detail: "the Firebase login (email + password) is missing", existing: false };
  let user: FirebaseAuthUser | null;
  try {
    user = await signInWithSecrets(api, secrets);
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    return { ok: false, detail: `Firebase refused the login of ${login.email} (${code || (err as Error).message}): check the address, the password and that Email/Password sign-in is enabled`, existing: false };
  }
  if (!user?.emailVerified) {
    return { ok: false, detail: `${login.email} is not verified yet: open the verification email Firebase sent to it (the rules refuse unverified addresses), then retry`, existing: false };
  }
  try {
    const settings = await api.getDoc("settings", "general");
    return { ok: true, detail: `Firebase project ${projectId}: signed in as ${login.email}, rules accept it${settings ? " — existing CRM: it is kept, only what's missing is seeded" : ""}`, existing: !!settings };
  } catch (err) {
    if (!isPermissionDenied(err)) throw err;
    return { ok: false, detail: `Firestore refused ${login.email}: publish the AgentCRM rules with this address as bootstrap admin (\`agentcrm options --firebase-rules ${login.email}\`), or invite it`, existing: false };
  }
}

// The DataStore factory is synchronous in the registry contract but the
// SDK loads lazily, so this returns a promise (the registry accepts it).
export async function createFirebaseStore(config: RuntimeConfig, opts: BackendOptions = {}): Promise<FirebaseDataStore> {
  const cfg = config as FirebaseRuntimeConfig;
  if (!cfg.firebase?.apiKey || !cfg.firebase.projectId) throw new Error("The Firebase web config (apiKey, projectId) is missing.");
  const api = await firebaseApiFor(cfg);
  activeApi = api;
  await signInWithSecrets(api, opts.secrets);
  const cache = opts.firebaseCache === undefined ? indexedDbFirebaseCache() : opts.firebaseCache;
  return createFirebaseStoreWith({ api, cache, projectId: cfg.firebase.projectId });
}
