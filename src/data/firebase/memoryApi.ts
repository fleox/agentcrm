// In-memory FirebaseApi for tests (and CLI dry runs): a fake Firestore
// with live listeners and a fake Auth. `rules` decides permission like
// the real security rules would (return false → "permission-denied").

import { getPath, setPath, splitPath } from "../patch";
import { DELETE_FIELD, type FirebaseApi, type FirebaseAuthUser, type FirestoreDocData, type FirestoreWriteOp } from "./api";

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
    [...coll(c).entries()].map(([id, data]) => ({ id, data: JSON.parse(JSON.stringify(data)) as Record<string, unknown> }));

  const emit = (c: string) => {
    for (const w of watchers.get(c) ?? []) w(docsOf(c));
  };

  const api: MemoryFirebaseApi = {
    db,
    commits: [],
    accounts: new Map(),
    failNextCommit: null,
    signInAs(u) {
      user = u;
      for (const l of authListeners) l(u);
    },

    async listCollection(c) {
      if (rules.read && !rules.read(c, null, user, db)) throw denied();
      return docsOf(c);
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
      const d = coll(c).get(id);
      return d ? (JSON.parse(JSON.stringify(d)) as Record<string, unknown>) : null;
    },
    async commit(ops) {
      if (ops.length > 500) throw Object.assign(new Error("Too many writes in one batch"), { code: "invalid-argument" });
      if (api.failNextCommit) {
        const err = api.failNextCommit;
        api.failNextCommit = null;
        throw err;
      }
      // Validate everything first (atomic batch).
      const staged: Array<[string, string, Record<string, unknown> | null]> = [];
      for (const op of ops) {
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
          return Object.keys(op.data).every((k) => ["name", "avatarUrl", "updatedAt"].includes(k.split(".")[0]));
        }
        return false;
      }
      if (["records", "activities", "automationRuns"].includes(op.collection)) return role === "admin" || role === "member";
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
