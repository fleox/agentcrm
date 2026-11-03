import { getActiveStorageConnector } from "./registry";
import type { BatchOp, PutInput, StorageConnector } from "./types";

// Write batching for "commit" / "deployment" connectors.
//
// withStorageBatch(fn) opens a scope: while it's open, the facade stages
// every upload / delete / deleteFolder instead of sending it, and the
// whole set is applied with ONE connector.commitBatch() call when the
// outermost scope exits. On a git-backed target that means one commit
// (and one Pages build) per publish instead of one per file.
//
// For "files" connectors (no commitBatch) the scope is a pass-through —
// writes go out immediately, exactly as before batching existed.
//
// Scopes nest and overlap: a single batch is shared by every scope open
// at the same time (e.g. publishPost → regenerateListings, or a publish
// started while a regeneration is running) and is committed when the
// last one exits. That's what keeps nested publisher calls atomic.

export interface OpenBatch {
  connector: StorageConnector;
  depth: number;
  // Last op per path wins.
  files: Map<string, Extract<BatchOp, { type: "put" | "delete" }>>;
  prefixes: Set<string>;
}

let open: OpenBatch | null = null;

function normalizePrefix(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

export function currentBatch(): OpenBatch | null {
  return open;
}

export function stagePut(batch: OpenBatch, input: PutInput): void {
  batch.files.set(input.path, { type: "put", ...input });
}

export function stageDelete(batch: OpenBatch, path: string): void {
  batch.files.set(path, { type: "delete", path });
}

export function stageDeletePrefix(batch: OpenBatch, path: string): void {
  const prefix = normalizePrefix(path);
  for (const key of [...batch.files.keys()]) {
    if (isUnder(key, prefix)) batch.files.delete(key);
  }
  batch.prefixes.add(prefix);
}

// Read-your-writes inside a batch. Returns:
//   - { kind: "content" } when the path was uploaded in this batch
//   - { kind: "deleted" } when it was deleted (directly or via a prefix)
//   - null when the batch doesn't know — read from the connector.
export function readStaged(
  batch: OpenBatch,
  path: string,
): { kind: "content"; content: string } | { kind: "deleted" } | null {
  const op = batch.files.get(path);
  if (op?.type === "put") {
    if (op.encoding !== "base64") return { kind: "content", content: op.content };
    const bytes = Uint8Array.from(atob(op.content), (c) => c.charCodeAt(0));
    return { kind: "content", content: new TextDecoder().decode(bytes) };
  }
  if (op?.type === "delete") return { kind: "deleted" };
  for (const prefix of batch.prefixes) {
    if (isUnder(path, prefix)) return { kind: "deleted" };
  }
  return null;
}

// Prefix deletes first, then per-file ops. A file staged after a
// prefix delete survives because stageDeletePrefix already dropped the
// ones staged before it.
function collectOps(batch: OpenBatch): BatchOp[] {
  const ops: BatchOp[] = [];
  for (const path of batch.prefixes) ops.push({ type: "deletePrefix", path });
  for (const op of batch.files.values()) ops.push(op);
  return ops;
}

// ─── Implicit batching ───────────────────────────────────────────────────
//
// Writes made OUTSIDE withStorageBatch (theme asset sync, plugin
// regenerations, external plugins…) would otherwise produce one commit
// — and one Pages build — per file on "commit" connectors. They are
// staged into an implicit batch instead and committed once the writes
// stop for IMPLICIT_IDLE_MS. The write call resolves as soon as it is
// staged; a failed commit is reported by the connector's error toast.
// "files" connectors never use this — they keep writing immediately.

export const IMPLICIT_IDLE_MS = 1500;

let implicit: (OpenBatch & { timer: ReturnType<typeof setTimeout> | null; flushing: Promise<void> | null }) | null =
  null;

function scheduleImplicitFlush(): void {
  if (!implicit) return;
  if (implicit.timer) clearTimeout(implicit.timer);
  implicit.timer = setTimeout(() => void flushImplicitBatch(), IMPLICIT_IDLE_MS);
}

export function implicitBatchFor(connector: StorageConnector): OpenBatch {
  if (!implicit || implicit.connector !== connector) {
    implicit = { connector, depth: 0, files: new Map(), prefixes: new Set(), timer: null, flushing: null };
  }
  scheduleImplicitFlush();
  return implicit;
}

export function pendingImplicitBatch(): OpenBatch | null {
  return implicit;
}

export async function flushImplicitBatch(): Promise<void> {
  const batch = implicit;
  if (!batch) return;
  if (batch.timer) clearTimeout(batch.timer);
  implicit = null;
  const ops = collectOps(batch);
  if (ops.length === 0) return;
  try {
    await batch.connector.commitBatch!(ops);
  } catch (err) {
    console.error("[storage] deferred commit failed:", err);
  }
}

// Don't lose staged writes when the tab closes before the idle flush.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", (e) => {
    if (implicit && (implicit.files.size > 0 || implicit.prefixes.size > 0)) {
      void flushImplicitBatch();
      e.preventDefault();
    }
  });
}

export async function withStorageBatch<T>(fn: () => Promise<T>): Promise<T> {
  const connector = await getActiveStorageConnector();
  if (!connector.commitBatch) return fn();
  // Earlier deferred writes go out first, so commits stay in order.
  await flushImplicitBatch();

  if (!open) open = { connector, depth: 0, files: new Map(), prefixes: new Set() };
  const batch = open;
  batch.depth++;

  let failed = false;
  let error: unknown;
  let result: T | undefined;
  try {
    result = await fn();
  } catch (err) {
    failed = true;
    error = err;
  }

  batch.depth--;
  if (batch.depth === 0) {
    open = null;
    const ops = collectOps(batch);
    // Commit even when fn threw: the publisher persists per-file state
    // (lastPublishedPath, hashes) as it goes, so dropping the writes
    // that DID succeed would desync that state from the public site.
    // Same partial-success semantics as the "files" model.
    if (ops.length > 0) {
      try {
        await batch.connector.commitBatch!(ops);
      } catch (commitErr) {
        if (!failed) throw commitErr;
        console.error("[storage] batch commit failed after an earlier error:", commitErr);
      }
    }
  }

  if (failed) throw error;
  return result as T;
}
