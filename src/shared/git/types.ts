// Shared git layer — used by the git-backed PUBLISH connectors (GitHub
// Pages, GitLab Pages, Cloudflare Pages via git) and by the Markdown
// DATA backend. One interface, three transports:
//
//   - github.ts  — REST Git Data API + GraphQL (batched blob reads)
//   - gitlab.ts  — REST v4 (multi-action commits are native)
//   - localFs.ts — File System Access API on a local folder (a git
//                  clone the user syncs with their own git client)
//
// All paths are repo-relative, no leading slash. Consumers that work in
// a sub-folder of the repo (`public/`, `content/`) prefix themselves.

export interface GitTreeEntry {
  path: string;
  // Content identity. Real git blob sha for remote transports; a
  // size+mtime fingerprint for the local folder transport. Only ever
  // compared for equality.
  sha: string;
  size?: number;
}

export interface GitTree {
  // Commit the tree belongs to (local transport: listing fingerprint).
  headSha: string;
  entries: GitTreeEntry[];
}

export type GitChange =
  | { type: "put"; path: string; content: string; encoding?: "utf-8" | "base64" }
  | { type: "delete"; path: string };

export interface GitCommitOptions {
  message: string;
  // When set, the commit is refused with GitConflictError if the branch
  // moved since this head (optimistic concurrency for the data backend).
  // When unset, the transport rebases onto the latest head and retries
  // (last-writer-wins — what a publish target wants).
  expectedHeadSha?: string;
}

export interface GitPermissions {
  login: string;
  canWrite: boolean;
  isAdmin: boolean;
  // Repository visibility when the host reports it (GitHub, GitLab).
  visibility?: "public" | "private" | "internal";
}

export interface GitTransport {
  readonly kind: "github" | "gitlab" | "local";
  // Human-readable "owner/repo@branch" for logs + UI.
  readonly label: string;

  headSha(): Promise<string>;
  // Every file (blobs only) at the current head, recursively.
  listTree(): Promise<GitTree>;
  // UTF-8 contents for many files at once. Missing paths are omitted
  // from the result. Pass the entries from listTree so transports can
  // read by sha (immutable → cacheable).
  readTexts(entries: GitTreeEntry[]): Promise<Map<string, string>>;
  // Raw bytes of one file (media / binary).
  readBytes(entry: GitTreeEntry): Promise<Uint8Array>;
  // Applies every change in ONE commit. Returns the new head sha.
  commit(changes: GitChange[], opts: GitCommitOptions): Promise<string>;
  permissions(): Promise<GitPermissions>;
  // Optional: replaces the branch with ONE parentless commit holding
  // exactly these files (history dropped). Refused with GitConflictError
  // when the head moved away from `expectedHeadSha`.
  resetBranch?(files: Array<{ path: string; content: string; encoding: "base64" }>, opts: { message: string; expectedHeadSha: string }): Promise<string>;
}

export class GitConflictError extends Error {
  constructor(
    message: string,
    public readonly currentHeadSha: string,
  ) {
    super(message);
    this.name = "GitConflictError";
  }
}

export type GitRemoteConfig =
  | {
      provider: "github";
      owner: string;
      repo: string;
      branch: string;
      token: string;
      // GitHub Enterprise: https://ghe.example.com/api/v3
      apiBaseUrl?: string;
    }
  | {
      provider: "gitlab";
      // "group/sub/repo" or numeric id.
      project: string;
      branch: string;
      token: string;
      // Self-managed: https://gitlab.example.com/api/v4
      apiBaseUrl?: string;
    };
