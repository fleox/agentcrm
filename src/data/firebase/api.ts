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

export interface FirebaseApi {
  listCollection(collection: string): Promise<FirestoreDocData[]>;
  // Fires with the full content of the collection on every change.
  watchCollection(collection: string, onDocs: (docs: FirestoreDocData[]) => void, onError: (err: Error) => void): () => void;
  getDoc(collection: string, id: string): Promise<Record<string, unknown> | null>;
  // Applies the ops atomically (one Firestore batch, ≤ 500 ops).
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

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
