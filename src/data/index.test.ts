import { afterEach, describe, expect, it } from "vitest";
import { createDataStore, getDataStore, listBackends, registerBackend, resetDataStore, setDataStore, createMemoryStore } from "./index";
import { registerStorageConnector } from "../shared/storage/registry";
import { createMemoryConnector } from "../shared/storage/connectors/memory";
import { setRuntimeConfigOverride, type RuntimeConfig } from "../lib/runtimeConfig";

afterEach(() => {
  setRuntimeConfigOverride(undefined);
  resetDataStore();
});

describe("data store registry", () => {
  it("registers built-ins and lazy stubs", () => {
    expect(listBackends().sort()).toEqual(["firebase", "git-json", "journal", "local", "memory"]);
  });

  it("builds a journal store over a registered connector with explicit secrets", async () => {
    const conn = createMemoryConnector({ id: "test-mem" });
    registerStorageConnector(conn);
    const config: RuntimeConfig = { backend: "journal", journal: { connectorId: "test-mem", settings: {}, root: "crm", encrypted: false } };
    const store = await createDataStore(config, {});
    expect(store.kind).toBe("journal");
    await store.ready();
    await store.write([{ op: "set", collection: "users", doc: { id: "u1" } }]);
    expect([...conn.files.keys()].some((k) => k.startsWith("crm/journal/"))).toBe(true);
  });

  it("lazy backends: git-json without a token has no identity; firebase needs its web config", async () => {
    const git = await createDataStore({ backend: "git-json", git: { provider: "github", owner: "o", repo: "r", branch: "main", dir: "" } });
    expect(git.kind).toBe("git-json");
    expect(await git.identity()).toBeNull();
    await expect(createDataStore({ backend: "firebase", firebase: { apiKey: "", projectId: "p" } } as RuntimeConfig)).rejects.toThrow(/web config/);
  });

  it("journal: missing connector secrets on this browser → no identity (access screen)", async () => {
    const config: RuntimeConfig = { backend: "journal", journal: { connectorId: "s3", settings: { bucket: "b", region: "auto", endpoint: "https://x.r2.cloudflarestorage.com" }, root: "crm", encrypted: true } };
    expect(await (await createDataStore(config, {})).identity()).toBeNull();
    const withKeys = await createDataStore(config, { secrets: { accessKeyId: "a", secretAccessKey: "s" } });
    expect((await withKeys.identity())?.role).toBe("admin");
  });

  it("getDataStore follows the runtime config; setDataStore overrides", async () => {
    await expect(getDataStore()).rejects.toThrow(/not configured/);
    registerBackend("memory", () => createMemoryStore());
    const config = { backend: "memory" } as unknown as RuntimeConfig;
    setRuntimeConfigOverride(config);
    const a = await getDataStore();
    expect(await getDataStore()).toBe(a);
    const b = createMemoryStore();
    setDataStore(b, config);
    expect(await getDataStore()).toBe(b);
  });
});
