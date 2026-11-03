import { base64ToBytes, bytesToBase64 } from "../../git/encoding";
import { StorageError, type ListItem, type StorageConnector } from "../types";

// In-memory connector for tests and CLI dry runs (not registered in the
// registry). Several stores can share one instance to simulate several
// clients on the same bucket. Optional `latencyMs` and `failPut` hooks
// help exercising races and failures.

export interface MemoryConnector extends StorageConnector {
  files: Map<string, Uint8Array>;
  failPut?: (path: string) => Error | null;
  failDelete?: (path: string) => Error | null;
}

export function createMemoryConnector(opts: { id?: string; latencyMs?: number } = {}): MemoryConnector {
  const files = new Map<string, Uint8Array>();
  const norm = (p: string) => p.replace(/^\/+/, "");
  const wait = () => (opts.latencyMs ? new Promise((r) => setTimeout(r, opts.latencyMs)) : Promise.resolve());

  const connector: MemoryConnector = {
    id: opts.id ?? "memory",
    model: "files",
    capabilities: { list: true, rename: false, renameFolder: false, folders: false, deletePrefix: true },
    files,

    async put(input) {
      await wait();
      const err = connector.failPut?.(norm(input.path));
      if (err) throw err;
      files.set(norm(input.path), input.encoding === "base64" ? base64ToBytes(input.content) : new TextEncoder().encode(input.content));
    },
    async get(path) {
      await wait();
      const bytes = files.get(norm(path));
      if (!bytes) throw new StorageError(`File not found: ${path}`, 404);
      return new TextDecoder().decode(bytes);
    },
    async getBytes(path) {
      await wait();
      const bytes = files.get(norm(path));
      return bytes ? new Uint8Array(bytes) : null;
    },
    async delete(path) {
      await wait();
      const err = connector.failDelete?.(norm(path));
      if (err) throw err;
      files.delete(norm(path));
    },
    async deletePrefix(path) {
      const prefix = norm(path).replace(/\/+$/, "") + "/";
      for (const k of [...files.keys()]) if (k.startsWith(prefix)) files.delete(k);
    },
    async list(page, perPage) {
      const all: ListItem[] = [...files.keys()].sort().map((path) => ({ path, type: "file" as const, size: files.get(path)!.length }));
      return { items: all.slice((page - 1) * perPage, page * perPage), page, per_page: perPage, total: all.length };
    },
    async listPrefix(prefix) {
      await wait();
      const p = norm(prefix);
      return [...files.keys()].filter((k) => k.startsWith(p)).sort();
    },
    async publicUrl(path) {
      return `memory://${norm(path)}`;
    },
  };
  return connector;
}

export function readMemoryText(connector: MemoryConnector, path: string): string | null {
  const bytes = connector.files.get(path);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

export { bytesToBase64 };
