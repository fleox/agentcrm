// Journal backend FileStore: <root>/files/<id>.bin on the dataset's
// connector, encrypted with the dataset key (AES-256-GCM, the journal
// codec's format `ACRMENC1|iter|salt|iv|ct`) — plain bytes only when the
// dataset itself is unencrypted. The bucket / repo / folder is never
// assumed public: files are always read back through the connector.

import { decryptBytes, encryptBytes, isEncrypted } from "../../shared/crypto";
import { bytesToBase64 } from "../../shared/git/encoding";
import type { StorageConnector } from "../../shared/storage/types";
import type { FileStore } from "../types";
import type { CodecKey } from "../journal/codec";
import { assertFileId } from "./ids";

export interface JournalFileStoreOptions {
  connector: StorageConnector;
  // "<root>/files/"
  folder: string;
  // Current dataset key (null = unencrypted dataset). Called per op: the
  // key is only known after the store loaded.
  key(): Promise<CodecKey | null>;
  passphrase(): string | null;
}

export function createJournalFileStore(opts: JournalFileStoreOptions): FileStore {
  const { connector, folder } = opts;
  const path = (id: string) => `${folder}${id}.bin`;
  async function encode(bytes: Uint8Array): Promise<Uint8Array> {
    const key = await opts.key();
    return key ? encryptBytes(bytes, key.passphrase, key.params) : bytes;
  }
  const put = async (id: string, bytes: Uint8Array) => {
    assertFileId(id);
    const data = await encode(bytes);
    await connector.put({ path: path(id), content: bytesToBase64(data), encoding: "base64" });
  };
  return {
    kind: "journal",
    put,
    async putMany(items) {
      for (const it of items) await put(it.id, it.bytes);
    },
    async get(id) {
      assertFileId(id);
      const bytes = await connector.getBytes!(path(id));
      if (!bytes) return null;
      return isEncrypted(bytes) ? decryptBytes(bytes, opts.passphrase()) : bytes;
    },
    async delete(id) {
      assertFileId(id);
      await connector.delete(path(id));
    },
    async list() {
      if (!connector.listPrefix) return [];
      return (await connector.listPrefix(folder)).filter((p) => p.endsWith(".bin")).map((p) => p.slice(folder.length, -".bin".length)).filter((id) => !id.includes("/"));
    },
  };
}
