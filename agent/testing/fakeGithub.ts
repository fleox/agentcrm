import { createHash } from "node:crypto";

// In-memory GitHub (the REST + GraphQL subset src/shared/git/github.ts
// uses) plus GitHub Pages serving each repo's branch at
// https://<owner>.github.io/<repo>/. Install as `fetch` in tests.
// Trees are flat path → blob maps: the transport only asks for
// recursive listings.

interface Repo {
  defaultBranch: string | null;
  refs: Map<string, string>;
  pages: boolean;
  private: boolean;
  pagesHeld?: string | null;
}

export interface FakeGithub {
  fetch: typeof fetch;
  createRepo(fullName: string, opts?: { private?: boolean }): void;
  files(fullName: string, branch?: string): Map<string, string>;
  commits(fullName: string, branch?: string): string[];
  repo(fullName: string): Repo;
  // Commits files straight to a branch (null deletes), like a push.
  writeFiles(fullName: string, files: Record<string, string | null>, branch?: string, message?: string): void;
  // Pages keeps serving the current head until called again with false
  // (a build still running / queued).
  holdPages(fullName: string, on: boolean): void;
  calls: string[];
}

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function createFakeGithub(opts: { login: string; token: string }): FakeGithub {
  const blobs = new Map<string, Buffer>();
  const trees = new Map<string, Map<string, string>>();
  const commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  const repos = new Map<string, Repo>();
  const calls: string[] = [];
  let counter = 0;

  const putBlob = (buf: Buffer) => {
    const id = sha(`blob:${buf.toString("base64")}`);
    blobs.set(id, buf);
    return id;
  };
  const putTree = (map: Map<string, string>) => {
    const id = sha(`tree:${[...map].sort(([a], [b]) => a.localeCompare(b)).map(([p, s]) => `${p}=${s}`).join("\n")}`);
    trees.set(id, new Map(map));
    return id;
  };
  const putCommit = (tree: string, parents: string[], message: string) => {
    const id = sha(`commit:${tree}:${parents.join(",")}:${message}:${counter++}`);
    commits.set(id, { tree, parents, message });
    return id;
  };
  const headFiles = (repo: Repo, branch: string) => {
    const head = repo.refs.get(branch);
    return head ? trees.get(commits.get(head)!.tree)! : new Map<string, string>();
  };

  const mime = (p: string) =>
    p.endsWith(".html") ? "text/html; charset=utf-8" : p.endsWith(".js") ? "application/javascript" : p.endsWith(".css") ? "text/css" : p.endsWith(".json") ? "application/json" : "application/octet-stream";

  const impl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    calls.push(`${method} ${url.host}${url.pathname}`);

    // GitHub Pages: https://<owner>.github.io/<repo>/<path>
    const pagesHost = /^(.+)\.github\.io$/.exec(url.hostname);
    if (pagesHost) {
      const [, repoName, ...rest] = url.pathname.split("/");
      const repo = repos.get(`${pagesHost[1]}/${repoName}`);
      if (!repo?.pages) return new Response("Not found", { status: 404 });
      let path = decodeURIComponent(rest.join("/"));
      if (path === "" || path.endsWith("/")) path += "index.html";
      const served = repo.pagesHeld ? trees.get(commits.get(repo.pagesHeld)!.tree)! : headFiles(repo, repo.defaultBranch ?? "main");
      const blob = served.get(path);
      return blob ? new Response(new Uint8Array(blobs.get(blob)!), { status: 200, headers: { "content-type": mime(path) } }) : new Response("Not found", { status: 404 });
    }

    if (url.hostname !== "api.github.com") throw new TypeError(`fake github: unexpected host ${url.hostname}`);
    const auth = new Headers(init.headers).get("authorization");
    if (auth !== `Bearer ${opts.token}`) return json({ message: "Bad credentials" }, 401);
    const body = init.body ? JSON.parse(String(init.body)) : {};

    if (url.pathname === "/user") return json({ login: opts.login });
    if (url.pathname === "/graphql") {
      const repo: Record<string, unknown> = {};
      for (const m of String(body.query).matchAll(/(b\d+): object\(oid: "([0-9a-f]+)"\)/g)) {
        const blob = blobs.get(m[2]);
        repo[m[1]] = blob ? { text: blob.toString("utf8"), isBinary: false, isTruncated: false } : null;
      }
      return json({ data: { repository: repo } });
    }

    const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!m) return json({ message: "Not Found" }, 404);
    const full = `${m[1]}/${m[2]}`;
    const repo = repos.get(full);
    if (!repo) return json({ message: "Not Found" }, 404);
    const rest = m[3] ?? "";

    if (rest === "" && method === "GET") {
      return json({ full_name: full, default_branch: repo.defaultBranch, private: repo.private, permissions: { admin: true, push: true } });
    }
    if (rest === "/commits" && method === "GET") {
      const branch = url.searchParams.get("sha") ?? repo.defaultBranch ?? "main";
      let count = 0;
      for (let c = repo.refs.get(branch); c; c = commits.get(c)!.parents[0]) count++;
      const link = count > 1 ? `<${url.origin}${url.pathname}?sha=${branch}&per_page=1&page=${count}>; rel="last"` : "";
      return new Response("[]", { headers: { "content-type": "application/json", ...(link ? { link } : {}) } });
    }
    if (rest === "/pages") {
      if (method === "GET") return repo.pages ? json({ status: "built", source: { branch: "main", path: "/" } }) : json({ message: "Not Found" }, 404);
      if (method === "POST") {
        if (!repo.defaultBranch) return json({ message: "branch required" }, 422);
        repo.pages = true;
        return json({ status: "queued" }, 201);
      }
    }
    if (rest === "/contents/.gitkeep" && method === "PUT") {
      const tree = putTree(new Map([[".gitkeep", putBlob(Buffer.from(""))]]));
      const commit = putCommit(tree, [], body.message);
      repo.refs.set(body.branch, commit);
      repo.defaultBranch ??= body.branch;
      return json({ commit: { sha: commit } }, 201);
    }
    // Like GitHub: the git data API refuses writes before the first
    // commit (only the contents API can create it).
    if (!repo.refs.size && method === "POST" && /^\/git\/(blobs|trees|commits)$/.test(rest)) {
      return json({ message: "Git Repository is empty." }, 409);
    }
    let r = /^\/git\/ref\/heads\/(.+)$/.exec(rest);
    if (r && method === "GET") {
      const head = repo.refs.get(decodeURIComponent(r[1]));
      return head ? json({ ref: `refs/heads/${r[1]}`, object: { sha: head } }) : json({ message: "Not Found" }, repo.refs.size ? 404 : 409);
    }
    r = /^\/git\/refs\/heads\/(.+)$/.exec(rest);
    if (r && method === "PATCH") {
      const branch = decodeURIComponent(r[1]);
      const current = repo.refs.get(branch);
      if (!body.force && !commits.get(body.sha)?.parents.includes(current ?? "")) return json({ message: "Update is not a fast forward" }, 422);
      repo.refs.set(branch, body.sha);
      return json({ object: { sha: body.sha } });
    }
    if (rest === "/git/refs" && method === "POST") {
      repo.refs.set(String(body.ref).replace(/^refs\/heads\//, ""), body.sha);
      return json({ object: { sha: body.sha } }, 201);
    }
    r = /^\/git\/commits\/([0-9a-f]+)$/.exec(rest);
    if (r && method === "GET") {
      const c = commits.get(r[1]);
      return c ? json({ sha: r[1], tree: { sha: c.tree }, parents: c.parents.map((p) => ({ sha: p })) }) : json({ message: "Not Found" }, 404);
    }
    if (rest === "/git/commits" && method === "POST") return json({ sha: putCommit(body.tree, body.parents, body.message) }, 201);
    r = /^\/git\/trees\/([0-9a-f]+)$/.exec(rest);
    if (r && method === "GET") {
      const t = trees.get(r[1]);
      if (!t) return json({ message: "Not Found" }, 404);
      return json({ sha: r[1], truncated: false, tree: [...t].map(([path, s]) => ({ path, type: "blob", mode: "100644", sha: s, size: blobs.get(s)!.length })) });
    }
    if (rest === "/git/trees" && method === "POST") {
      const map = new Map(body.base_tree ? trees.get(body.base_tree) : []);
      for (const item of body.tree as { path: string; sha?: string | null; content?: string }[]) {
        if (item.sha === null) map.delete(item.path);
        else if (typeof item.content === "string") map.set(item.path, putBlob(Buffer.from(item.content, "utf8")));
        else map.set(item.path, item.sha!);
      }
      return json({ sha: putTree(map) }, 201);
    }
    if (rest === "/git/blobs" && method === "POST") return json({ sha: putBlob(Buffer.from(body.content, body.encoding === "base64" ? "base64" : "utf8")) }, 201);
    r = /^\/git\/blobs\/([0-9a-f]+)$/.exec(rest);
    if (r && method === "GET") {
      const b = blobs.get(r[1]);
      return b ? json({ sha: r[1], content: b.toString("base64"), encoding: "base64" }) : json({ message: "Not Found" }, 404);
    }
    return json({ message: `fake github: unhandled ${method} ${rest}` }, 501);
  };

  return {
    fetch: impl as typeof fetch,
    calls,
    createRepo(fullName, o = {}) {
      repos.set(fullName, { defaultBranch: null, refs: new Map(), pages: false, private: !!o.private });
    },
    repo: (fullName) => repos.get(fullName)!,
    writeFiles(fullName, files, branch = "main", message = "Test commit") {
      const repo = repos.get(fullName)!;
      const tree = new Map(headFiles(repo, branch));
      for (const [path, content] of Object.entries(files)) {
        if (content === null) tree.delete(path);
        else tree.set(path, putBlob(Buffer.from(content)));
      }
      const parent = repo.refs.get(branch);
      repo.refs.set(branch, putCommit(putTree(tree), parent ? [parent] : [], message));
      repo.defaultBranch ??= branch;
    },
    holdPages(fullName, on) {
      const repo = repos.get(fullName)!;
      repo.pagesHeld = on ? repo.refs.get(repo.defaultBranch ?? "main") ?? null : null;
    },
    files(fullName, branch = "main") {
      const t = headFiles(repos.get(fullName)!, branch);
      return new Map([...t].map(([p, s]) => [p, blobs.get(s)!.toString("utf8")]));
    },
    commits(fullName, branch = "main") {
      const out: string[] = [];
      let c = repos.get(fullName)!.refs.get(branch);
      while (c) {
        const commit = commits.get(c)!;
        out.push(commit.message);
        c = commit.parents[0];
      }
      return out;
    },
  };
}
