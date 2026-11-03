// In-memory git transport: a fake remote for tests and CLI dry runs.
// Several transports can share one repo object to simulate several
// users pushing to the same branch.

import { GitConflictError, type GitChange, type GitPermissions, type GitTransport, type GitTreeEntry } from "../../shared/git";
import { base64ToUtf8 } from "../../shared/git/encoding";

export interface MemoryRepo {
  head: string;
  files: Map<string, string>;
  commits: Array<{ sha: string; message: string; changes: GitChange[] }>;
}

export function createMemoryRepo(files: Record<string, string> = {}): MemoryRepo {
  return { head: "c0", files: new Map(Object.entries(files)), commits: [] };
}

function shaOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `b${(h >>> 0).toString(16)}-${text.length}`;
}

export interface MemoryTransportOptions {
  permissions?: Partial<GitPermissions>;
  kind?: GitTransport["kind"];
  // Called before each commit is applied (inject a concurrent push).
  beforeCommit?(repo: MemoryRepo): void;
}

export function createMemoryGitTransport(repo: MemoryRepo, opts: MemoryTransportOptions = {}): GitTransport & { reads: number } {
  const t = {
    kind: opts.kind ?? ("github" as const),
    label: "memory/repo@main",
    reads: 0,
    async headSha() {
      return repo.head;
    },
    async listTree() {
      const entries: GitTreeEntry[] = [...repo.files.entries()].map(([path, text]) => ({ path, sha: shaOf(text), size: text.length })).sort((a, b) => a.path.localeCompare(b.path));
      return { headSha: repo.head, entries };
    },
    async readTexts(entries: GitTreeEntry[]) {
      t.reads++;
      const out = new Map<string, string>();
      for (const e of entries) {
        const text = repo.files.get(e.path);
        if (text !== undefined) out.set(e.path, text);
      }
      return out;
    },
    async readBytes(entry: GitTreeEntry) {
      return new TextEncoder().encode(repo.files.get(entry.path) ?? "");
    },
    async commit(changes: GitChange[], o: { message: string; expectedHeadSha?: string }) {
      opts.beforeCommit?.(repo);
      if (o.expectedHeadSha && o.expectedHeadSha !== repo.head) throw new GitConflictError("Branch moved", repo.head);
      for (const c of changes) {
        if (c.type === "delete") repo.files.delete(c.path);
        else repo.files.set(c.path, c.encoding === "base64" ? base64ToUtf8(c.content) : c.content);
      }
      const sha = `c${repo.commits.length + 1}`;
      repo.commits.push({ sha, message: o.message, changes });
      repo.head = sha;
      return sha;
    },
    async permissions(): Promise<GitPermissions> {
      return { login: "octocat", canWrite: true, isAdmin: true, visibility: "private", ...opts.permissions };
    },
  };
  return t;
}
