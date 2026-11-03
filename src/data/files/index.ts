// File storage layer (images, attachments) — one FileStore per backend,
// exposed as `DataStore.files`:
//
//   journal   <root>/files/<id>.bin on the same connector, encrypted with
//             the dataset key (AES-256-GCM, same codec; plain when the
//             dataset is unencrypted)            → ./journal.ts
//   local     IndexedDB database "agentcrm-local-files"   → ./local.ts
//   git-json  files/<id>.bin in the data folder, one commit per upload
//             batch                                       → src/data/gitJson/store.ts
//   firebase  Firebase Storage files/<id> of the user's project
//                                                         → src/data/firebase.ts
//   memory    in-memory map (tests, CLI dry runs)         → ./memory.ts
//
// Metadata (name, mime, size, targets…) lives in the `files` collection
// (FileMeta, src/core/types.ts); src/ops/files.ts is the only writer.

import type { DataStore, FileStore } from "../types";

export { createMemoryFileStore } from "./memory";
export type { FileStore, FileBlobMeta } from "../types";

export { FILE_ID_RE, assertFileId } from "./ids";

export class FileStoreUnavailableError extends Error {
  constructor(message = "This data backend can't store files.") {
    super(message);
    this.name = "FileStoreUnavailableError";
  }
}

export function fileStoreOf(store: DataStore): FileStore {
  const files = store.files;
  if (!files) throw new FileStoreUnavailableError(`The "${store.kind}" data backend can't store files.`);
  return files;
}

// Attaches a FileStore to a store built by createStoreCore (the returned
// object is a plain object, so this is a simple property definition).
export function withFileStore<S extends DataStore>(store: S, files: FileStore): S {
  Object.defineProperty(store, "files", { value: files, enumerable: false, configurable: true });
  return store;
}
