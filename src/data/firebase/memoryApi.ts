// In-memory FirebaseApi for tests (and CLI dry runs): a fake Firestore
// with live listeners and a fake Auth. `rules` decides permission like
// the real security rules would (return false → "permission-denied").

import { getPath, setPath, splitPath } from "../patch";
import {
  DELETE_FIELD,
  SERVER_TIMESTAMP,
  splitTs,
  TS_FIELD,
  withChangeTracking,
  type CollectionChanges,
  type FirebaseApi,
  type FirebaseAuthUser,
  type FirestoreDocData,
  type FirestoreWriteOp,
} from "./api";

export interface MemoryFirestoreRules {
  read?(collection: string, id: string | null, auth: FirebaseAuthUser | null, db: MemoryFirestore): boolean;
  write?(op: FirestoreWriteOp, auth: FirebaseAuthUser | null, db: MemoryFirestore, next: Record<string, unknown> | null): boolean;
}

export interface MemoryFirestore {
  collections: Map<string, Map<string, Record<string, unknown>>>;
  get(collection: string, id: string): Record<string, unknown> | undefined;
}

function denied(): Error {
  return Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
}

export interface MemoryFirebaseApi extends FirebaseApi {
  db: MemoryFirestore;
  commits: FirestoreWriteOp[][];
  signInAs(user: FirebaseAuthUser | null): void;
  // Users the fake Auth accepts with signInWithPassword.
  accounts: Map<string, { password: string; user: FirebaseAuthUser }>;
  failNextCommit?: Error | null;
  // Fake Firebase Storage objects (path → bytes).
  objects: Map<string, Uint8Array>;
}

export function createMemoryFirebaseApi(opts: { rules?: MemoryFirestoreRules; user?: FirebaseAuthUser | null } = {}): MemoryFirebaseApi {
  const collections = new Map<string, Map<string, Record<string, unknown>>>();
  const db: MemoryFirestore = {
    collections,
    get: (c, id) => collections.get(c)?.get(id),
  };
  const coll = (c: string) => {
    let m = collections.get(c);
    if (!m) collections.set(c, (m = new Map()));
    return m;
  };
  const watchers = new Map<string, Set<(docs: FirestoreDocData[]) => void>>();
  const authListeners = new Set<(u: FirebaseAuthUser | null) => void>();
  let user: FirebaseAuthUser | null = opts.user ?? null;
  const rules = opts.rules ?? {};

  const docsOf = (c: string): FirestoreDocData[] =>
    [...coll(c).entries()].map(([id, data]) => splitTs(id, JSON.parse(JSON.stringify(data)) as Record<string, unknown>));
  const docsSince = (c: string, ms: number) => docsOf(c).filter((d) => (d.ts ?? 0) > ms);

  // Server clock of the fake: one tick per committed batch.
  let clock = 1_000_000;
  let reads = 0;
  const billed = (n: number) => (reads += Math.max(n, 1));

  // watchSince listeners: what each one has delivered (id → ts).
  const sinceWatchers = new Map<string, Set<{ ms: number; seen: Map<string, number>; onChanges: (c: CollectionChanges) => void }>>();
  const pushSince = (c: string, w: { ms: number; seen: Map<string, number>; onChanges: (c: CollectionChanges) => void }) => {
    const now = docsSince(c, w.ms);
    const upserts = now.filter((d) => w.seen.get(d.id) !== d.ts);
    const ids = new Set(now.map((d) => d.id));
    const removed = [...w.seen.keys()].filter((id) => !ids.has(id));
    for (const d of upserts) w.seen.set(d.id, d.ts ?? 0);
    for (const id of removed) w.seen.delete(id);
    billed(upserts.length + removed.length);
    if (upserts.length || removed.length) w.onChanges({ upserts, removed });
  };

  const emit = (c: string) => {
    for (const w of watchers.get(c) ?? []) w(docsOf(c));
    for (const w of sinceWatchers.get(c) ?? []) pushSince(c, w);
  };

  const objects = new Map<string, Uint8Array>();
  const api: MemoryFirebaseApi = {
    db,
    objects,
    storage: {
      async put(path, bytes) {
        if (!user) throw denied();
        objects.set(path, new Uint8Array(bytes));
      },
      async get(path) {
        if (!user) throw denied();
        const b = objects.get(path);
        return b ? new Uint8Array(b) : null;
      },
      async delete(path) {
        if (!user) throw denied();
        objects.delete(path);
      },
    },
    commits: [],
    accounts: new Map(),
    failNextCommit: null,
    signInAs(u) {
      user = u;
      for (const l of authListeners) l(u);
    },

    readCount: () => reads,
    async listCollection(c) {
      if (rules.read && !rules.read(c, null, user, db)) throw denied();
      const docs = docsOf(c);
      billed(docs.length);
      return docs;
    },
    async listSince(c, ms) {
      if (rules.read && !rules.read(c, null, user, db)) throw denied();
      const docs = docsSince(c, ms);
      billed(docs.length);
      return docs;
    },
    watchSince(c, ms, onChanges, onError) {
      if (rules.read && !rules.read(c, null, user, db)) {
        queueMicrotask(() => onError(denied()));
        return () => undefined;
      }
      let set = sinceWatchers.get(c);
      if (!set) sinceWatchers.set(c, (set = new Set()));
      const w = { ms, seen: new Map<string, number>(), onChanges };
      set.add(w);
      queueMicrotask(() => {
        if (set!.has(w)) pushSince(c, w);
      });
      return () => set!.delete(w);
    },
    watchCollection(c, onDocs, onError) {
      if (rules.read && !rules.read(c, null, user, db)) {
        queueMicrotask(() => onError(denied()));
        return () => undefined;
      }
      let set = watchers.get(c);
      if (!set) watchers.set(c, (set = new Set()));
      set.add(onDocs);
      queueMicrotask(() => onDocs(docsOf(c)));
      return () => set!.delete(onDocs);
    },
    async getDoc(c, id) {
      if (rules.read && !rules.read(c, id, user, db)) throw denied();
      billed(1);
      const d = coll(c).get(id);
      return d ? splitTs(id, JSON.parse(JSON.stringify(d)) as Record<string, unknown>).data : null;
    },
    async commit(ops) {
      if (ops.length > 500) throw Object.assign(new Error("Too many writes in one batch"), { code: "invalid-argument" });
      if (api.failNextCommit) {
        const err = api.failNextCommit;
        api.failNextCommit = null;
        throw err;
      }
      // Validate everything first (atomic batch). Server time is one value
      // per batch, like Firestore's request.time.
      const ts = ++clock;
      const resolve = (data: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === SERVER_TIMESTAMP ? ts : v]));
      const tracked = withChangeTracking(ops).map((op) => (op.type === "delete" ? op : ({ ...op, data: resolve(op.data) } as FirestoreWriteOp)));
      const staged: Array<[string, string, Record<string, unknown> | null]> = [];
      for (const op of tracked) {
        const current = coll(op.collection).get(op.id);
        let next: Record<string, unknown> | null;
        if (op.type === "set") next = JSON.parse(JSON.stringify(op.data)) as Record<string, unknown>;
        else if (op.type === "delete") next = null;
        else {
          if (!current) throw Object.assign(new Error(`No document to update: ${op.collection}/${op.id}`), { code: "not-found" });
          let d: Record<string, unknown> = { ...current };
          for (const [k, v] of Object.entries(op.data)) d = setPath(d, splitPath(k), v === DELETE_FIELD ? undefined : v);
          next = JSON.parse(JSON.stringify(d)) as Record<string, unknown>;
        }
        if (rules.write && !rules.write(op, user, db, next)) throw denied();
        staged.push([op.collection, op.id, next]);
      }
      const touched = new Set<string>();
      for (const [c, id, next] of staged) {
        if (next) coll(c).set(id, next);
        else coll(c).delete(id);
        touched.add(c);
      }
      api.commits.push(ops);
      for (const c of touched) emit(c);
    },

    auth: {
      async currentUser() {
        return user;
      },
      onChange(l) {
        authListeners.add(l);
        return () => authListeners.delete(l);
      },
      async signInWithPassword(email, password) {
        const acc = api.accounts.get(email.trim().toLowerCase());
        if (!acc || acc.password !== password) throw Object.assign(new Error("Invalid credential"), { code: "auth/invalid-credential" });
        api.signInAs(acc.user);
        return acc.user;
      },
      async signInWithGoogle() {
        throw Object.assign(new Error("Popup closed"), { code: "auth/popup-closed-by-user" });
      },
      async sendPasswordReset() {},
      async sendVerificationEmail() {},
      async reload() {
        return user;
      },
      async signOut() {
        api.signInAs(null);
      },
    },
  };
  return api;
}

// Rough JS model of the generated rules (src/ops/firebaseRules.ts), for
// store tests: roles from users/{uid}, bootstrap admin pinned, invites.
export function crmRulesModel(adminEmail: string, opts: { signup?: "invite" | "open" } = {}): MemoryFirestoreRules {
  const roleOf = (auth: FirebaseAuthUser | null, db: MemoryFirestore): string | null => {
    if (!auth) return null;
    if (auth.emailVerified && auth.email?.toLowerCase() === adminEmail) return "admin";
    const rec = db.get("users", auth.uid);
    if (!rec || rec.disabled) return null;
    return (rec.role as string) ?? null;
  };
  return {
    read(c, id, auth, db) {
      if (c === "users" && id && auth?.uid === id) return true;
      if (c === "invites") return roleOf(auth, db) === "admin" || (!!id && auth?.email?.toLowerCase() === id && !!auth?.emailVerified);
      if (c === "inbox") return roleOf(auth, db) === "admin";
      return roleOf(auth, db) !== null;
    },
    write(op, auth, db, next) {
      const role = roleOf(auth, db);
      if (op.collection === "users") {
        if (role === "admin") return true;
        if (op.type === "set" && auth && op.id === auth.uid && !db.get("users", op.id)) {
          if (!auth.emailVerified || next?.email !== auth.email?.toLowerCase()) return false;
          const invite = db.get("invites", auth.email!.toLowerCase());
          if (invite) return next?.role === invite.role;
          return opts.signup === "open" && next?.role === "member";
        }
        if (op.type === "update" && auth && op.id === auth.uid && role) {
          return Object.keys(op.data).every((k) => ["name", "avatarUrl", "prefs", "updatedAt", TS_FIELD].includes(k.split(".")[0]));
        }
        return false;
      }
      if (op.collection === "deletions") return op.type === "delete" ? role === "admin" : role === "admin" || role === "member";
      if (["records", "activities", "automationRuns"].includes(op.collection)) return role === "admin" || role === "member";
      if (op.collection === "files") return op.type === "delete" ? role === "admin" : role === "admin" || role === "member";
      if (op.collection === "views") {
        if (role === "admin") return true;
        if (role !== "member") return false;
        const owner = (next ?? db.get("views", op.id) ?? {}).ownerId;
        return owner === auth?.uid && !(next && getPath(next, ["shared"]) === true);
      }
      return role === "admin";
    },
  };
}
