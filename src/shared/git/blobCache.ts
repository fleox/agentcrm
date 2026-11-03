// Content cache keyed by blob sha. Git blobs are immutable, so a cached
// entry never goes stale — after the first boot only changed files are
// downloaded again. Persists in IndexedDB when available (browser),
// falls back to memory (Node / private windows / blocked storage).

const DB_NAME = "agentcrm-git-blobs";
const STORE = "texts";

const memory = new Map<string, string>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function getCachedTexts(shas: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const sha of shas) {
    const hit = memory.get(sha);
    if (hit !== undefined) out.set(sha, hit);
    else missing.push(sha);
  }
  if (missing.length === 0) return out;
  const db = await openDb();
  if (!db) return out;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      for (const sha of missing) {
        const req = store.get(sha);
        req.onsuccess = () => {
          if (typeof req.result === "string") {
            out.set(sha, req.result);
            memory.set(sha, req.result);
          }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  return out;
}

export async function putCachedTexts(entries: Map<string, string>): Promise<void> {
  for (const [sha, text] of entries) memory.set(sha, text);
  const db = await openDb();
  if (!db || entries.size === 0) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const [sha, text] of entries) store.put(text, sha);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
