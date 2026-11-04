// The small slice of Firestore + Firebase Auth the Firebase backend
// uses, behind an interface: ./sdk.ts implements it with the Firebase
// JS SDK, tests with an in-memory fake (./memoryApi.ts). Keeps the store
// logic (../firebase.ts) testable without network.

export interface FirebaseAuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  photoURL?: string | null;
}

// Sentinel for "remove this field" in update ops (deleteField()).
export const DELETE_FIELD: unique symbol = Symbol("deleteField");
export type FieldValueOrDelete = unknown | typeof DELETE_FIELD;

export type FirestoreWriteOp =
  | { type: "set"; collection: string; id: string; data: Record<string, unknown> }
  // `data` keys are dot paths (nested fields), values may be DELETE_FIELD.
  | { type: "update"; collection: string; id: string; data: Record<string, FieldValueOrDelete> }
  | { type: "delete"; collection: string; id: string };

export interface FirestoreDocData {
  id: string;
  data: Record<string, unknown>;
  // Server time of the last write (epoch ms, from TS_FIELD), when the
  // document has one: written before 0.4.0 or not yet confirmed → absent.
  ts?: number;
}

// ─── Change tracking (incremental loads) ──────────────────────────────────
// Every write to a tracked collection stamps TS_FIELD with the server time,
// and every delete leaves a tombstone in DELETIONS_COLLECTION, in the same
// batch. A client holding a cached copy then reads only `TS_FIELD > cursor`
// on each collection (Firestore bills documents read, not documents held),
// instead of the whole dataset on every open.
export const TS_FIELD = "_ts";
export const DELETIONS_COLLECTION = "deletions";
// Sentinel for "server time" in write data (serverTimestamp()).
export const SERVER_TIMESTAMP: unique symbol = Symbol("serverTimestamp");

let trackedCollections: ReadonlySet<string> = new Set();

// Set once by the store (src/data/firebase.ts): the collections it caches.
export function setTrackedCollections(collections: Iterable<string>): void {
  trackedCollections = new Set(collections);
}

export function tombstoneId(collection: string, id: string): string {
  return `${collection}__${id}`;
}

// The ops a batch really writes: stamps + tombstones (≤ 2× the input).
export function withChangeTracking(ops: FirestoreWriteOp[]): FirestoreWriteOp[] {
  const out: FirestoreWriteOp[] = [];
  for (const op of ops) {
    if (!trackedCollections.has(op.collection)) {
      out.push(op);
    } else if (op.type === "delete") {
      out.push(op, { type: "set", collection: DELETIONS_COLLECTION, id: tombstoneId(op.collection, op.id), data: { collection: op.collection, id: op.id, [TS_FIELD]: SERVER_TIMESTAMP } });
    } else {
      out.push({ ...op, data: { ...op.data, [TS_FIELD]: SERVER_TIMESTAMP } } as FirestoreWriteOp);
    }
  }
  return out;
}

// Splits a document read from Firestore into data + ts (TS_FIELD never
// reaches the CRM documents).
export function splitTs(id: string, raw: Record<string, unknown>): FirestoreDocData {
  const { [TS_FIELD]: ts, ...data } = raw;
  return typeof ts === "number" ? { id, data, ts } : { id, data };
}

export interface CollectionChanges {
  upserts: FirestoreDocData[];
  removed: string[];
}

// Error with a Firestore / Auth code ("permission-denied", "auth/…").
export interface CodedError extends Error {
  code?: string;
}

export function errorCode(err: unknown): string {
  return (err as CodedError | null)?.code ?? "";
}

export function isPermissionDenied(err: unknown): boolean {
  const code = errorCode(err);
  return code === "permission-denied" || code === "firestore/permission-denied";
}

// Firebase Storage (file bytes). Absent when the project has no Storage
// bucket configured (storageBucket missing from the web config).
export interface FirebaseStorageApi {
  put(path: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  // null when the object doesn't exist.
  get(path: string): Promise<Uint8Array | null>;
  // Resolves when already gone.
  delete(path: string): Promise<void>;
}

export interface FirebaseApi {
  // Firebase Storage of the project (optional, see FirebaseStorageApi).
  storage?: FirebaseStorageApi;
  listCollection(collection: string): Promise<FirestoreDocData[]>;
  // Documents whose TS_FIELD is later than `sinceMs` (the incremental read).
  listSince(collection: string, sinceMs: number): Promise<FirestoreDocData[]>;
  // Fires with the full content of the collection on every change.
  watchCollection(collection: string, onDocs: (docs: FirestoreDocData[]) => void, onError: (err: Error) => void): () => void;
  // Fires with what changed among documents written after `sinceMs`
  // (server-confirmed writes only): first the backlog, then live changes.
  watchSince(collection: string, sinceMs: number, onChanges: (changes: CollectionChanges) => void, onError: (err: Error) => void): () => void;
  // Documents read from the server so far (what Firestore bills; an empty
  // query counts 1), for `doctor` and the tests.
  readCount(): number;
  getDoc(collection: string, id: string): Promise<Record<string, unknown> | null>;
  // Applies the ops atomically (one Firestore batch, ≤ 500 ops after
  // withChangeTracking, which implementations apply).
  commit(ops: FirestoreWriteOp[]): Promise<void>;

  auth: {
    // Resolves once the persisted session was restored.
    currentUser(): Promise<FirebaseAuthUser | null>;
    onChange(listener: (user: FirebaseAuthUser | null) => void): () => void;
    signInWithPassword(email: string, password: string): Promise<FirebaseAuthUser>;
    signInWithGoogle(): Promise<FirebaseAuthUser>;
    sendPasswordReset(email: string): Promise<void>;
    sendVerificationEmail(): Promise<void>;
    // Reloads the user + refreshes the ID token (email_verified).
    reload(): Promise<FirebaseAuthUser | null>;
    signOut(): Promise<void>;
  };
}

export const FIRESTORE_BATCH_LIMIT = 500;
// Splits ops into commit() calls that stay within one Firestore batch once
// withChangeTracking has added a tombstone to each tracked delete.
export function chunkForCommit(ops: FirestoreWriteOp[]): FirestoreWriteOp[][] {
  const out: FirestoreWriteOp[][] = [];
  let part: FirestoreWriteOp[] = [];
  let weight = 0;
  for (const op of ops) {
    const w = op.type === "delete" && trackedCollections.has(op.collection) ? 2 : 1;
    if (weight + w > FIRESTORE_BATCH_LIMIT) {
      out.push(part);
      part = [];
      weight = 0;
    }
    part.push(op);
    weight += w;
  }
  if (part.length) out.push(part);
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
