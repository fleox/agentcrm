import { describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "./memory";
import { applyMutations, emptySnapshot } from "./core";
import type { CollectionName } from "./types";

describe("store core", () => {
  it("reads synchronously after ready, freezes docs", async () => {
    const store = createMemoryStore({ initial: { records: [{ id: "r1", fields: { a: 1 } }] } });
    expect(store.list("records")).toEqual([]);
    await store.ready();
    const r = store.get("records", "r1")!;
    expect(r.fields).toEqual({ a: 1 });
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.fields)).toBe(true);
  });

  it("set / patch per field with dot paths / delete, notifying collections", async () => {
    const store = createMemoryStore();
    await store.ready();
    const seen: CollectionName[][] = [];
    store.subscribe((c) => seen.push([...c]));
    await store.write([{ op: "set", collection: "records", doc: { id: "r1", fields: { a: 1, b: 2 }, x: undefined } }]);
    expect(store.get("records", "r1")).toEqual({ id: "r1", fields: { a: 1, b: 2 } });
    await store.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.b": 3, "fields.c": "new", top: true } }]);
    expect(store.get("records", "r1")).toEqual({ id: "r1", fields: { a: 1, b: 3, c: "new" }, top: true });
    await store.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.a": undefined, id: "hijack" } }]);
    expect(store.get("records", "r1")).toEqual({ id: "r1", fields: { b: 3, c: "new" }, top: true });
    await store.write([{ op: "patch", collection: "records", id: "missing", fields: { a: 1 } }]);
    expect(store.get("records", "missing")).toBeUndefined();
    await store.write([{ op: "delete", collection: "records", id: "r1" }]);
    expect(store.list("records")).toEqual([]);
    expect(seen).toEqual([["records"], ["records"], ["records"], ["records"]]);
  });

  it("rolls back only the failed write and rethrows", async () => {
    let fail = false;
    const store = createMemoryStore({
      initial: { records: [{ id: "r1", v: 1 }] },
      failNextWrite: () => (fail ? ((fail = false), new Error("disk full")) : null),
    });
    await store.ready();
    const listener = vi.fn();
    store.subscribe(listener);
    fail = true;
    const p = store.write([
      { op: "patch", collection: "records", id: "r1", fields: { v: 2 } },
      { op: "set", collection: "activities", doc: { id: "a1" } },
    ]);
    // Optimistic: visible before the persist settles.
    expect(store.get("records", "r1")!.v).toBe(2);
    await expect(p).rejects.toThrow("disk full");
    expect(store.get("records", "r1")!.v).toBe(1);
    expect(store.get("activities", "a1")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("validates mutations", async () => {
    const store = createMemoryStore();
    await expect(store.write([{ op: "set", collection: "nope" as CollectionName, doc: { id: "x" } }])).rejects.toThrow(/Unknown collection/);
    await expect(store.write([{ op: "set", collection: "records", doc: { id: "" } }])).rejects.toThrow(/without an id/);
  });

  it("applyMutations does not touch the base snapshot", () => {
    const base = emptySnapshot();
    const { next, changed } = applyMutations(base, [{ op: "set", collection: "users", doc: { id: "u" } }]);
    expect(base.users.size).toBe(0);
    expect(next.users.size).toBe(1);
    expect([...changed]).toEqual(["users"]);
  });
});
