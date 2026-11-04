import { describe, expect, it } from "vitest";
import { assembleExtensionDocs, checkFirebaseAccess, createFirebaseStoreWith, EXTENSION_CHUNKS_COLLECTION, EXTENSION_CHUNK_CHARS, inviteOps, mutationOps, signInWithSecrets } from "./firebase";
import { DELETE_FIELD, type FirebaseAuthUser } from "./firebase/api";
import { createMemoryFirebaseApi, crmRulesModel } from "./firebase/memoryApi";
import { memoryFirebaseCache, type FirebaseCache } from "./firebase/cache";
import { snapshotFromDocs } from "./core";

const ADMIN: FirebaseAuthUser = { uid: "u-admin", email: "Boss@Acme.io", displayName: "Boss", emailVerified: true };
const BOB: FirebaseAuthUser = { uid: "u-bob", email: "bob@acme.io", displayName: "Bob", emailVerified: true };
const EVE: FirebaseAuthUser = { uid: "u-eve", email: "eve@evil.io", displayName: "Eve", emailVerified: true };

const ada = { id: "r1", object: "people", fields: { name: "Ada", email: "ada@x.io" }, createdAt: 1, updatedAt: 1 };
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(opts: { signup?: "invite" | "open"; user?: FirebaseAuthUser | null } = {}) {
  const api = createMemoryFirebaseApi({ rules: crmRulesModel("boss@acme.io", { signup: opts.signup }), user: opts.user === undefined ? ADMIN : opts.user });
  const store = createFirebaseStoreWith({ api, now: () => 1000 });
  return { api, store };
}

describe("firebase mutation mapping", () => {
  it("set → set without id, patch → update with dot paths and deleteField, skip patch of missing docs", () => {
    const before = snapshotFromDocs({ records: [ada] });
    const ops = mutationOps(
      [
        { op: "set", collection: "records", doc: ada },
        { op: "patch", collection: "records", id: "r1", fields: { "fields.city": "Paris", "fields.email": undefined, id: "nope" } },
        { op: "patch", collection: "records", id: "missing", fields: { x: 1 } },
        { op: "delete", collection: "activities", id: "a1" },
      ],
      before,
    );
    expect(ops).toEqual([
      { type: "set", collection: "records", id: "r1", data: { object: "people", fields: { name: "Ada", email: "ada@x.io" }, createdAt: 1, updatedAt: 1 } },
      { type: "update", collection: "records", id: "r1", data: { "fields.city": "Paris", "fields.email": DELETE_FIELD } },
      { type: "delete", collection: "activities", id: "a1" },
    ]);
  });

  it("mirrors admin-created users as invitations", () => {
    const after = snapshotFromDocs({ users: [{ id: "p1", email: "Bob@Acme.io", name: "Bob", role: "viewer" }] });
    expect(inviteOps([{ op: "set", collection: "users", doc: after.users.get("p1")! }], () => undefined, after)).toEqual([
      { type: "set", collection: "invites", id: "bob@acme.io", data: { role: "viewer", userId: "p1", email: "bob@acme.io" } },
    ]);
    const empty = snapshotFromDocs({});
    expect(inviteOps([{ op: "delete", collection: "users", id: "p1" }], () => after.users.get("p1"), empty)).toEqual([
      { type: "delete", collection: "invites", id: "bob@acme.io" },
    ]);
  });
});

describe("firebase store", () => {
  it("bootstrap admin: creates users/{uid} as admin on first sign-in", async () => {
    const { api, store } = setup();
    const id = await store.identity();
    expect(id).toEqual({ uid: "u-admin", email: "boss@acme.io", displayName: "Boss", role: "admin" });
    expect(api.db.get("users", "u-admin")).toMatchObject({ email: "boss@acme.io", role: "admin", authUid: "u-admin" });
  });

  it("no session → null identity", async () => {
    const { store } = setup({ user: null });
    expect(await store.identity()).toBeNull();
    expect(store.accessError()).toBeNull();
  });

  it("unverified address → no access with reason", async () => {
    const { store } = setup({ user: { ...BOB, emailVerified: false } });
    expect(await store.identity()).toBeNull();
    expect(store.accessError()?.reason).toBe("unverified");
  });

  it("uninvited account is refused in invite mode, joins as member in open mode", async () => {
    const closed = setup({ user: EVE });
    expect(await closed.store.identity()).toBeNull();
    expect(closed.store.accessError()?.reason).toBe("notInvited");
    const open = setup({ user: EVE, signup: "open" });
    expect((await open.store.identity())?.role).toBe("member");
  });

  it("invited user joins with the invitation's role and the admin folds the placeholder in", async () => {
    const { api, store } = setup();
    await store.identity();
    await store.ready();
    await store.write([{ op: "set", collection: "objects", doc: { id: "people", fields: [{ id: "owner2", type: "user" }] } }]);
    await store.write([{ op: "set", collection: "users", doc: { id: "p-bob", email: "bob@acme.io", name: "Bob", role: "viewer" } }]);
    await store.write([{ op: "set", collection: "records", doc: { ...ada, ownerId: "p-bob", fields: { ...ada.fields, owner2: "p-bob" } } }]);
    expect(api.db.get("invites", "bob@acme.io")).toEqual({ role: "viewer", userId: "p-bob", email: "bob@acme.io" });

    // Bob signs in on his own browser.
    api.signInAs(BOB);
    const bobStore = createFirebaseStoreWith({ api, now: () => 2000 });
    expect(await bobStore.identity()).toMatchObject({ uid: "u-bob", role: "viewer" });
    expect(api.db.get("users", "u-bob")).toMatchObject({ role: "viewer", replaces: "p-bob" });
    await bobStore.ready();
    // Bob's store hides the placeholder.
    expect(bobStore.list("users").map((u) => u.id).sort()).toEqual(["u-admin", "u-bob"]);
    // Viewer: writes are refused by the rules and rolled back.
    await expect(bobStore.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.name": "Hacked" } }])).rejects.toMatchObject({ code: "permission-denied" });
    expect(bobStore.get("records", "r1")!.fields).toMatchObject({ name: "Ada" });

    // The admin's next load reconciles.
    api.signInAs(ADMIN);
    const adminStore = createFirebaseStoreWith({ api, now: () => 3000 });
    await adminStore.identity();
    await adminStore.ready();
    await flush();
    await flush();
    expect(api.db.get("users", "p-bob")).toBeUndefined();
    expect(api.db.get("invites", "bob@acme.io")).toBeUndefined();
    expect(api.db.get("records", "r1")).toMatchObject({ ownerId: "u-bob", fields: { owner2: "u-bob" } });
    expect(api.db.get("users", "u-bob")!.replaces).toBeUndefined();
  });

  it("users can't escalate their own role", async () => {
    const { api, store } = setup({ user: EVE, signup: "open" });
    await store.identity();
    await store.ready();
    await expect(store.write([{ op: "patch", collection: "users", id: "u-eve", fields: { role: "admin" } }])).rejects.toMatchObject({ code: "permission-denied" });
    await store.write([{ op: "patch", collection: "users", id: "u-eve", fields: { name: "Eve E." } }]);
    expect(api.db.get("users", "u-eve")).toMatchObject({ role: "member", name: "Eve E." });
  });

  it("splits big writes into batches of 500 and rolls back on failure", async () => {
    const { api, store } = setup();
    await store.identity();
    await store.ready();
    const docs = Array.from({ length: 1201 }, (_, i) => ({ op: "set" as const, collection: "records" as const, doc: { ...ada, id: `r${i}` } }));
    await store.write(docs);
    expect(api.commits.slice(-3).map((c) => c.length)).toEqual([500, 500, 201]);
    expect(api.db.collections.get("records")!.size).toBe(1201);

    api.failNextCommit = Object.assign(new Error("offline"), { code: "unavailable" });
    await expect(store.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.name": "X" } }])).rejects.toThrow("offline");
    expect(store.get("records", "r1")!.fields).toMatchObject({ name: "Ada" });
  });

  it("live: a teammate's write shows up through the snapshot listener", async () => {
    const { api, store } = setup();
    await store.identity();
    await store.ready();
    const seen = new Set<string>();
    const off = store.subscribe((c) => c.forEach((x) => seen.add(x)));
    await flush();
    await api.commit([{ type: "set", collection: "activities", id: "a1", data: { type: "note", title: "Hi", targets: [] } }]);
    await flush();
    expect(store.get("activities", "a1")).toMatchObject({ title: "Hi" });
    expect(seen.has("activities")).toBe(true);
    off();
  });
});

describe("firebase extension chunks", () => {
  const big = (n: number) => `export default {};\n//${"x".repeat(n)}`;
  const ext = (code: string) => ({ id: "big-ext", kind: "module", manifest: { id: "big-ext", version: "1.0.0" }, enabled: true, files: { "bundle.js": code }, installedAt: 1, updatedAt: 1 });

  it("splits large bundles over extensionChunks and reassembles them", async () => {
    const { api, store } = setup();
    await store.identity();
    await store.ready();
    const code = big(EXTENSION_CHUNK_CHARS * 2 + 10);
    await store.write([{ op: "set", collection: "extensions", doc: ext(code) }]);
    expect(api.db.get("extensions", "big-ext")).toMatchObject({ files: {}, chunks: { "bundle.js": 3 } });
    expect(api.db.get(EXTENSION_CHUNKS_COLLECTION, "big-ext__bundle.js__2")).toMatchObject({ ext: "big-ext", file: "bundle.js", index: 2 });
    // A fresh client sees the whole bundle.
    const other = createFirebaseStoreWith({ api, now: () => 1000 });
    await other.identity();
    await other.ready();
    expect((other.get("extensions", "big-ext")?.files as Record<string, string>)["bundle.js"]).toBe(code);
    // A smaller upgrade drops the unused chunks; delete drops them all.
    await store.write([{ op: "set", collection: "extensions", doc: ext(big(EXTENSION_CHUNK_CHARS + 5)) }]);
    expect(api.db.get(EXTENSION_CHUNKS_COLLECTION, "big-ext__bundle.js__2")).toBeUndefined();
    expect(api.db.get(EXTENSION_CHUNKS_COLLECTION, "big-ext__bundle.js__1")).toBeTruthy();
    await store.write([{ op: "delete", collection: "extensions", id: "big-ext" }]);
    expect(api.db.get(EXTENSION_CHUNKS_COLLECTION, "big-ext__bundle.js__0")).toBeUndefined();
  });

  it("keeps small bundles inline and skips incomplete chunk sets", () => {
    const ops = mutationOps([{ op: "set", collection: "extensions", doc: ext("export default {};") }], snapshotFromDocs({}));
    expect(ops).toHaveLength(1);
    const docs = assembleExtensionDocs([{ id: "e", data: { chunks: { "bundle.js": 2 }, files: {} } }], [{ id: "e__bundle.js__0", data: { ext: "e", file: "bundle.js", index: 0, data: "a" } }]);
    expect(docs[0].data).toEqual({ files: {} });
  });
});

describe("firebase CLI login", () => {
  const ROBOT: FirebaseAuthUser = { uid: "u-robot", email: "robot@acme.io", displayName: "Robot", emailVerified: true };
  const login = { email: "Robot@Acme.io ", password: "s3cret" };

  function cli(opts: { verified?: boolean; admin?: string } = {}) {
    const api = createMemoryFirebaseApi({ rules: crmRulesModel(opts.admin ?? "robot@acme.io"), user: null });
    api.accounts.set("robot@acme.io", { password: "s3cret", user: { ...ROBOT, emailVerified: opts.verified ?? true } });
    return api;
  }

  it("signs in with the secrets, and only once per address", async () => {
    const api = cli();
    expect(await signInWithSecrets(api, undefined)).toBeNull();
    expect((await signInWithSecrets(api, login))?.uid).toBe("u-robot");
    api.accounts.clear(); // a second sign-in would now fail
    expect((await signInWithSecrets(api, login))?.uid).toBe("u-robot");
  });

  it("lets the CLI seed the CRM through the rules once signed in", async () => {
    const api = cli();
    await signInWithSecrets(api, login);
    const store = createFirebaseStoreWith({ api, now: () => 1000 });
    await store.ready();
    await store.write([{ op: "set", collection: "settings", doc: { id: "general", name: "Acme" } }]);
    expect(api.db.get("settings", "general")).toMatchObject({ name: "Acme" });
  });

  it("access check: ok, wrong password, unverified address, rules for another admin", async () => {
    expect(await checkFirebaseAccess(cli(), login, "p")).toMatchObject({ ok: true, existing: false });
    expect(await checkFirebaseAccess(cli(), { ...login, password: "nope" }, "p")).toMatchObject({ ok: false, detail: expect.stringMatching(/refused the login/) });
    expect(await checkFirebaseAccess(cli({ verified: false }), login, "p")).toMatchObject({ ok: false, detail: expect.stringMatching(/not verified/) });
    expect(await checkFirebaseAccess(cli({ admin: "boss@acme.io" }), login, "p")).toMatchObject({ ok: false, detail: expect.stringMatching(/bootstrap admin/) });
  });

  it("mirrors an invitation for a user added before anything asked for the identity", async () => {
    const api = cli();
    await signInWithSecrets(api, login);
    const store = createFirebaseStoreWith({ api, now: () => 1000 });
    await store.ready(); // no identity() call, like a CLI site with a recorded --user
    await store.write([{ op: "set", collection: "users", doc: { id: "p-ada", email: "Ada@Acme.io", name: "Ada", role: "admin" } }]);
    expect(api.db.get("invites", "ada@acme.io")).toEqual({ role: "admin", userId: "p-ada", email: "ada@acme.io" });
  });
});

describe("firebase incremental loading", () => {
  // 13 collections + extension chunks + tombstones: one query each.
  const DELTA_QUERIES = 15;
  const bigDataset = (n: number) => Array.from({ length: n }, (_, i) => ({ op: "set" as const, collection: "records" as const, doc: { id: `r${i}`, object: "people", fields: { name: `P${i}` }, createdAt: 1, updatedAt: 1 } }));

  async function seeded(n = 300) {
    const api = createMemoryFirebaseApi({ rules: crmRulesModel("boss@acme.io"), user: ADMIN });
    const writer = createFirebaseStoreWith({ api, now: () => 1000 });
    await writer.ready();
    await writer.write(bigDataset(n));
    return { api, cache: memoryFirebaseCache() };
  }
  const open = async (api: ReturnType<typeof createMemoryFirebaseApi>, cache: FirebaseCache, now = 5000) => {
    const store = createFirebaseStoreWith({ api, cache, projectId: "p", now: () => now });
    await store.ready();
    return store;
  };

  it("reads everything once, then only what changed", async () => {
    const { api, cache } = await seeded();
    const first = await open(api, cache);
    expect(first.lastLoad()).toMatchObject({ mode: "full" });
    expect(first.lastLoad()!.reads).toBeGreaterThanOrEqual(300);
    expect(first.list("records")).toHaveLength(300);
    expect(first.get("records", "r0")).not.toHaveProperty("_ts");

    const second = await open(api, cache);
    expect(second.lastLoad()).toEqual({ mode: "incremental", reads: DELTA_QUERIES });
    expect(second.list("records")).toHaveLength(300);
  });

  it("picks up another client's update and delete from the cached copy", async () => {
    const { api, cache } = await seeded();
    await open(api, cache);
    const other = createFirebaseStoreWith({ api, now: () => 2000 });
    await other.ready();
    await other.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.name": "Renamed" } }]);
    await other.write([{ op: "delete", collection: "records", id: "r2" }]);

    const reopened = await open(api, cache);
    expect(reopened.lastLoad()!.mode).toBe("incremental");
    expect(reopened.lastLoad()!.reads).toBeLessThan(DELTA_QUERIES + 5);
    expect((reopened.get("records", "r1")?.fields as Record<string, unknown>).name).toBe("Renamed");
    expect(reopened.get("records", "r2")).toBeUndefined();
    expect(reopened.list("records")).toHaveLength(299);
  });

  it("live updates read only the changes", async () => {
    const { api, cache } = await seeded();
    const store = await open(api, cache);
    const off = store.subscribe(() => undefined);
    await flush();
    const before = api.readCount();
    expect(before - store.readCount()).toBe(0);
    const other = createFirebaseStoreWith({ api, now: () => 2000 });
    await other.ready();
    const afterOtherLoad = api.readCount();
    await other.write([{ op: "set", collection: "records", doc: { id: "new", object: "people", fields: { name: "New" }, createdAt: 2, updatedAt: 2 } }]);
    await flush();
    expect(store.get("records", "new")).toBeDefined();
    expect(api.readCount() - afterOtherLoad).toBeLessThan(5);
    await other.write([{ op: "delete", collection: "records", id: "new" }]);
    await flush();
    expect(store.get("records", "new")).toBeUndefined();
    off();
  });

  it("reads everything again after a week, and per signed-in user", async () => {
    const { api, cache } = await seeded();
    await open(api, cache, 5000);
    expect((await open(api, cache, 5000 + 8 * 24 * 3600 * 1000)).lastLoad()!.mode).toBe("full");
    api.signInAs({ ...BOB, uid: "u-other" });
    expect([...cache.entries.keys()]).toEqual(["p:u-admin"]);
  });
});
