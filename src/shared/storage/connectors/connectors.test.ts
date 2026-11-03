import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitChange, GitCommitOptions, GitTransport, GitTreeEntry } from "../../git/types";

// In-memory git remote shared by every transport the connector creates.
const remote = vi.hoisted(() => ({
  files: new Map<string, string>(),
  head: 0,
  commits: [] as Array<{ changes: unknown[]; message: string }>,
}));

vi.mock("../../git", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../git")>();
  const transport: GitTransport = {
    kind: "github",
    label: "test",
    headSha: async () => `c${remote.head}`,
    listTree: async () => ({
      headSha: `c${remote.head}`,
      entries: [...remote.files.keys()].map((path): GitTreeEntry => ({ path, sha: `s-${path}` })),
    }),
    readTexts: async (entries) => new Map(entries.map((e) => [e.path, remote.files.get(e.path)!])),
    readBytes: async () => new Uint8Array(),
    commit: async (changes: GitChange[], opts: GitCommitOptions) => {
      remote.commits.push({ changes, message: opts.message });
      for (const c of changes) {
        if (c.type === "delete") remote.files.delete(c.path);
        else remote.files.set(c.path, c.content);
      }
      remote.head++;
      return `c${remote.head}`;
    },
    permissions: async () => ({ login: "t", canWrite: true, isAdmin: true }),
  };
  return { ...actual, createRemoteGitTransport: () => transport };
});

import { createGitPagesConnector } from "./gitPages";
import { createS3Connector } from "./s3";
import { createBrowserMirrorConnector, exportMirrorZip, clearMirror } from "./browserMirror";

describe("git-pages connector", () => {
  // The GitHub Pages auto-enable call must not hit the network in tests.
  beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 }))));
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    remote.files.clear();
    remote.commits.length = 0;
    remote.head = 0;
  });

  const base = { provider: "github" as const, owner: "me", repo: "site", branch: "main", token: "t" };

  it("commits a batch under the site dir with the GitHub Pages marker", async () => {
    const c = createGitPagesConnector({ ...base, dir: "docs", siteUrl: "https://me.github.io/site/", host: "github-pages" });
    await c.commitBatch!([
      { type: "put", path: "index.html", content: "home" },
      { type: "put", path: "news/a.html", content: "a" },
    ]);
    expect(remote.commits).toHaveLength(1);
    expect([...remote.files.keys()].sort()).toEqual(["docs/.nojekyll", "docs/index.html", "docs/news/a.html"]);
    expect(remote.commits[0].message).toBe("Publish files (2 updated) — AgentCRM");
    expect(await c.publicUrl("/news/a.html")).toBe("https://me.github.io/site/news/a.html");
    expect(await c.get("news/a.html")).toBe("a");
  });

  it("marks data-only commits [skip ci] (no build per save)", async () => {
    const c = createGitPagesConnector({ ...base, branch: "main" });
    await c.commitBatch!([{ type: "put", path: "crm/journal/a.bin", content: "x" }]);
    expect(remote.commits[0].message).toBe("Update data (1 updated) — AgentCRM [skip ci]");
  });

  it("lists paths under a prefix, relative to the dir", async () => {
    remote.files.set("data/crm/journal/2.bin", "2");
    remote.files.set("data/crm/journal/1.bin", "1");
    remote.files.set("data/crm/snapshot.bin", "s");
    remote.files.set("other/x.bin", "x");
    const c = createGitPagesConnector({ ...base, dir: "data" });
    expect(await c.listPrefix!("crm/journal/")).toEqual(["crm/journal/1.bin", "crm/journal/2.bin"]);
    expect(await c.listPrefix!("crm/")).toEqual(["crm/journal/1.bin", "crm/journal/2.bin", "crm/snapshot.bin"]);
  });

  it("expands prefix deletes from the tree and lists site-relative paths", async () => {
    remote.files.set("media/x/a.webp", "1");
    remote.files.set("media/x/b.webp", "2");
    remote.files.set("media/y/c.webp", "3");
    const c = createGitPagesConnector({ ...base, siteUrl: "https://site.pages.dev", host: "cloudflare-pages" });
    await c.commitBatch!([{ type: "deletePrefix", path: "media/x" }]);
    expect([...remote.files.keys()]).toEqual(["media/y/c.webp"]);
    const listing = await c.list!(1, 10);
    expect(listing.items.map((i) => i.path)).toEqual(["media/y/c.webp"]);
  });

  it("adds a GitLab CI file once and defaults the dir to public", async () => {
    const c = createGitPagesConnector({
      provider: "gitlab",
      project: "g/site",
      branch: "main",
      token: "t",
      siteUrl: "https://g.gitlab.io/site",
      host: "gitlab-pages",
    });
    await c.put({ path: "index.html", content: "home" });
    expect(remote.files.has("public/index.html")).toBe(true);
    expect(remote.files.get(".gitlab-ci.yml")).toContain('$CI_COMMIT_BRANCH == "main"');
    await c.put({ path: "a.html", content: "a" });
    expect(remote.commits[1].changes).toHaveLength(1);
  });
});

describe("s3 connector", () => {
  const calls: Array<{ method: string; url: string; headers: Record<string, string> }> = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ method: init.method ?? "GET", url, headers: init.headers as Record<string, string> });
        if (url.includes("list-type=2")) {
          return new Response(
            "<ListBucketResult><IsTruncated>false</IsTruncated>" +
              "<Contents><Key>site/media/a/1.webp</Key><Size>10</Size></Contents>" +
              "<Contents><Key>site/media/a/2&amp;x.webp</Key><Size>20</Size></Contents>" +
              "</ListBucketResult>",
            { status: 200 },
          );
        }
        return init.method === "DELETE" ? new Response(null, { status: 204 }) : new Response("", { status: 200 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const settings = {
    endpoint: "https://acc.r2.cloudflarestorage.com",
    region: "auto",
    bucket: "my-site",
    accessKeyId: "AK",
    secretAccessKey: "SK",
    prefix: "site",
    siteUrl: "https://cdn.example.com",
  };

  it("PUTs path-style with signed headers, content type and cache control", async () => {
    await createS3Connector(settings).put({ path: "news/é a.html", content: "<p>x</p>" });
    const call = calls[0];
    expect(call.method).toBe("PUT");
    expect(call.url).toBe("https://acc.r2.cloudflarestorage.com/my-site/site/news/%C3%A9%20a.html");
    expect(call.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(call.headers["cache-control"]).toBe("no-cache");
    expect(call.headers["x-amz-content-sha256"]).toBe("UNSIGNED-PAYLOAD");
    expect(call.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/auto\/s3\/aws4_request/);
  });

  it("uses virtual-hosted style on AWS", async () => {
    await createS3Connector({ ...settings, endpoint: undefined, region: "eu-west-3", prefix: "" }).get("index.html");
    expect(calls[0].url).toBe("https://my-site.s3.eu-west-3.amazonaws.com/index.html");
  });

  it("deletes a prefix by listing keys (XML entities decoded)", async () => {
    await createS3Connector(settings).deletePrefix!("media/a");
    // Deletes run in parallel (mapLimit) — compare as a set.
    const deletes = calls.filter((c) => c.method === "DELETE").map((c) => c.url).sort();
    expect(deletes).toEqual([
      "https://acc.r2.cloudflarestorage.com/my-site/site/media/a/1.webp",
      "https://acc.r2.cloudflarestorage.com/my-site/site/media/a/2%26x.webp",
    ]);
    expect(calls[0].url).toContain("prefix=site%2Fmedia%2Fa%2F");
  });
});

describe("s3 listPrefix", () => {
  const seen: string[] = [];
  beforeEach(() => {
    seen.length = 0;
    let page = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(url);
        page++;
        // Two pages: the first one truncated with a continuation token.
        if (page === 1) {
          return new Response(
            "<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>tok&amp;1</NextContinuationToken>" +
              "<Contents><Key>crm/journal/b.bin</Key><Size>1</Size></Contents></ListBucketResult>",
            { status: 200 },
          );
        }
        return new Response(
          "<ListBucketResult><IsTruncated>false</IsTruncated>" +
            "<Contents><Key>crm/journal/a.bin</Key><Size>1</Size></Contents></ListBucketResult>",
          { status: 200 },
        );
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("filters on the bucket, follows pagination and strips the key prefix", async () => {
    const c = createS3Connector({
      endpoint: "https://s3.example.com",
      region: "eu",
      bucket: "data",
      accessKeyId: "AK",
      secretAccessKey: "SK",
      prefix: "crm",
    });
    expect(await c.listPrefix!("journal/")).toEqual(["journal/a.bin", "journal/b.bin"]);
    expect(seen[0]).toContain("prefix=crm%2Fjournal%2F");
    expect(seen[1]).toContain("continuation-token=tok%261");
  });
});

describe("browser-mirror connector", () => {
  beforeEach(() => clearMirror());

  it("stores, reads back, deletes by prefix and exports a zip", async () => {
    const c = createBrowserMirrorConnector({ siteUrl: "https://example.com" });
    await c.put({ path: "/index.html", content: "home" });
    await c.put({ path: "media/a/1.webp", content: "AAAA", encoding: "base64" });
    await c.put({ path: "media/a/2.webp", content: "AAAA", encoding: "base64" });
    expect(await c.get("index.html")).toBe("home");
    expect(await c.listPrefix!("media/")).toEqual(["media/a/1.webp", "media/a/2.webp"]);
    await c.deletePrefix!("media/a");
    expect((await c.list!(1, 10)).items.map((i) => i.path)).toEqual(["index.html"]);
    const zip = await exportMirrorZip();
    expect(zip.size).toBeGreaterThan(0);
  });
});
