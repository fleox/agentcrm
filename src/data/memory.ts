// "memory" store: the dataset lives in this process only. Used by tests,
// CLI dry runs (`--plan` previews) and as a scratch store for imports.

import { createStoreCore, snapshotFromDocs } from "./core";
import type { CollectionName, DataStore, StoreIdentity, StoredDoc } from "./types";

export interface MemoryStoreOptions {
  initial?: Partial<Record<CollectionName, StoredDoc[]>>;
  identity?: StoreIdentity | null;
  // Simulates a backend failure on the next persist (tests).
  failNextWrite?: () => Error | null;
}

export function createMemoryStore(opts: MemoryStoreOptions = {}): DataStore {
  return createStoreCore({
    kind: "memory",
    async load() {
      return snapshotFromDocs(opts.initial ?? {});
    },
    async persist() {
      const err = opts.failNextWrite?.();
      if (err) throw err;
    },
    async identity() {
      return opts.identity === undefined
        ? { uid: "local", email: "admin@localhost", displayName: "Admin", role: "admin" }
        : opts.identity;
    },
  });
}
