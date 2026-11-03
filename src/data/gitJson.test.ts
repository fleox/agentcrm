import { describe, expect, it } from "vitest";
import { createGitJsonStoreWith, type GitJsonStoreOptions } from "./gitJson/store";
import { createMemoryGitTransport, createMemoryRepo, type MemoryRepo } from "./gitJson/memoryTransport";
import { docPath, filesToSnapshot, parseDocPath, stripDocSecrets, type SecretBag } from "./gitJson/layout";
import { DocConflictError } from "./types";
import { setupTestCrm } from "../ops/testing";

const ada = { id: "r1", object: "people", fields: { name: "Ada", email: "ada@x.io" }, createdAt: 1, updatedAt: 1 };

function storeOn(repo: MemoryRepo, extra: Partial<GitJsonStoreOptions> & { perms?: Parameters<typeof createMemoryGitTransport>[1] } = {}) {
  const transport = createMemoryGitTransport(repo, extra.perms);
  let bag: SecretBag = {};
  const store = createGitJsonStoreWith({
    dir: "crm",
    openTransport: async () => transport,
    secrets: { read: () => bag, write: (b) => (bag = b) },
    ...extra,
  });
  return { store, transport, bag: () => bag };
}

describe("git-json layout", () => {
  it("maps documents to files and back", () => {
    expect(docPath("records", ada)).toBe("records/people/r1.json");
    expect(docPath("users", { id: "github:octocat" })).toBe("users/github%3Aoctocat.json");
    expect(parseDocPath("users/github%3Aoctocat.json")).toEqual({ collection: "users", id: "github:octocat" });
    expect(parseDocPath("records/people/r1.json")).toEqual({ collection: "records", id: "r1" });
    expect(parseDocPath("records/r1.json")).toBeNull();
    expect(parseDocPath("README.md")).toBeNull();
    expect(parseDocPath("unknown/x.json")).toBeNull();
  });

  it("strips secrets from config docs", () => {
    const { doc, secrets } = stripDocSecrets({ id: "hosting", connectorId: "s3", settings: { bucket: "b", secretAccessKey: "S", accessKeyId: "A" } });
    expect(doc).toEqual({ id: "hosting", connectorId: "s3", settings: { bucket: "b" } });
    expect(secrets).toEqual({ "settings.secretAccessKey": "S", "settings.accessKeyId": "A" });
    const { snapshot } = filesToSnapshot(new Map([["config/hosting.json", JSON.stringify(doc)]]), { hosting: secrets });
    expect(snapshot.config.get("hosting")).toMatchObject({ settings: { bucket: "b", secretAccessKey: "S" } });
  });
});

describe("git-json store", () => {
  it("one commit per write, one file per document, readable by a fresh client", async () => {
    const repo = createMemoryRepo({ "README.md": "# data" });
    const { store } = storeOn(repo);
    await store.ready();
    await store.write([{ op: "set", collection: "records", doc: ada }], { message: "Add Ada" });
    await store.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.city": "London" } }], { message: "Update Ada" });
    expect(repo.commits.map((c) => c.message)).toEqual(["Add Ada — AgentCRM [skip ci]", "Update Ada — AgentCRM [skip ci]"]);
    expect([...repo.files.keys()].sort()).toEqual(["README.md", "crm/agentcrm.json", "crm/records/people/r1.json"]);
    expect(JSON.parse(repo.files.get("crm/records/people/r1.json")!).fields).toEqual({ name: "Ada", email: "ada@x.io", city: "London" });

    const { store: other } = storeOn(repo);
    await other.ready();
    expect(other.get("records", "r1")).toEqual({ ...ada, fields: { ...ada.fields, city: "London" } });
  });

  it("deletes the file of a deleted document", async () => {
    const repo = createMemoryRepo();
    const { store } = storeOn(repo);
    await store.ready();
    await store.write([{ op: "set", collection: "activities", doc: { id: "a1", type: "note", title: "x" } }]);
    await store.write([{ op: "delete", collection: "activities", id: "a1" }]);
    expect(repo.files.has("crm/activities/a1.json")).toBe(false);
  });

  it("rebases a patch onto a remote change of OTHER fields (per-field merge)", async () => {
    const repo = createMemoryRepo();
    const a = storeOn(repo).store;
    await a.ready();
    await a.write([{ op: "set", collection: "records", doc: ada }]);
    const b = storeOn(repo).store;
    await b.ready();
    await a.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.name": "Ada Lovelace" } }]);
    // b hasn't seen a's commit: its commit is refused, then rebased.
    await b.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.email": "ada@lovelace.io" } }]);
    const onDisk = JSON.parse(repo.files.get("crm/records/people/r1.json")!);
    expect(onDisk.fields).toEqual({ name: "Ada Lovelace", email: "ada@lovelace.io" });
    await b.refresh();
    expect(b.get("records", "r1")!.fields).toEqual({ name: "Ada Lovelace", email: "ada@lovelace.io" });
  });

  it("refuses (DocConflictError) and rolls back when the remote changed the same field", async () => {
    const repo = createMemoryRepo();
    const a = storeOn(repo).store;
    await a.ready();
    await a.write([{ op: "set", collection: "records", doc: ada }]);
    const b = storeOn(repo).store;
    await b.ready();
    await a.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.name": "From A" } }]);
    await expect(b.write([{ op: "patch", collection: "records", id: "r1", fields: { "fields.name": "From B" } }])).rejects.toBeInstanceOf(DocConflictError);
    expect(b.get("records", "r1")!.fields).toMatchObject({ name: "Ada" });
    await b.refresh();
    expect(b.get("records", "r1")!.fields).toMatchObject({ name: "From A" });
    expect(JSON.parse(repo.files.get("crm/records/people/r1.json")!).fields.name).toBe("From A");
  });

  it("set on a document changed remotely is a conflict; unrelated documents rebase", async () => {
    const repo = createMemoryRepo();
    const a = storeOn(repo).store;
    await a.ready();
    await a.write([{ op: "set", collection: "records", doc: ada }]);
    const b = storeOn(repo).store;
    await b.ready();
    await a.write([{ op: "set", collection: "records", doc: { ...ada, fields: { name: "X" } } }]);
    await expect(b.write([{ op: "set", collection: "records", doc: { ...ada, fields: { name: "Y" } } }])).rejects.toBeInstanceOf(DocConflictError);
    await b.write([{ op: "set", collection: "records", doc: { ...ada, id: "r2" } }]);
    expect(repo.files.has("crm/records/people/r2.json")).toBe(true);
  });

  it("polls the branch head and reloads only when it moved", async () => {
    const repo = createMemoryRepo();
    const { store, transport } = storeOn(repo);
    await store.ready();
    const reads = transport.reads;
    await store.refresh();
    expect(transport.reads).toBe(reads);
    const other = storeOn(repo).store;
    await other.ready();
    await other.write([{ op: "set", collection: "records", doc: ada }]);
    const seen: string[] = [];
    store.subscribe((c) => seen.push(...c));
    await store.refresh();
    expect(store.get("records", "r1")).toBeTruthy();
    expect(seen).toContain("records");
    store.close?.();
  });

  it("never commits secrets of config docs", async () => {
    const repo = createMemoryRepo();
    const { store, bag } = storeOn(repo);
    await store.ready();
    await store.write([{ op: "set", collection: "config", doc: { id: "hosting", connectorId: "git-pages", settings: { repo: "site", token: "ghp_secret" } } }]);
    const text = repo.files.get("crm/config/hosting.json")!;
    expect(text).not.toContain("ghp_secret");
    expect(bag()).toEqual({ hosting: { "settings.token": "ghp_secret" } });
    expect(store.get("config", "hosting")).toMatchObject({ settings: { token: "ghp_secret" } });
  });

  it("identity: repo permission → role; no transport → null", async () => {
    const repo = createMemoryRepo();
    const roles = [];
    for (const perms of [{ isAdmin: true, canWrite: true }, { isAdmin: false, canWrite: true }, { isAdmin: false, canWrite: false }]) {
      const { store } = storeOn(repo, { perms: { permissions: perms } });
      roles.push((await store.identity())?.role);
    }
    expect(roles).toEqual(["admin", "member", "viewer"]);
    const { store } = storeOn(repo);
    expect(await store.identity()).toMatchObject({ uid: "github:octocat", email: "octocat@users.noreply.github.com" });
    const none = createGitJsonStoreWith({ dir: "", openTransport: async () => null });
    expect(await none.identity()).toBeNull();
  });

  it("holds a whole seeded CRM (round trip)", async () => {
    const { store: mem } = await setupTestCrm({ demo: true });
    const repo = createMemoryRepo();
    const { store } = storeOn(repo);
    await store.ready();
    const mutations = (["objects", "records", "activities", "pipelines", "views", "users", "settings"] as const).flatMap((c) =>
      mem.list(c).map((doc) => ({ op: "set" as const, collection: c, doc })),
    );
    await store.write(mutations, { message: "Import" });
    expect(repo.commits).toHaveLength(1);
    const { store: fresh } = storeOn(repo);
    await fresh.ready();
    for (const c of ["objects", "records", "activities", "users"] as const) expect(fresh.list(c).length).toBe(mem.list(c).length);
  });
});

describe("git-json roles end to end", () => {
  it("the repo permission caps the CRM role (resolveCrmUser)", async () => {
    const { resolveCrmUser } = await import("../app/auth");
    const repo = createMemoryRepo();
    const { store } = storeOn(repo, { perms: { permissions: { isAdmin: false, canWrite: true } } });
    await store.ready();
    await store.write([{ op: "set", collection: "users", doc: { id: "u1", email: "octocat@users.noreply.github.com", name: "Octo", role: "admin" } }]);
    const identity = await store.identity();
    expect(resolveCrmUser(store, identity)).toMatchObject({ id: "u1", role: "member" });
  });
});
