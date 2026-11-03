// "local" store: single-user data kept in this browser's IndexedDB (mirror
// of cms-ia src/services/docstore/localStore.ts). No login, no server,
// works offline. Nobody else writes the data, so no polling. Data is tied
// to this browser profile: Settings → Export backs it up or moves it to
// another backend.

import { createKvStore } from "../shared/storage/kvStore";
import { createStoreCore, emptySnapshot } from "./core";
import { withFileStore } from "./files";
import { clearLocalFiles, createLocalFileStore } from "./files/local";
import { plainCopy } from "./patch";
import { isCollectionName, type CollectionName, type DataStore, type StoredDoc } from "./types";

export const LOCAL_DB_NAME = "agentcrm-local-data";

const keyOf = (collection: CollectionName, id: string) => `${collection}/${id}`;

export function createLocalStore(opts: { dbName?: string; filesDbName?: string } = {}): DataStore {
  const kv = createKvStore<StoredDoc>(opts.dbName ?? LOCAL_DB_NAME, "docs");
  const store = createStoreCore({
    kind: "local",

    async load() {
      const snapshot = emptySnapshot();
      for (const [key, doc] of await kv.entries()) {
        const collection = key.slice(0, key.indexOf("/"));
        if (isCollectionName(collection)) snapshot[collection].set(doc.id, Object.freeze(doc));
      }
      return snapshot;
    },

    async persist(mutations, _before, after) {
      const touched = new Map<string, { collection: CollectionName; id: string }>();
      for (const m of mutations) {
        const id = m.op === "set" ? m.doc.id : m.id;
        touched.set(keyOf(m.collection, id), { collection: m.collection, id });
      }
      for (const [key, { collection, id }] of touched) {
        const doc = after[collection].get(id);
        if (doc) await kv.set(key, plainCopy(doc));
        else await kv.delete(key);
      }
    },

    async identity() {
      return { uid: "local", email: "admin@localhost", displayName: "Local admin", role: "admin" };
    },
  });
  return withFileStore(store, createLocalFileStore({ dbName: opts.filesDbName }));
}

// Wipes the local dataset (Settings → danger zone, tests).
export async function clearLocalStore(dbName = LOCAL_DB_NAME): Promise<void> {
  await createKvStore<StoredDoc>(dbName, "docs").clear();
  await clearLocalFiles().catch(() => undefined);
}
