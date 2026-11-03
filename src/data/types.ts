// DataStore API (see CLAUDE.md) — generalisation of cms-ia's docstore
// (src/services/docstore/types.ts): the whole dataset lives in memory,
// reads are synchronous after ready(), writes are optimistic.
//
// Every backend (local IndexedDB, journal over a storage connector,
// git-json, Firebase, memory) implements this interface; src/ops/ only
// ever talks to it.

export type CollectionName =
  | "objects"
  | "records"
  | "activities"
  | "pipelines"
  | "views"
  | "automations"
  | "forms"
  | "users"
  | "settings"
  | "config"
  | "automationRuns"
  // Installed external extensions (src/ops/extensions.ts).
  | "extensions";

export const COLLECTIONS: readonly CollectionName[] = [
  "objects",
  "records",
  "activities",
  "pipelines",
  "views",
  "automations",
  "forms",
  "users",
  "settings",
  "config",
  "automationRuns",
  "extensions",
];

export function isCollectionName(value: unknown): value is CollectionName {
  return typeof value === "string" && (COLLECTIONS as readonly string[]).includes(value);
}

// JSON-safe document. Dates are epoch milliseconds. Keys holding
// `undefined` are dropped on write.
export interface StoredDoc {
  id: string;
  [key: string]: unknown;
}

// `patch` merges per field: each key of `fields` is a top-level key or a
// dot path ("fields.email", "meta.callDuration"); `undefined` removes the
// key. Patching a document that doesn't exist is a no-op.
export type DocMutation =
  | { op: "set"; collection: CollectionName; doc: StoredDoc }
  | { op: "patch"; collection: CollectionName; id: string; fields: Record<string, unknown> }
  | { op: "delete"; collection: CollectionName; id: string };

export type BackendKind = "local" | "journal" | "git-json" | "firebase" | "memory";

export interface StoreIdentity {
  uid: string;
  email: string;
  displayName: string;
  // Derived from the backend: always admin for single-user backends,
  // repo permission for git-json, users/{uid} for Firebase.
  role: "admin" | "member" | "viewer";
}

export interface WriteOptions {
  // Commit message (git-json) / journal annotation.
  message?: string;
}

export interface DataStore {
  readonly kind: BackendKind;

  // Loads the dataset. Idempotent; reads before it resolves see nothing.
  ready(): Promise<void>;

  // Synchronous reads from the in-memory snapshot. Returned docs are
  // frozen — never mutate them.
  list(collection: CollectionName): StoredDoc[];
  get(collection: CollectionName, id: string): StoredDoc | undefined;

  // Applies mutations to memory immediately (subscribers notified
  // synchronously), then persists. Writes are serialised. On a persist
  // failure only these mutations are rolled back, subscribers notified
  // again, and the error rethrown. One user action = one write().
  write(mutations: DocMutation[], opts?: WriteOptions): Promise<void>;

  // Fires after any change (local write, rollback, remote change picked
  // up by polling / onSnapshot). While at least one listener is
  // registered, polling backends poll their source.
  subscribe(listener: (changed: Set<CollectionName>) => void): () => void;

  // Pull remote changes now.
  refresh(): Promise<void>;

  identity(): Promise<StoreIdentity | null>;

  // Rewrites the storage without history: physically purges deleted
  // documents (journal: new snapshot + delete merged segments).
  compact?(): Promise<void>;

  // Stops timers / listeners.
  close?(): void;
}

export class DocConflictError extends Error {
  constructor(
    message: string,
    public readonly collection: CollectionName,
    public readonly id: string,
  ) {
    super(message);
    this.name = "DocConflictError";
  }
}

export class StoreNotReadyError extends Error {
  constructor(message = "The data store is not ready.") {
    super(message);
    this.name = "StoreNotReadyError";
  }
}
