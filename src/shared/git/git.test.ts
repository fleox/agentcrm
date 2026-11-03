import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGitHubTransport } from "./github";
import { createGitLabTransport } from "./gitlab";
import { GitConflictError } from "./types";

// Minimal router over a mocked global fetch: each handler matches
// "METHOD url-substring" and returns [status, json body].
type Handler = (url: string, init: RequestInit) => [number, unknown] | undefined;
let handlers: Handler[] = [];
const calls: Array<{ method: string; url: string; body?: unknown }> = [];

function route(method: string, fragment: string, reply: (body: unknown) => [number, unknown]) {
  handlers.push((url, init) => {
    if ((init.method ?? "GET") !== method || !url.includes(fragment)) return undefined;
    return reply(init.body ? JSON.parse(String(init.body)) : undefined);
  });
}

beforeEach(() => {
  handlers = [];
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      for (const h of handlers) {
        const hit = h(url, init);
        if (hit) {
          const [status, body] = hit;
          return new Response(typeof body === "string" ? body : JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          });
        }
      }
      return new Response("not mocked", { status: 599 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("GitHub transport", () => {
  const gh = () =>
    createGitHubTransport({ provider: "github", owner: "me", repo: "site", branch: "main", token: "t" });

  function repoAt(head: string, treeSha: string, paths: string[]) {
    route("GET", "/git/ref/heads/main", () => [200, { object: { sha: head } }]);
    route("GET", `/git/commits/${head}`, () => [200, { tree: { sha: treeSha } }]);
    route("GET", `/git/trees/${treeSha}`, () => [
      200,
      { truncated: false, tree: paths.map((p) => ({ path: p, type: "blob", sha: `sha-${p}`, size: 1 })) },
    ]);
  }

  it("lists blobs at head", async () => {
    repoAt("c1", "t1", ["index.html", "news/a.html"]);
    const tree = await gh().listTree();
    expect(tree.headSha).toBe("c1");
    expect(tree.entries.map((e) => e.path)).toEqual(["index.html", "news/a.html"]);
  });

  it("commits puts + existing deletes in one commit and skips absent deletes", async () => {
    repoAt("c1", "t1", ["old.html"]);
    route("POST", "/git/blobs", () => [201, { sha: "blob-img" }]);
    route("POST", "/git/trees", () => [201, { sha: "t2" }]);
    route("POST", "/git/commits", () => [201, { sha: "c2" }]);
    route("PATCH", "/git/refs/heads/main", () => [200, { object: { sha: "c2" } }]);

    const sha = await gh().commit(
      [
        { type: "put", path: "index.html", content: "<p>hi</p>" },
        { type: "put", path: "media/a.webp", content: "AAAA", encoding: "base64" },
        { type: "delete", path: "old.html" },
        { type: "delete", path: "never-existed.html" },
      ],
      { message: "Publish" },
    );
    expect(sha).toBe("c2");
    const tree = calls.find((c) => c.method === "POST" && c.url.endsWith("/git/trees"))!.body as {
      base_tree: string;
      tree: Array<Record<string, unknown>>;
    };
    expect(tree.base_tree).toBe("t1");
    expect(tree.tree).toEqual([
      { path: "index.html", mode: "100644", type: "blob", content: "<p>hi</p>" },
      { path: "media/a.webp", mode: "100644", type: "blob", sha: "blob-img" },
      { path: "old.html", mode: "100644", type: "blob", sha: null },
    ]);
    const commit = calls.find((c) => c.url.endsWith("/git/commits") && c.method === "POST")!.body;
    expect(commit).toEqual({ message: "Publish", tree: "t2", parents: ["c1"] });
  });

  it("refuses with GitConflictError when the expected head moved", async () => {
    repoAt("c9", "t9", []);
    await expect(
      gh().commit([{ type: "put", path: "a.md", content: "x" }], { message: "m", expectedHeadSha: "c1" }),
    ).rejects.toBeInstanceOf(GitConflictError);
  });

  it("does not create an empty commit when nothing changed", async () => {
    repoAt("c1", "t1", ["a.html"]);
    route("POST", "/git/trees", () => [201, { sha: "t1" }]);
    expect(await gh().commit([{ type: "put", path: "a.html", content: "same" }], { message: "m" })).toBe("c1");
    expect(calls.some((c) => c.url.endsWith("/git/commits") && c.method === "POST")).toBe(false);
  });

  it("reads texts through GraphQL by blob sha", async () => {
    route("POST", "/graphql", () => [
      200,
      { data: { repository: { b0: { text: "# Hello", isBinary: false, isTruncated: false } } } },
    ]);
    const texts = await gh().readTexts([{ path: "content/posts/hello.md", sha: "gql-sha-1" }]);
    expect(texts.get("content/posts/hello.md")).toBe("# Hello");
  });

  it("reports a missing branch as an empty head", async () => {
    route("GET", "/git/ref/heads/main", () => [404, { message: "Not Found" }]);
    expect(await gh().headSha()).toBe("");
    expect((await gh().listTree()).entries).toEqual([]);
  });
});

describe("GitLab transport", () => {
  const gl = () => createGitLabTransport({ provider: "gitlab", project: "grp/site", branch: "main", token: "t" });

  it("picks create vs update from the tree and skips absent deletes", async () => {
    route("GET", "/repository/branches/main", () => [200, { commit: { id: "c1" } }]);
    route("GET", "/repository/tree", () => [200, [{ id: "b1", path: "index.html", type: "blob" }]]);
    route("POST", "/repository/commits", () => [201, { id: "c2" }]);

    const sha = await gl().commit(
      [
        { type: "put", path: "index.html", content: "home" },
        { type: "put", path: "news/a.html", content: "a" },
        { type: "delete", path: "gone.html" },
      ],
      { message: "Publish" },
    );
    expect(sha).toBe("c2");
    const body = calls.find((c) => c.url.endsWith("/repository/commits"))!.body as {
      branch: string;
      actions: Array<{ action: string; file_path: string; content: string }>;
    };
    expect(body.branch).toBe("main");
    expect(body.actions.map((a) => [a.action, a.file_path])).toEqual([
      ["update", "index.html"],
      ["create", "news/a.html"],
    ]);
    expect(atob(body.actions[0].content)).toBe("home");
  });

  it("encodes the project path in the URL", async () => {
    route("GET", "/repository/branches/main", () => [404, {}]);
    await gl().headSha();
    expect(calls[0].url).toContain("/projects/grp%2Fsite/");
  });

  it("maps access levels to permissions", async () => {
    route("GET", "/user", () => [200, { username: "fred" }]);
    route("GET", "/projects/grp%2Fsite", () => [
      200,
      { permissions: { project_access: { access_level: 30 }, group_access: null } },
    ]);
    expect(await gl().permissions()).toEqual({ login: "fred", canWrite: true, isAdmin: false });
  });
});
