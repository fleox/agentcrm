// Storage facade — the entry point feature code uses to write HOSTED
// files (the admin itself, config.js, published lead forms). It routes
// every call to the active hosting connector (shared/storage/registry.ts,
// configured with setStorageConfigSource()) and:
//
//   - emulates capabilities the connector lacks (deleteFolder via
//     list + delete, renameFile via get + put + delete, createFolder as
//     a no-op on targets without real folders);
//   - stages writes into the open batch when the connector applies
//     changes as commits / deployments (services/storage/batch.ts).
//
// Connectors funnel HTTP + network failures through storage/http.ts →
// translated toast + thrown StorageError. 404 on delete / deleteFolder
// stays silent (already-gone == desired state); AbortError is never
// toasted. Copied from cms-ia src/services/siteFiles.ts (see SHARED.md);
// the data backends never use this facade — they hold their own
// connector instance.

import {
  currentBatch,
  implicitBatchFor,
  pendingImplicitBatch,
  readStaged,
  stageDelete,
  stageDeletePrefix,
  stagePut,
} from "./storage/batch";
import { bytesToBase64 } from "./git/encoding";
import { unsupported } from "./storage/http";
import { getActiveStorageConnector } from "./storage/registry";
import {
  StorageError,
  type ListResponse,
  type StorageCapabilities,
  type PublishModel,
} from "./storage/types";

export { StorageError };
export { withStorageBatch } from "./storage/batch";
export type { ListItem, ListResponse } from "./storage/types";

export interface UploadFileOptions {
  path: string;
  // Either a UTF-8 string (for HTML/CSS/JS/text/JSON/...) or pre-encoded base64.
  content: string;
  encoding?: "utf-8" | "base64";
  signal?: AbortSignal;
}

// What the active connector can do natively + how it applies writes.
// UI that depends on optional features (file browser, rename
// tools) checks this before offering them.
export async function getStorageCapabilities(): Promise<
  StorageCapabilities & { connectorId: string; model: PublishModel }
> {
  const connector = await getActiveStorageConnector();
  return { ...connector.capabilities, connectorId: connector.id, model: connector.model };
}

// Outside an explicit batch, "commit" connectors stage into the
// implicit batch (one commit once writes stop — see batch.ts).
async function batchForWrite() {
  const batch = currentBatch();
  if (batch) return { batch, connector: null };
  const connector = await getActiveStorageConnector();
  return { batch: connector.commitBatch ? implicitBatchFor(connector) : null, connector };
}

export async function uploadFile(opts: UploadFileOptions): Promise<void> {
  const input = { path: opts.path, content: opts.content, encoding: opts.encoding };
  const { batch, connector } = await batchForWrite();
  if (batch) {
    stagePut(batch, input);
    return;
  }
  await connector!.put(input, opts.signal);
}

// Reads bytes from a File and returns a base64 string (without the data: prefix).
// Used for binary uploads (images, PDFs, fonts).
export function fileToBase64(file: File): Promise<string> {
  // Node (the agentcrm CLI) has File but no FileReader.
  if (typeof FileReader === "undefined") {
    return file.arrayBuffer().then((buf) => bytesToBase64(new Uint8Array(buf)));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected FileReader result type"));
        return;
      }
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export async function deleteFile(path: string, signal?: AbortSignal): Promise<void> {
  const { batch, connector } = await batchForWrite();
  if (batch) {
    stageDelete(batch, path);
    return;
  }
  await connector!.delete(path, signal);
}

export async function getFile(path: string): Promise<string> {
  for (const batch of [currentBatch(), pendingImplicitBatch()]) {
    if (!batch) continue;
    const staged = readStaged(batch, path);
    if (staged?.kind === "content") return staged.content;
    if (staged?.kind === "deleted") throw new StorageError(`File not found: ${path}`, 404);
  }
  const connector = await getActiveStorageConnector();
  return connector.get(path);
}

export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  const connector = await getActiveStorageConnector();
  if (connector.rename && !currentBatch()) {
    await connector.rename(oldPath, newPath);
    return;
  }
  // Emulation: text files only (getFile returns a UTF-8 string). Every
  // current caller renames Markdown / JSON files.
  const content = await getFile(oldPath);
  await uploadFile({ path: newPath, content });
  await deleteFile(oldPath);
}

export async function listFilesUnder(prefix: string): Promise<string[]> {
  const connector = await getActiveStorageConnector();
  if (connector.listPrefix) return connector.listPrefix(prefix);
  if (!connector.list) throw unsupported("list", connector.id);
  const out: string[] = [];
  const perPage = 500;
  for (let page = 1; ; page++) {
    const res = await connector.list(page, perPage);
    for (const item of res.items) if (item.type === "file" && item.path.startsWith(prefix)) out.push(item.path);
    if (res.items.length < perPage || (res.total !== undefined && page * perPage >= res.total)) break;
  }
  return out.sort();
}

export async function listFiles(page = 1, perPage = 100): Promise<ListResponse> {
  const connector = await getActiveStorageConnector();
  if (!connector.list) throw unsupported("list", connector.id);
  return connector.list(page, perPage);
}

export async function createFolder(path: string): Promise<void> {
  const connector = await getActiveStorageConnector();
  // Object stores / git trees have no empty folders — the first file
  // written under the path creates it implicitly.
  if (!connector.capabilities.folders || !connector.createFolder) return;
  await connector.createFolder(path);
}

export async function renameFolder(oldPath: string, newPath: string): Promise<void> {
  const connector = await getActiveStorageConnector();
  if (!connector.renameFolder) throw unsupported("renameFolder", connector.id);
  await connector.renameFolder(oldPath, newPath);
}

export async function deleteFolder(path: string): Promise<void> {
  const { batch, connector: direct } = await batchForWrite();
  if (batch) {
    stageDeletePrefix(batch, path);
    return;
  }
  const connector = direct!;
  if (connector.deletePrefix) {
    await connector.deletePrefix(path);
    return;
  }
  if (!connector.list) throw unsupported("deleteFolder", connector.id);
  // Emulation: walk the listing, collect files under the prefix, then
  // delete them (collect first so deletions don't shift pagination).
  const prefix = path.replace(/^\/+|\/+$/g, "") + "/";
  const perPage = 100;
  const targets: string[] = [];
  for (let page = 1; ; page++) {
    const res = await connector.list(page, perPage);
    for (const item of res.items) {
      if (item.type === "file" && item.path.replace(/^\/+/, "").startsWith(prefix)) {
        targets.push(item.path);
      }
    }
    if (res.items.length < perPage) break;
    if (res.total !== undefined && page * perPage >= res.total) break;
  }
  for (const target of targets) await connector.delete(target);
}

// Convenience: build the public URL for a path on the publish target.
export async function publicUrlFor(path: string): Promise<string> {
  const connector = await getActiveStorageConnector();
  return connector.publicUrl(path);
}
