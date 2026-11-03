import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { clearLocalStore, createLocalStore } from "./local";

describe("local (IndexedDB) store", () => {
  it("persists set / patch / delete across instances", async () => {
    const dbName = "agentcrm-test-local";
    await clearLocalStore(dbName);
    const a = createLocalStore({ dbName });
    await a.ready();
    await a.write([
      { op: "set", collection: "records", doc: { id: "r1", object: "people", fields: { name: "Ada" } } },
      { op: "set", collection: "settings", doc: { id: "general", name: "CRM" } },
    ]);
    await a.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.email": "ada@x.io" } }]);
    await a.write([{ op: "delete", collection: "settings", id: "general" }]);

    const b = createLocalStore({ dbName });
    await b.ready();
    expect(b.get("records", "r1")).toEqual({ id: "r1", object: "people", fields: { name: "Ada", email: "ada@x.io" } });
    expect(b.list("settings")).toEqual([]);
    expect(await b.identity()).toMatchObject({ role: "admin" });
  });
});
