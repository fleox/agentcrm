import { getCachedTexts, putCachedTexts } from "./blobCache";
import { base64ToBytes, base64ToUtf8 } from "./encoding";
import { gitFetch, mapLimit } from "./http";
import {
  GitConflictError,
  type GitChange,
  type GitCommitOptions,
  type GitPermissions,
  type GitRemoteConfig,
  type GitTransport,
  type GitTree,
  type GitTreeEntry,
} from "./types";

// GitHub transport — REST Git Data API for trees / commits / refs,
// GraphQL for batched text reads. CORS-enabled on api.github.com, so it
// runs straight from the browser with a fine-grained personal access
// token (Contents: read & write on the target repo).

type GitHubConfig = Extract<GitRemoteConfig, { provider: "github" }>;

// GitHub caps tree creation payloads; chaining base_tree keeps each
// request small while the result is still ONE commit.
const TREE_CHUNK = 300;
const GRAPHQL_BATCH = 50;
const MAX_REF_RETRIES = 3;

interface RawTreeItem {
  path: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

export function createGitHubTransport(cfg: GitHubConfig): GitTransport {
  const api = (cfg.apiBaseUrl || "https://api.github.com").replace(/\/+$/, "");
  // github.com → api.github.com/graphql ; GHE → <host>/api/graphql
  const graphqlUrl = api.endsWith("/api/v3") ? api.replace(/\/api\/v3$/, "/api/graphql") : `${api}/graphql`;
  const repoUrl = `${api}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
  const refPath = `heads/${cfg.branch.split("/").map(encodeURIComponent).join("/")}`;
  const headers: HeadersInit = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const jsonHeaders: HeadersInit = { ...headers, "Content-Type": "application/json" };

  async function getJson<T>(url: string, action: "get" | "list" = "get"): Promise<T> {
    const res = await gitFetch(action, url, { headers, cache: "no-store" });
    return (await res.json()) as T;
  }

  async function postJson<T>(url: string, body: unknown, method = "POST"): Promise<T> {
    const res = await gitFetch("commit", url, { method, headers: jsonHeaders, body: JSON.stringify(body) });
    return (await res.json()) as T;
  }

  // "" when the branch doesn't exist yet (or the repo is empty).
  async function headSha(): Promise<string> {
    const res = await gitFetch("get", `${repoUrl}/git/ref/${refPath}`, { headers, cache: "no-store" }, [404, 409]);
    if (!res.ok) return "";
    const data = (await res.json()) as { object?: { sha?: string } } | Array<unknown>;
    // A prefix match returns an array of refs — treat as "not found".
    if (Array.isArray(data)) return "";
    return data.object?.sha ?? "";
  }

  async function treeShaOf(commitSha: string): Promise<string> {
    const commit = await getJson<{ tree: { sha: string } }>(`${repoUrl}/git/commits/${commitSha}`);
    return commit.tree.sha;
  }

  // Non-recursive walk, used when the recursive listing is truncated
  // (very large repos).
  async function walk(treeSha: string, prefix: string, out: GitTreeEntry[]): Promise<void> {
    const data = await getJson<{ tree: RawTreeItem[] }>(`${repoUrl}/git/trees/${treeSha}`, "list");
    for (const item of data.tree) {
      const path = prefix + item.path;
      if (item.type === "blob") out.push({ path, sha: item.sha, size: item.size });
      else if (item.type === "tree") await walk(item.sha, path + "/", out);
    }
  }

  async function listTreeAt(head: string): Promise<GitTree> {
    if (!head) return { headSha: "", entries: [] };
    const treeSha = await treeShaOf(head);
    const data = await getJson<{ tree: RawTreeItem[]; truncated: boolean }>(
      `${repoUrl}/git/trees/${treeSha}?recursive=1`,
      "list",
    );
    if (!data.truncated) {
      return {
        headSha: head,
        entries: data.tree
          .filter((t) => t.type === "blob")
          .map((t) => ({ path: t.path, sha: t.sha, size: t.size })),
      };
    }
    const entries: GitTreeEntry[] = [];
    await walk(treeSha, "", entries);
    return { headSha: head, entries };
  }

  async function readBlobBase64(sha: string): Promise<string> {
    const blob = await getJson<{ content: string; encoding: string }>(`${repoUrl}/git/blobs/${sha}`);
    return blob.content;
  }

  // GraphQL: up to GRAPHQL_BATCH blobs per request, by oid. Returns the
  // texts it could read; binary / truncated / errored blobs are left
  // for the REST fallback.
  async function graphqlTexts(shas: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < shas.length; i += GRAPHQL_BATCH) {
      const batch = shas.slice(i, i + GRAPHQL_BATCH);
      const fields = batch
        .map((sha, j) => `b${j}: object(oid: "${sha}") { ... on Blob { text isBinary isTruncated } }`)
        .join("\n");
      const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`;
      try {
        const res = await fetch(graphqlUrl, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ query, variables: { owner: cfg.owner, name: cfg.repo } }),
        });
        if (!res.ok) continue;
        const json = (await res.json()) as {
          data?: { repository?: Record<string, { text?: string; isBinary?: boolean; isTruncated?: boolean } | null> };
        };
        const repo = json.data?.repository;
        if (!repo) continue;
        batch.forEach((sha, j) => {
          const blob = repo[`b${j}`];
          if (blob && !blob.isBinary && !blob.isTruncated && typeof blob.text === "string") {
            out.set(sha, blob.text);
          }
        });
      } catch {
        // Network / GraphQL hiccup — the REST fallback covers it.
      }
    }
    return out;
  }

  async function readTexts(entries: GitTreeEntry[]): Promise<Map<string, string>> {
    const shas = [...new Set(entries.map((e) => e.sha))];
    const bySha = await getCachedTexts(shas);
    const missing = shas.filter((sha) => !bySha.has(sha));
    const fetched = new Map<string, string>();
    if (missing.length > 0) {
      const viaGraphql = await graphqlTexts(missing);
      for (const [sha, text] of viaGraphql) fetched.set(sha, text);
      const rest = missing.filter((sha) => !fetched.has(sha));
      await mapLimit(rest, 6, async (sha) => {
        fetched.set(sha, base64ToUtf8(await readBlobBase64(sha)));
      });
      await putCachedTexts(fetched);
    }
    const out = new Map<string, string>();
    for (const e of entries) {
      const text = bySha.get(e.sha) ?? fetched.get(e.sha);
      if (text !== undefined) out.set(e.path, text);
    }
    return out;
  }

  async function readBytes(entry: GitTreeEntry): Promise<Uint8Array> {
    return base64ToBytes(await readBlobBase64(entry.sha));
  }

  // Creates the branch when it doesn't exist. Empty repo → the contents
  // API (the only write endpoint that works before the first commit).
  // Existing repo → an ORPHAN branch holding a single .gitkeep, so a
  // dedicated site / content branch never inherits unrelated files.
  async function bootstrapBranch(message: string): Promise<string> {
    const repo = await getJson<{ default_branch?: string }>(repoUrl);
    const defaultRes = repo.default_branch
      ? await gitFetch(
          "get",
          `${repoUrl}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`,
          { headers, cache: "no-store" },
          [404, 409],
        )
      : null;
    if (!defaultRes || !defaultRes.ok) {
      const created = await postJson<{ commit: { sha: string } }>(
        `${repoUrl}/contents/.gitkeep`,
        { message, content: "", branch: cfg.branch },
        "PUT",
      );
      return created.commit.sha;
    }
    const tree = await postJson<{ sha: string }>(`${repoUrl}/git/trees`, {
      tree: [{ path: ".gitkeep", mode: "100644", type: "blob", content: "" }],
    });
    const commit = await postJson<{ sha: string }>(`${repoUrl}/git/commits`, {
      message,
      tree: tree.sha,
      parents: [],
    });
    await postJson(`${repoUrl}/git/refs`, { ref: `refs/heads/${cfg.branch}`, sha: commit.sha });
    return commit.sha;
  }

  async function commit(changes: GitChange[], opts: GitCommitOptions): Promise<string> {
    // Binary blobs are uploaded once and reused across ref-race retries.
    const blobShas = new Map<string, string>();

    for (let attempt = 0; ; attempt++) {
      let head = await headSha();
      if (opts.expectedHeadSha !== undefined && head !== opts.expectedHeadSha) {
        throw new GitConflictError(`Branch ${cfg.branch} moved`, head);
      }
      if (!head) head = await bootstrapBranch("Initialize branch — AgentCRM");
      // After the bootstrap: on an empty repository GitHub refuses every
      // git data write (blobs included) until the first commit exists.
      for (const change of changes) {
        if (change.type === "put" && change.encoding === "base64" && !blobShas.has(change.path)) {
          const blob = await postJson<{ sha: string }>(`${repoUrl}/git/blobs`, {
            content: change.content,
            encoding: "base64",
          });
          blobShas.set(change.path, blob.sha);
        }
      }
      const baseTree = await treeShaOf(head);

      // Deleting a path that isn't in the base tree is a 422 on GitHub —
      // drop those (already-gone == desired state).
      let existing: Set<string> | null = null;
      if (changes.some((c) => c.type === "delete")) {
        existing = new Set((await listTreeAt(head)).entries.map((e) => e.path));
      }
      const items: Array<Record<string, unknown>> = [];
      for (const change of changes) {
        if (change.type === "delete") {
          if (existing?.has(change.path)) {
            items.push({ path: change.path, mode: "100644", type: "blob", sha: null });
          }
        } else if (change.encoding === "base64") {
          items.push({ path: change.path, mode: "100644", type: "blob", sha: blobShas.get(change.path) });
        } else {
          items.push({ path: change.path, mode: "100644", type: "blob", content: change.content });
        }
      }

      let tree = baseTree;
      for (let i = 0; i < items.length; i += TREE_CHUNK) {
        const res = await postJson<{ sha: string }>(`${repoUrl}/git/trees`, {
          base_tree: tree,
          tree: items.slice(i, i + TREE_CHUNK),
        });
        tree = res.sha;
      }
      // Identical content → no empty commit.
      if (tree === baseTree) return head;

      const created = await postJson<{ sha: string }>(`${repoUrl}/git/commits`, {
        message: opts.message,
        tree,
        parents: [head],
      });
      const update = await gitFetch(
        "commit",
        `${repoUrl}/git/refs/${refPath}`,
        { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ sha: created.sha, force: false }) },
        [409, 422],
      );
      if (update.ok) return created.sha;
      // Someone pushed in between (non-fast-forward).
      if (opts.expectedHeadSha !== undefined) {
        throw new GitConflictError(`Branch ${cfg.branch} moved`, await headSha());
      }
      if (attempt >= MAX_REF_RETRIES) {
        throw new GitConflictError(`Branch ${cfg.branch} kept moving`, await headSha());
      }
    }
  }

  async function resetBranch(
    files: Array<{ path: string; content: string; encoding: "base64" }>,
    opts: { message: string; expectedHeadSha: string },
  ): Promise<string> {
    const items = [];
    for (const f of files) {
      const blob = await postJson<{ sha: string }>(`${repoUrl}/git/blobs`, { content: f.content, encoding: "base64" });
      items.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const tree = await postJson<{ sha: string }>(`${repoUrl}/git/trees`, { tree: items });
    const created = await postJson<{ sha: string }>(`${repoUrl}/git/commits`, { message: opts.message, tree: tree.sha, parents: [] });
    // Last check right before the forced move: a save in between wins.
    const head = await headSha();
    if (head !== opts.expectedHeadSha) throw new GitConflictError(`Branch ${cfg.branch} moved`, head);
    await gitFetch("commit", `${repoUrl}/git/refs/${refPath}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ sha: created.sha, force: true }),
    });
    return created.sha;
  }

  async function permissions(): Promise<GitPermissions> {
    const [user, repo] = await Promise.all([
      getJson<{ login: string }>(`${api}/user`),
      getJson<{ private?: boolean; visibility?: string; permissions?: { admin?: boolean; maintain?: boolean; push?: boolean } }>(repoUrl),
    ]);
    const p = repo.permissions ?? {};
    const visibility =
      repo.visibility === "public" || repo.visibility === "private" || repo.visibility === "internal"
        ? repo.visibility
        : typeof repo.private === "boolean"
          ? repo.private
            ? "private"
            : "public"
          : undefined;
    return { login: user.login, canWrite: !!(p.push || p.maintain || p.admin), isAdmin: !!(p.admin || p.maintain), visibility };
  }

  return {
    kind: "github",
    label: `${cfg.owner}/${cfg.repo}@${cfg.branch}`,
    headSha,
    listTree: async () => listTreeAt(await headSha()),
    readTexts,
    readBytes,
    commit,
    permissions,
    resetBranch,
  };
}
