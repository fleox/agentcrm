import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryConnector, type MemoryConnector } from "../../shared/storage/connectors/memory";
import { PassphraseError } from "../../shared/crypto";
import { createJournalStore, type JournalStoreOptions } from "./journalStore";

const ITER = 1000;

function client(connector: MemoryConnector, extra: Partial<JournalStoreOptions> = {}) {
  return createJournalStore({ connector, root: "crm", passphrase: "correct horse", iterations: ITER, ...extra });
}

const ada = { id: "r1", object: "people", fields: { name: "Ada", email: "ada@x.io" }, createdAt: 1, updatedAt: 1 };

afterEach(() => vi.useRealTimers());

describe("journal store", () => {
  it("writes encrypted segments + keyinfo and reads them back in a fresh client", async () => {
    const conn = createMemoryConnector();
    const a = client(conn);
    await a.ready();
    expect(a.list("records")).toEqual([]);
    await a.write([{ op: "set", collection: "records", doc: ada }]);
    await a.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.city": "London" } }]);

    const files = [...conn.files.keys()].sort();
    expect(files[0]).toBe("crm/journal/" + files[0].slice("crm/journal/".length));
    expect(files.filter((f) => f.startsWith("crm/journal/"))).toHaveLength(2);
    expect(files).toContain("crm/keyinfo.json");
    const keyinfo = JSON.parse(new TextDecoder().decode(conn.files.get("crm/keyinfo.json")!));
    expect(keyinfo).toMatchObject({ format: "agentcrm-journal", encrypted: true, kdf: { iterations: ITER } });
    // No plaintext personal data anywhere on the storage.
    for (const [path, bytes] of conn.files) {
      if (path.endsWith(".bin")) {
        expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("ACRMENC1");
        expect(Buffer.from(bytes).includes(Buffer.from("ada@x.io"))).toBe(false);
      }
    }

    const b = client(conn);
    await b.ready();
    expect(b.get("records", "r1")).toEqual({ ...ada, fields: { ...ada.fields, city: "London" } });
  });

  it("two clients editing different fields of the same record converge", async () => {
    const conn = createMemoryConnector();
    const a = client(conn, { clientId: "aaaa" });
    await a.ready();
    await a.write([{ op: "set", collection: "records", doc: ada }]);
    const b = client(conn, { clientId: "bbbb" });
    await b.ready();

    // Concurrent: neither has seen the other's edit.
    await a.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.name": "Ada Lovelace" } }]);
    await b.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.email": "ada@lovelace.io" } }]);
    await a.refresh();
    await b.refresh();
    const expected = { name: "Ada Lovelace", email: "ada@lovelace.io" };
    expect(a.get("records", "r1")!.fields).toEqual(expected);
    expect(b.get("records", "r1")!.fields).toEqual(expected);
  });

  it("same field edited concurrently: the later write (HLC) wins everywhere", async () => {
    const conn = createMemoryConnector();
    let wall = 1_000_000;
    const a = client(conn, { clientId: "aaaa", wallClock: () => wall });
    const b = client(conn, { clientId: "bbbb", wallClock: () => wall });
    await a.ready();
    await a.write([{ op: "set", collection: "records", doc: ada }]);
    await b.ready();
    wall += 10;
    await a.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.name": "from A" } }]);
    wall += 10;
    await b.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.name": "from B" } }]);
    await a.refresh();
    await b.refresh();
    expect(a.get("records", "r1")!.fields).toMatchObject({ name: "from B" });
    expect(b.get("records", "r1")!.fields).toMatchObject({ name: "from B" });
    // A third client sees the same.
    const c = client(conn);
    await c.ready();
    expect(c.get("records", "r1")!.fields).toMatchObject({ name: "from B" });
  });

  it("notifies subscribers of remote changes picked up by polling", async () => {
    const conn = createMemoryConnector();
    const a = client(conn, { pollIntervalMs: 20 });
    const b = client(conn);
    await a.ready();
    await b.ready();
    const seen: string[][] = [];
    const off = a.subscribe((c) => seen.push([...c]));
    await b.write([{ op: "set", collection: "activities", doc: { id: "act1", title: "Call" } }]);
    await vi.waitFor(() => expect(a.get("activities", "act1")).toBeTruthy(), { timeout: 2000 });
    expect(seen.some((c) => c.includes("activities"))).toBe(true);
    off();
  });

  it("compaction rewrites the snapshot, deletes merged segments and purges deleted records", async () => {
    const conn = createMemoryConnector();
    const a = client(conn);
    await a.ready();
    await a.write([{ op: "set", collection: "records", doc: ada }]);
    await a.write([{ op: "set", collection: "records", doc: { id: "r2", object: "people", fields: { name: "Bob", email: "bob@secret.io" } } }]);
    await a.write([{ op: "delete", collection: "records", id: "r2" }]);
    expect((await a.stats()).segments).toBe(3);

    await a.compact();
    const segments = [...conn.files.keys()].filter((k) => k.startsWith("crm/journal/"));
    expect(segments).toEqual([]);
    expect(conn.files.has("crm/snapshot.bin")).toBe(true);
    expect(a.list("records").map((r) => r.id)).toEqual(["r1"]);

    // Physically gone: decrypting every file never reveals Bob.
    const { decodeJson } = await import("./codec");
    const snapshot = await decodeJson<{ state: unknown }>(conn.files.get("crm/snapshot.bin")!, "correct horse");
    expect(JSON.stringify(snapshot)).not.toContain("bob@secret.io");
    expect(JSON.stringify(snapshot)).toContain("Ada");

    // A fresh client loads from the snapshot, then new segments on top.
    await a.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.city": "Paris" } }]);
    const b = client(conn);
    await b.ready();
    expect(b.list("records")).toHaveLength(1);
    expect(b.get("records", "r1")!.fields).toMatchObject({ name: "Ada", city: "Paris" });
    expect(await b.stats()).toMatchObject({ segments: 1, pendingSegments: 1, documents: 1, tombstones: 1 });
  });

  it("a client that listed segments before a compaction still converges", async () => {
    const conn = createMemoryConnector();
    const a = client(conn);
    await a.ready();
    await a.write([{ op: "set", collection: "records", doc: ada }]);
    const b = client(conn);
    // b lists the journal, then a compacts before b fetches the segment.
    const realGetBytes = conn.getBytes!.bind(conn);
    let compacted = false;
    conn.getBytes = async (path) => {
      if (!compacted && path.startsWith("crm/journal/")) {
        compacted = true;
        await a.compact();
      }
      return realGetBytes(path);
    };
    await b.ready();
    expect(b.get("records", "r1")).toEqual(ada);
  });

  it("a stale client compacting after a newer one never deletes data it hasn't merged", async () => {
    const conn = createMemoryConnector();
    const a = client(conn);
    const b = client(conn);
    await a.ready();
    await b.ready();
    await a.write([{ op: "set", collection: "records", doc: ada }]);
    await b.write([{ op: "set", collection: "records", doc: { id: "r3", object: "people", fields: { name: "Cy" } } }]);
    await a.compact();
    await b.compact();
    const c = client(conn);
    await c.ready();
    expect(c.list("records").map((r) => r.id).sort()).toEqual(["r1", "r3"]);
  });

  it("detects a missing or wrong passphrase", async () => {
    const conn = createMemoryConnector();
    const a = client(conn);
    await a.ready();
    await a.write([{ op: "set", collection: "records", doc: ada }]);
    await expect(client(conn, { passphrase: "nope" }).ready()).rejects.toMatchObject({ name: "PassphraseError", reason: "wrong" });
    await expect(client(conn, { passphrase: null }).ready()).rejects.toBeInstanceOf(PassphraseError);
    // A lazily supplied passphrase (UI prompt) works on retry.
    let pass: string | null = null;
    const lazy = client(conn, { passphrase: () => pass });
    await expect(lazy.ready()).rejects.toMatchObject({ reason: "missing" });
    pass = "correct horse";
    await lazy.ready();
    expect(lazy.get("records", "r1")).toEqual(ada);
  });

  it("supports unencrypted datasets and keeps an existing dataset's mode", async () => {
    const conn = createMemoryConnector();
    const a = client(conn, { encrypted: false, passphrase: null });
    await a.ready();
    await a.write([{ op: "set", collection: "settings", doc: { id: "general", name: "CRM" } }]);
    const seg = [...conn.files.entries()].find(([k]) => k.startsWith("crm/journal/"))![1];
    expect(seg[0]).toBe(0x1f); // gzip
    // Opening with encrypted: true doesn't need a passphrase: keyinfo says plain.
    const b = client(conn, { encrypted: true, passphrase: null });
    await b.ready();
    expect(b.get("settings", "general")).toEqual({ id: "general", name: "CRM" });
  });

  it("rolls back when the segment upload fails and skips no-op patches", async () => {
    const conn = createMemoryConnector();
    const a = client(conn);
    await a.ready();
    await a.write([{ op: "set", collection: "records", doc: ada }]);
    conn.failPut = () => new Error("403");
    await expect(a.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.name": "X" } }])).rejects.toThrow("403");
    expect(a.get("records", "r1")!.fields).toMatchObject({ name: "Ada" });
    conn.failPut = undefined;
    const before = conn.files.size;
    await a.write([{ op: "patch", collection: "records", id: "ghost", fields: { a: 1 } }]);
    expect(conn.files.size).toBe(before);
  });

  it("refuses connectors that can't list", () => {
    const conn = createMemoryConnector();
    conn.listPrefix = undefined;
    expect(() => client(conn)).toThrow(/can't list/);
  });
});
