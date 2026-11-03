import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteFile,
  deleteFolder,
  getFile,
  getStorageCapabilities,
  renameFile,
  uploadFile,
  withStorageBatch,
} from "../siteFiles";
import { invalidateActiveStorageConnector, registerStorageConnector, setStorageConfigSource, type StorageConfig } from "./registry";

// The active connector id comes from a pluggable source — stub it so the
// tests pick connectors directly.
const storageConfig = {
  getStorageConfig: vi.fn<() => Promise<StorageConfig | null>>(),
};
setStorageConfigSource(() => storageConfig.getStorageConfig());
import { flushImplicitBatch, pendingImplicitBatch } from "./batch";
import type { BatchOp, ListItem, StorageConnector } from "./types";

const NO_CAPS = {
  list: false,
  rename: false,
  renameFolder: false,
  folders: false,
  deletePrefix: false,
};

// In-memory target. `commit` model when withCommit is true.
function fakeConnector(id: string, opts: { withCommit?: boolean; list?: boolean } = {}) {
  const files = new Map<string, string>();
  const commits: BatchOp[][] = [];
  const connector: StorageConnector = {
    id,
    model: opts.withCommit ? "commit" : "files",
    capabilities: { ...NO_CAPS, list: !!opts.list },
    put: vi.fn(async (input) => {
      files.set(input.path, input.content);
    }),
    get: vi.fn(async (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`404 ${path}`);
      return content;
    }),
    delete: vi.fn(async (path) => {
      files.delete(path);
    }),
    publicUrl: async (path) => `https://example.test/${path}`,
  };
  if (opts.list) {
    connector.list = async (page, perPage) => {
      const all: ListItem[] = [...files.keys()].sort().map((path) => ({ path, type: "file" }));
      return { items: all.slice((page - 1) * perPage, page * perPage), page, per_page: perPage };
    };
  }
  if (opts.withCommit) {
    connector.commitBatch = vi.fn(async (ops: BatchOp[]) => {
      commits.push(ops);
    });
  }
  registerStorageConnector(connector);
  return { connector, files, commits };
}

function useConnector(id: string) {
  storageConfig.getStorageConfig.mockResolvedValue({ connectorId: id, settings: {} });
}

beforeEach(() => {
  invalidateActiveStorageConnector();
  storageConfig.getStorageConfig.mockReset();
  storageConfig.getStorageConfig.mockResolvedValue(null);
});

describe("active connector resolution", () => {
  it("defaults to the ZIP mirror when no storage config exists", async () => {
    storageConfig.getStorageConfig.mockResolvedValue(null);
    const caps = await getStorageCapabilities();
    expect(caps.connectorId).toBe("browser-mirror");
    expect(caps.model).toBe("files");
  });

  it("defaults to the ZIP mirror when the storage config can't be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    storageConfig.getStorageConfig.mockRejectedValue(new Error("permission-denied"));
    expect((await getStorageCapabilities()).connectorId).toBe("browser-mirror");
  });

  it("rejects an unknown connector id", async () => {
    useConnector("does-not-exist");
    await expect(uploadFile({ path: "a.html", content: "x" })).rejects.toMatchObject({ status: 501 });
  });
});

describe("files model", () => {
  it("writes immediately, even inside a batch", async () => {
    const { connector, files } = fakeConnector("fake-files");
    useConnector("fake-files");
    await withStorageBatch(async () => {
      await uploadFile({ path: "index.html", content: "home" });
      expect(files.get("index.html")).toBe("home");
    });
    expect(connector.put).toHaveBeenCalledTimes(1);
  });

  it("emulates deleteFolder with list + delete", async () => {
    const { files } = fakeConnector("fake-list", { list: true });
    useConnector("fake-list");
    files.set("media/a/1.webp", "1");
    files.set("media/a/2.webp", "2");
    files.set("media/ab/3.webp", "3");
    await deleteFolder("media/a");
    expect([...files.keys()]).toEqual(["media/ab/3.webp"]);
  });

  it("emulates renameFile with get + put + delete", async () => {
    const { files } = fakeConnector("fake-rename");
    useConnector("fake-rename");
    files.set("old.md", "body");
    await renameFile("old.md", "new.md");
    expect(Object.fromEntries(files)).toEqual({ "new.md": "body" });
  });
});

describe("commit model", () => {
  it("collapses nested scopes into one de-duplicated commit", async () => {
    const { connector, commits } = fakeConnector("fake-git", { withCommit: true });
    useConnector("fake-git");
    await withStorageBatch(async () => {
      await uploadFile({ path: "index.html", content: "v1" });
      await withStorageBatch(async () => {
        await uploadFile({ path: "index.html", content: "v2" });
        await deleteFile("old.html");
      });
      expect(commits).toHaveLength(0);
    });
    expect(connector.put).not.toHaveBeenCalled();
    expect(commits).toEqual([
      [
        { type: "put", path: "index.html", content: "v2", encoding: undefined },
        { type: "delete", path: "old.html" },
      ],
    ]);
  });

  it("drops staged files under a deleted prefix but keeps later ones", async () => {
    const { commits } = fakeConnector("fake-git-prefix", { withCommit: true });
    useConnector("fake-git-prefix");
    await withStorageBatch(async () => {
      await uploadFile({ path: "media/x/a.webp", content: "a" });
      await deleteFolder("/media/x/");
      await uploadFile({ path: "media/x/b.webp", content: "b" });
    });
    expect(commits[0]).toEqual([
      { type: "deletePrefix", path: "media/x" },
      { type: "put", path: "media/x/b.webp", content: "b", encoding: undefined },
    ]);
  });

  it("reads its own staged writes", async () => {
    fakeConnector("fake-git-read", { withCommit: true });
    useConnector("fake-git-read");
    await withStorageBatch(async () => {
      await uploadFile({ path: "data/menu.json", content: "{}" });
      const utf8 = String.fromCharCode(...new TextEncoder().encode("héllo"));
      await uploadFile({ path: "data/b64.txt", content: btoa(utf8), encoding: "base64" });
      expect(await getFile("data/menu.json")).toBe("{}");
      expect(await getFile("data/b64.txt")).toBe("héllo");
      await deleteFile("data/menu.json");
      await expect(getFile("data/menu.json")).rejects.toMatchObject({ status: 404 });
    });
  });

  it("still commits successful writes when the scope throws", async () => {
    const { commits } = fakeConnector("fake-git-throw", { withCommit: true });
    useConnector("fake-git-throw");
    await expect(
      withStorageBatch(async () => {
        await uploadFile({ path: "a.html", content: "a" });
        throw new Error("render failed");
      }),
    ).rejects.toThrow("render failed");
    expect(commits).toHaveLength(1);
  });

  it("skips the commit when nothing was staged", async () => {
    const { commits } = fakeConnector("fake-git-empty", { withCommit: true });
    useConnector("fake-git-empty");
    await withStorageBatch(async () => {});
    expect(commits).toHaveLength(0);
  });
});

describe("implicit batching (writes outside withStorageBatch)", () => {
  it("coalesces sequential writes into ONE deferred commit", async () => {
    const { connector, commits } = fakeConnector("fake-git-implicit", { withCommit: true });
    useConnector("fake-git-implicit");
    await uploadFile({ path: "theme-assets/a.css", content: "a" });
    await uploadFile({ path: "theme-assets/b.js", content: "b" });
    await deleteFile("old.css");
    expect(commits).toHaveLength(0);
    expect(connector.put).not.toHaveBeenCalled();
    // Read-your-writes before the commit lands.
    expect(await getFile("theme-assets/a.css")).toBe("a");
    await flushImplicitBatch();
    expect(commits).toHaveLength(1);
    expect(commits[0].map((op) => op.path)).toEqual(["theme-assets/a.css", "theme-assets/b.js", "old.css"]);
    expect(pendingImplicitBatch()).toBeNull();
  });

  it("flushes pending writes before an explicit batch starts", async () => {
    const { commits } = fakeConnector("fake-git-order", { withCommit: true });
    useConnector("fake-git-order");
    await uploadFile({ path: "early.css", content: "1" });
    await withStorageBatch(async () => {
      await uploadFile({ path: "post.html", content: "2" });
    });
    expect(commits.map((ops) => ops.map((op) => op.path))).toEqual([["early.css"], ["post.html"]]);
  });

  it("leaves files-model connectors writing immediately", async () => {
    const { files } = fakeConnector("fake-files-implicit");
    useConnector("fake-files-implicit");
    await uploadFile({ path: "a.html", content: "x" });
    expect(files.get("a.html")).toBe("x");
    expect(pendingImplicitBatch()).toBeNull();
  });
});
