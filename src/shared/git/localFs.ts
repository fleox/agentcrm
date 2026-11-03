import { changeToBytes } from "./encoding";
import { GitConflictError, type GitChange, type GitCommitOptions, type GitTransport, type GitTree, type GitTreeEntry } from "./types";

// Local-folder transport (File System Access API — Chromium browsers).
// The folder is typically a git clone the user syncs with their own
// client (git pull / push, GitHub Desktop, VS Code…): the browser can't
// run git, so "commit" here simply writes the files. Same file layout
// as the remote transports, so a repo can be edited alternately through
// the hosted admin (API) and a local admin (clone).
//
// There are no blob shas: an entry's identity is `size:lastModified`,
// and the "head" is a fingerprint of the whole listing — enough for the
// polling + conflict checks the consumers do.

// Minimal structural types — the async-iterable part of the File System
// Access API isn't in the DOM lib this project compiles against.
interface DirHandle {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, DirHandle | FileHandle]>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  queryPermission?(desc: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(desc: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}
interface FileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: BufferSource | Blob | string): Promise<void>; close(): Promise<void> }>;
}

// Never surfaced as site / content files.
const IGNORED = new Set([".git", "node_modules", ".DS_Store", "Thumbs.db"]);

export function isLocalFolderSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

// Must run from a user gesture (click).
export async function pickLocalFolder(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as unknown as {
    showDirectoryPicker: (opts?: { mode?: "readwrite"; id?: string }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  return picker({ mode: "readwrite", id: "agentcrm" });
}

// Browsers drop the grant on reload; re-asking also needs a user gesture.
export async function ensureFolderPermission(handle: FileSystemDirectoryHandle, request: boolean): Promise<boolean> {
  const dir = handle as unknown as DirHandle;
  const desc = { mode: "readwrite" as const };
  if ((await dir.queryPermission?.(desc)) === "granted") return true;
  if (!request || !dir.requestPermission) return false;
  return (await dir.requestPermission(desc)) === "granted";
}

// FNV-1a — cheap, stable fingerprint of the listing.
function fingerprint(entries: GitTreeEntry[]): string {
  let h = 0x811c9dc5;
  for (const e of entries) {
    const line = `${e.path}\0${e.sha}\n`;
    for (let i = 0; i < line.length; i++) {
      h ^= line.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return `local-${entries.length}-${(h >>> 0).toString(16)}`;
}

export function createLocalFsTransport(handle: FileSystemDirectoryHandle): GitTransport {
  const root = handle as unknown as DirHandle;
  const files = new Map<string, FileHandle>();

  async function walk(dir: DirHandle, prefix: string, out: GitTreeEntry[]): Promise<void> {
    for await (const [name, child] of dir.entries()) {
      if (IGNORED.has(name)) continue;
      const path = prefix + name;
      if (child.kind === "directory") {
        await walk(child, path + "/", out);
      } else {
        const file = await child.getFile();
        files.set(path, child);
        out.push({ path, sha: `${file.size}:${file.lastModified}`, size: file.size });
      }
    }
  }

  async function listTree(): Promise<GitTree> {
    files.clear();
    const entries: GitTreeEntry[] = [];
    await walk(root, "", entries);
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { headSha: fingerprint(entries), entries };
  }

  async function fileHandle(path: string): Promise<FileHandle> {
    const cached = files.get(path);
    if (cached) return cached;
    const parts = path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    return dir.getFileHandle(parts[parts.length - 1]);
  }

  async function readTexts(entries: GitTreeEntry[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const e of entries) {
      try {
        out.set(e.path, await (await (await fileHandle(e.path)).getFile()).text());
      } catch {
        // Deleted since the listing — omitted, per the contract.
      }
    }
    return out;
  }

  async function readBytes(entry: GitTreeEntry): Promise<Uint8Array> {
    const file = await (await fileHandle(entry.path)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async function writeFile(path: string, bytes: Uint8Array): Promise<void> {
    const parts = path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
    const file = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await file.createWritable();
    await writable.write(bytes as Uint8Array<ArrayBuffer>);
    await writable.close();
    files.set(path, file);
  }

  async function removeFile(path: string): Promise<void> {
    const parts = path.split("/");
    try {
      let dir = root;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      await dir.removeEntry(parts[parts.length - 1]);
    } catch {
      // Already gone.
    }
    files.delete(path);
  }

  async function commit(changes: GitChange[], opts: GitCommitOptions): Promise<string> {
    if (opts.expectedHeadSha !== undefined) {
      const current = (await listTree()).headSha;
      if (current !== opts.expectedHeadSha) throw new GitConflictError("Folder changed on disk", current);
    }
    for (const change of changes) {
      if (change.type === "delete") await removeFile(change.path);
      else await writeFile(change.path, changeToBytes(change));
    }
    return (await listTree()).headSha;
  }

  return {
    kind: "local",
    label: root.name,
    headSha: async () => (await listTree()).headSha,
    listTree,
    readTexts,
    readBytes,
    commit,
    permissions: async () => ({
      login: "local",
      canWrite: await ensureFolderPermission(handle, false),
      isAdmin: true,
    }),
  };
}
