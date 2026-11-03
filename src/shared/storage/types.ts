// Contract every STORAGE connector implements (S3-compatible bucket,
// GitHub / GitLab repo, local folder, in-browser mirror). In AgentCRM a
// connector is used for two things:
//   - as the medium of the journal data backend (src/data/journal/):
//     encrypted snapshot + journal segments, read with get/getBytes and
//     listed with listPrefix();
//   - as a hosting target for files (the admin itself, config.js,
//     published lead forms) through the facade in shared/siteFiles.ts.
//
// Copied from cms-ia src/services/storage/types.ts (see SHARED.md);
// `listPrefix` is an AgentCRM addition.

export type StorageAction =
  | "upload"
  | "delete"
  | "rename"
  | "get"
  | "list"
  | "createFolder"
  | "renameFolder"
  | "deleteFolder"
  | "commit";

// Single error class for every connector. `status` is the HTTP status
// when there is one (501 is used for "capability not supported").
export class StorageError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

// How a connector applies writes:
//   - "files"      → each put/delete hits the target immediately (S3, local folder, …)
//   - "commit"     → writes are grouped into one commit (GitHub / GitLab / Cloudflare Pages via git)
//   - "deployment" → the whole site is re-deployed as a snapshot (Cloudflare Direct Upload, ZIP)
export type PublishModel = "files" | "commit" | "deployment";

export interface StorageCapabilities {
  // Paginated listing of every file on the target.
  list: boolean;
  // Native single-file rename. Emulated with get + put + delete otherwise.
  rename: boolean;
  renameFolder: boolean;
  // Explicit folders exist on the target. When false, createFolder is a no-op.
  folders: boolean;
  // Native recursive folder delete. Emulated with list + delete otherwise.
  deletePrefix: boolean;
}

export interface PutInput {
  path: string;
  // UTF-8 text, or base64 when encoding === "base64".
  content: string;
  encoding?: "utf-8" | "base64";
}

export type BatchOp =
  | ({ type: "put" } & PutInput)
  | { type: "delete"; path: string }
  | { type: "deletePrefix"; path: string };

export interface ListItem {
  path: string;
  type: "file" | "folder";
  size?: number;
  url?: string;
  depth?: number;
}

export interface ListResponse {
  items: ListItem[];
  page: number;
  per_page: number;
  total?: number;
}

export interface StorageConnector {
  id: string;
  model: PublishModel;
  capabilities: StorageCapabilities;

  put(input: PutInput, signal?: AbortSignal): Promise<void>;
  get(path: string): Promise<string>;
  // Raw bytes; null when the file doesn't exist (no error toast — used
  // to probe for files that may legitimately be missing, e.g. a SQLite
  // database on first install).
  getBytes?(path: string): Promise<Uint8Array | null>;
  // MUST resolve (not throw) when the file is already gone.
  delete(path: string, signal?: AbortSignal): Promise<void>;
  publicUrl(path: string): Promise<string>;

  deletePrefix?(path: string): Promise<void>;
  rename?(oldPath: string, newPath: string): Promise<void>;
  renameFolder?(oldPath: string, newPath: string): Promise<void>;
  createFolder?(path: string): Promise<void>;
  list?(page: number, perPage: number): Promise<ListResponse>;

  // Every file path (connector-relative, no leading slash) starting with
  // `prefix`, in lexicographic order. Unlike list() it is meant for
  // frequent polling of a small folder (the journal backend lists
  // `<root>/journal/` every 20 s), so implementations filter on the
  // target when they can (S3 ListObjectsV2 `prefix=`).
  listPrefix?(prefix: string): Promise<string[]>;

  // Required for "commit" / "deployment" models: applies every op
  // collected during a withStorageBatch() scope in one go. Ops are
  // already de-duplicated (last write per path wins).
  commitBatch?(ops: BatchOp[]): Promise<void>;
}
