import { describe, expect, it } from "vitest";
import { createMemoryConnector } from "../../shared/storage/connectors/memory";
import { PassphraseError } from "../../shared/crypto";
import { createJournalStore } from "./journalStore";
import { checkJournalPassphrase, rekeyJournal } from "./rekey";

const ITER = 1000;
const ada = { id: "r1", object: "people", fields: { name: "Ada" }, createdAt: 1, updatedAt: 1 };

async function seeded(passphrase: string | null) {
  const conn = createMemoryConnector();
  const s = createJournalStore({ connector: conn, root: "crm", passphrase, encrypted: !!passphrase, iterations: ITER });
  await s.ready();
  await s.write([{ op: "set", collection: "records", doc: ada }]);
  await s.write([{ op: "set", collection: "records", doc: { ...ada, id: "r2" } }]);
  return conn;
}

describe("journal rekey", () => {
  it("changes the passphrase: new opens, old is refused", async () => {
    const conn = await seeded("old secret");
    await rekeyJournal({ connector: conn, root: "crm", oldPassphrase: "old secret", newPassphrase: "new secret", iterations: ITER });
    expect([...conn.files.keys()].some((k) => k.includes("rekey-backup"))).toBe(false);
    expect(await checkJournalPassphrase(conn, "crm", "new secret")).toEqual({ exists: true, encrypted: true, ok: true });
    expect((await checkJournalPassphrase(conn, "crm", "old secret")).ok).toBe(false);
    const s = createJournalStore({ connector: conn, root: "crm", passphrase: "new secret" });
    await s.ready();
    expect(s.list("records")).toHaveLength(2);
    const old = createJournalStore({ connector: conn, root: "crm", passphrase: "old secret" });
    await expect(old.ready()).rejects.toBeInstanceOf(PassphraseError);
  });

  it("turns encryption off and on again", async () => {
    const conn = await seeded("pw");
    await rekeyJournal({ connector: conn, root: "crm", oldPassphrase: "pw", newPassphrase: null });
    expect(await checkJournalPassphrase(conn, "crm", null)).toEqual({ exists: true, encrypted: false, ok: true });
    const plain = createJournalStore({ connector: conn, root: "crm", passphrase: null });
    await plain.ready();
    expect(plain.list("records")).toHaveLength(2);
    await rekeyJournal({ connector: conn, root: "crm", oldPassphrase: null, newPassphrase: "again", iterations: ITER });
    const enc = createJournalStore({ connector: conn, root: "crm", passphrase: "again" });
    await enc.ready();
    expect(enc.get("records", "r1")).toMatchObject({ fields: { name: "Ada" } });
  });

  it("refuses a wrong old passphrase without touching the files", async () => {
    const conn = await seeded("pw");
    const before = new Map(conn.files);
    await expect(rekeyJournal({ connector: conn, root: "crm", oldPassphrase: "nope", newPassphrase: "x" })).rejects.toBeInstanceOf(PassphraseError);
    expect([...conn.files.keys()].sort()).toEqual([...before.keys()].sort());
  });

  it("reports a missing dataset", async () => {
    expect(await checkJournalPassphrase(createMemoryConnector(), "crm", "x")).toEqual({ exists: false, encrypted: false, ok: true });
  });
});
