import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { BatchOp, ListItem, StorageConnector } from "../../src/shared/storage/types";

// A folder of this computer as a storage connector (Node only). The
// browser's "local-folder" connector works on a File System Access
// handle; the CLI reads and writes the same folder through node:fs.

export function createFsConnector(settings: { path?: unknown; id?: string }): StorageConnector {
  const raw = typeof settings.path === "string" ? settings.path.trim() : "";
  if (!raw) throw new Error("local-folder: settings.path (absolute folder) is required.");
  const root = resolve(raw);
  const abs = (p: string) => {
    const file = resolve(root, p.replace(/^\/+/, ""));
    if (file !== root && !file.startsWith(root + sep)) throw new Error(`Path escapes the folder: ${p}`);
    return file;
  };
  const walk = (dir: string): string[] =>
    existsSync(dir)
      ? readdirSync(dir).flatMap((name) => {
          const p = join(dir, name);
          return statSync(p).isDirectory() ? walk(p) : [p];
        })
      : [];
  const rel = (file: string) => relative(root, file).split(sep).join("/");

  const connector: StorageConnector = {
    id: settings.id ?? "local-folder",
    model: "files",
    capabilities: { list: true, rename: false, renameFolder: false, folders: true, deletePrefix: true },
    async put(input) {
      const file = abs(input.path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, input.encoding === "base64" ? Buffer.from(input.content, "base64") : input.content);
    },
    async get(path) {
      return readFileSync(abs(path), "utf8");
    },
    async getBytes(path) {
      const file = abs(path);
      return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
    },
    async delete(path) {
      const file = abs(path);
      if (existsSync(file)) unlinkSync(file);
    },
    async deletePrefix(path) {
      rmSync(abs(path), { recursive: true, force: true });
    },
    async list(page, perPage) {
      const all: ListItem[] = walk(root).map((f) => ({ path: rel(f), type: "file" as const, size: statSync(f).size })).sort((a, b) => a.path.localeCompare(b.path));
      return { items: all.slice((page - 1) * perPage, page * perPage), page, per_page: perPage, total: all.length };
    },
    async listPrefix(prefix) {
      const p = prefix.replace(/^\/+/, "");
      return walk(root).map(rel).filter((f) => f.startsWith(p)).sort();
    },
    async publicUrl(path) {
      return pathToFileURL(abs(path)).href;
    },
    async commitBatch(ops: BatchOp[]) {
      for (const op of ops) {
        if (op.type === "put") await connector.put(op);
        else if (op.type === "delete") await connector.delete(op.path);
        else await connector.deletePrefix!(op.path);
      }
    },
  };
  return connector;
}
