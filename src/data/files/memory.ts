// In-memory FileStore (memory backend: tests, CLI dry runs).

import type { FileStore } from "../types";
import { assertFileId } from "./ids";

export function createMemoryFileStore(initial?: Map<string, Uint8Array>): FileStore & { readonly blobs: Map<string, Uint8Array> } {
  const blobs = initial ?? new Map<string, Uint8Array>();
  return {
    kind: "memory",
    blobs,
    async put(id, bytes) {
      assertFileId(id);
      blobs.set(id, new Uint8Array(bytes));
    },
    async putMany(items) {
      for (const it of items) {
        assertFileId(it.id);
        blobs.set(it.id, new Uint8Array(it.bytes));
      }
    },
    async get(id) {
      const b = blobs.get(id);
      return b ? new Uint8Array(b) : null;
    },
    async delete(id) {
      blobs.delete(id);
    },
    async list() {
      return [...blobs.keys()].sort();
    },
  };
}
