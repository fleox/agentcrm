import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createMemoryConnector } from "../../shared/storage/connectors/memory";
import { createJournalStore } from "../journal/journalStore";
import { createGitJsonStoreWith } from "../gitJson/store";
import { createMemoryGitTransport, createMemoryRepo } from "../gitJson/memoryTransport";
import { createFirebaseStoreWith, firebaseFileStore, STORAGE_NOT_ENABLED } from "../firebase";
import { createMemoryFirebaseApi } from "../firebase/memoryApi";
import { createLocalStore } from "../local";
import { createMemoryStore } from "../memory";
import { fileStoreOf, FileStoreUnavailableError } from "./index";

const SECRET = new TextEncoder().encode("PASSPORT SCAN — Ada Lovelace — 1815-12-10 — very personal");

describe("file stores", () => {
  it("journal: encrypts blobs with the dataset key; nothing in plaintext on the connector", async () => {
    const conn = createMemoryConnector();
    const store = createJournalStore({ connector: conn, root: "crm", passphrase: "correct horse", iterations: 1000 });
    await store.ready();
    const files = fileStoreOf(store);
    await files.put("f1", SECRET, { name: "passport.txt", mime: "text/plain" });
    const raw = conn.files.get("crm/files/f1.bin")!;
    expect(raw).toBeDefined();
    expect(new TextDecoder().decode(raw.slice(0, 8))).toBe("ACRMENC1");
    for (const bytes of conn.files.values()) expect(Buffer.from(bytes).includes(Buffer.from("Lovelace"))).toBe(false);
    expect(new TextDecoder().decode((await files.get("f1"))!)).toContain("Ada Lovelace");
    expect(await files.list!()).toEqual(["f1"]);
    // Another client with the passphrase reads it; a wrong one can't.
    const other = createJournalStore({ connector: conn, root: "crm", passphrase: "correct horse" });
    await other.ready();
    expect((await fileStoreOf(other).get("f1"))!.length).toBe(SECRET.length);
    const wrong = createJournalStore({ connector: conn, root: "crm", passphrase: "nope" });
    await expect(fileStoreOf(wrong).get("f1")).rejects.toThrow();
    await files.delete("f1");
    await files.delete("f1");
    expect(await files.get("f1")).toBeNull();
    expect(() => files.put("../x", SECRET)).rejects.toThrow(/Invalid file id/);
  });

  it("journal: plain bytes for an unencrypted dataset", async () => {
    const conn = createMemoryConnector();
    const store = createJournalStore({ connector: conn, root: "", encrypted: false });
    await store.ready();
    await fileStoreOf(store).put("f2", SECRET);
    expect(Buffer.from(conn.files.get("files/f2.bin")!).equals(Buffer.from(SECRET))).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(conn.files.get("keyinfo.json")!))).toMatchObject({ encrypted: false });
  });

  it("memory and local (IndexedDB) stores", async () => {
    for (const store of [createMemoryStore(), createLocalStore({ dbName: "t-docs", filesDbName: "t-files" })]) {
      await store.ready();
      const files = fileStoreOf(store);
      await files.putMany!([
        { id: "a", bytes: SECRET },
        { id: "a_t", bytes: new Uint8Array([1, 2, 3]) },
      ]);
      expect((await files.get("a"))!.length).toBe(SECRET.length);
      expect(await files.list!()).toEqual(["a", "a_t"]);
      await files.delete("a");
      expect(await files.get("a")).toBeNull();
    }
  });

  it("git-json: blobs under files/<id>.bin, one commit per batch, no rebase needed after", async () => {
    const repo = createMemoryRepo();
    const transport = createMemoryGitTransport(repo);
    const store = createGitJsonStoreWith({ dir: "crm", openTransport: async () => transport });
    await store.identity();
    await store.ready();
    const files = fileStoreOf(store);
    await files.putMany!([
      { id: "f1", bytes: SECRET, meta: { name: "a.txt" } },
      { id: "f1_t", bytes: new Uint8Array([9]) },
    ]);
    expect(repo.commits).toHaveLength(1);
    expect(repo.files.has("crm/files/f1.bin")).toBe(true);
    expect(new TextDecoder().decode((await files.get("f1"))!)).toContain("Ada");
    // A data write right after reuses our head (no conflict / rebase).
    await store.write([{ op: "set", collection: "files", doc: { id: "f1", name: "a.txt", targets: [] } }]);
    expect(repo.commits).toHaveLength(2);
    expect(repo.files.has("crm/files/f1.json")).toBe(true);
    // The blob is not a document.
    expect(store.list("files").map((d) => d.id)).toEqual(["f1"]);
    expect(await files.list!()).toEqual(["f1", "f1_t"]);
    await files.delete("f1");
    expect(repo.files.has("crm/files/f1.bin")).toBe(false);
    expect(await files.get("f1")).toBeNull();
  });

  it("firebase: Firebase Storage files/<id>; clear error when Storage is not enabled", async () => {
    const api = createMemoryFirebaseApi({ user: { uid: "u", email: "a@b.io", displayName: "A", emailVerified: true } });
    const store = createFirebaseStoreWith({ api });
    const files = fileStoreOf(store);
    await files.put("f1", SECRET, { mime: "text/plain" });
    expect(api.objects.has("files/f1")).toBe(true);
    expect((await files.get("f1"))!.length).toBe(SECRET.length);
    await files.delete("f1");
    expect(await files.get("f1")).toBeNull();
    const noStorage = firebaseFileStore({ ...api, storage: undefined });
    await expect(noStorage.put("x", SECRET)).rejects.toBeInstanceOf(FileStoreUnavailableError);
    await expect(noStorage.get("x")).rejects.toThrow(STORAGE_NOT_ENABLED);
  });
});
