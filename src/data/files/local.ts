// "local" backend FileStore: blobs in this browser's IndexedDB (own
// database, so the docs database keeps its schema version).

import { createKvStore } from "../../shared/storage/kvStore";
import type { FileStore } from "../types";
import { assertFileId } from "./ids";

export const LOCAL_FILES_DB_NAME = "agentcrm-local-files";

export function createLocalFileStore(opts: { dbName?: string } = {}): FileStore {
  const kv = createKvStore<Uint8Array>(opts.dbName ?? LOCAL_FILES_DB_NAME, "files");
  return {
    kind: "local",
    async put(id, bytes) {
      assertFileId(id);
      await kv.set(id, new Uint8Array(bytes));
    },
    async putMany(items) {
      for (const it of items) {
        assertFileId(it.id);
        await kv.set(it.id, new Uint8Array(it.bytes));
      }
    },
    async get(id) {
      const v = await kv.get(id);
      if (!v) return null;
      return v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBufferLike);
    },
    async delete(id) {
      await kv.delete(id);
    },
    async list() {
      return (await kv.keys()).sort();
    },
  };
}

export async function clearLocalFiles(dbName = LOCAL_FILES_DB_NAME): Promise<void> {
  await createKvStore<Uint8Array>(dbName, "files").clear();
}
