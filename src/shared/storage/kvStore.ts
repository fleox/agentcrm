// Tiny promise-based key/value store over one IndexedDB object store,
// with an in-memory fallback (Node tests, private windows, blocked
// storage). Used by the browser-mirror publish connector and the local
// data backend.

export interface KvStore<V> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  entries(): Promise<Array<[string, V]>>;
  clear(): Promise<void>;
}

export function createKvStore<V>(dbName: string, storeName = "kv"): KvStore<V> {
  const memory = new Map<string, V>();
  let dbPromise: Promise<IDBDatabase | null> | null = null;

  function db(): Promise<IDBDatabase | null> {
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          if (typeof indexedDB === "undefined") return resolve(null);
          const req = indexedDB.open(dbName, 1);
          req.onupgradeneeded = () => req.result.createObjectStore(storeName);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return dbPromise;
  }

  function run<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T> | void,
  ): Promise<T | undefined> {
    return db().then(
      (d) =>
        new Promise<T | undefined>((resolve, reject) => {
          if (!d) return resolve(undefined);
          const tx = d.transaction(storeName, mode);
          const req = fn(tx.objectStore(storeName));
          tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        }),
    );
  }

  return {
    async get(key) {
      if (!(await db())) return memory.get(key);
      return run<V>("readonly", (s) => s.get(key) as IDBRequest<V>);
    },
    async set(key, value) {
      if (!(await db())) return void memory.set(key, value);
      await run("readwrite", (s) => void s.put(value, key));
    },
    async delete(key) {
      if (!(await db())) return void memory.delete(key);
      await run("readwrite", (s) => void s.delete(key));
    },
    async keys() {
      if (!(await db())) return [...memory.keys()];
      return ((await run<IDBValidKey[]>("readonly", (s) => s.getAllKeys())) ?? []).map(String);
    },
    async entries() {
      if (!(await db())) return [...memory.entries()];
      // One cursor in one transaction, so keys and values can't drift
      // apart under a concurrent write.
      const out: Array<[string, V]> = [];
      await run("readonly", (s) => {
        const req = s.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          out.push([String(cursor.key), cursor.value as V]);
          cursor.continue();
        };
      });
      return out;
    },
    async clear() {
      if (!(await db())) return void memory.clear();
      await run("readwrite", (s) => void s.clear());
    },
  };
}
