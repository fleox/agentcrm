// Local copy of a Firebase dataset, so an open reads only what changed
// since the last one (see TS_FIELD in ./api.ts). One entry per project and
// signed-in user: a cache never serves another account's view of the data.
// Browser: IndexedDB. CLI: a 0600 file in ~/.agentcrm (agent/firebaseCache.ts).
// Tests: memoryFirebaseCache().

import type { FirestoreDocData } from "./api";

export const FIREBASE_CACHE_VERSION = 1;
// A full read at least this often catches what tombstones can't see
// (documents deleted from the console, writes from a pre-0.4.0 client).
export const FULL_RELOAD_MS = 7 * 24 * 3600 * 1000;

export interface FirebaseCacheState {
  v: number;
  // Highest server time seen (epoch ms): the next read asks for later writes.
  cursor: number;
  // When the last full read happened (epoch ms, client clock).
  fullAt: number;
  collections: Record<string, FirestoreDocData[]>;
}

export interface FirebaseCache {
  read(key: string): Promise<FirebaseCacheState | null>;
  write(key: string, state: FirebaseCacheState): Promise<void>;
  clear(key: string): Promise<void>;
}

export function firebaseCacheKey(projectId: string, uid: string): string {
  return `${projectId}:${uid}`;
}

export function isUsableCache(state: FirebaseCacheState | null, now: number): state is FirebaseCacheState {
  return !!state && state.v === FIREBASE_CACHE_VERSION && typeof state.cursor === "number" && now - state.fullAt < FULL_RELOAD_MS;
}

export function memoryFirebaseCache(): FirebaseCache & { entries: Map<string, FirebaseCacheState> } {
  const entries = new Map<string, FirebaseCacheState>();
  const copy = (s: FirebaseCacheState) => JSON.parse(JSON.stringify(s)) as FirebaseCacheState;
  return {
    entries,
    async read(key) {
      const s = entries.get(key);
      return s ? copy(s) : null;
    },
    async write(key, state) {
      entries.set(key, copy(state));
    },
    async clear(key) {
      entries.delete(key);
    },
  };
}

const DB_NAME = "agentcrm-firebase-cache";
const STORE = "datasets";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

// IndexedDB cache of the admin. Any failure (private mode, quota) degrades
// to "no cache": the store then reads everything, as before 0.4.0.
export function indexedDbFirebaseCache(): FirebaseCache | null {
  if (typeof indexedDB === "undefined") return null;
  return {
    async read(key) {
      try {
        return ((await run("readonly", (s) => s.get(key))) as FirebaseCacheState | undefined) ?? null;
      } catch {
        return null;
      }
    },
    async write(key, state) {
      try {
        await run("readwrite", (s) => s.put(state, key));
      } catch {
        // Quota / private mode: next open reads everything.
      }
    },
    async clear(key) {
      try {
        await run("readwrite", (s) => s.delete(key));
      } catch {
        // Nothing to clear.
      }
    },
  };
}
