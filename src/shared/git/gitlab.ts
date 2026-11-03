import { getCachedTexts, putCachedTexts } from "./blobCache";
import { utf8ToBase64 } from "./encoding";
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

// GitLab transport — REST v4. Multi-file commits are native
// (POST /repository/commits with an `actions` array), and the API is
// CORS-enabled on gitlab.com. Auth: personal / project access token
// (scope `api`) or an OAuth (PKCE) access token — both go in a Bearer
// header.

type GitLabConfig = Extract<GitRemoteConfig, { provider: "gitlab" }>;

const MAX_RETRIES = 3;

// GitLab access levels: 30 = Developer (push), 40 = Maintainer.
const WRITE_LEVEL = 30;
const ADMIN_LEVEL = 40;

export function createGitLabTransport(cfg: GitLabConfig): GitTransport {
  const api = (cfg.apiBaseUrl || "https://gitlab.com/api/v4").replace(/\/+$/, "");
  const projectUrl = `${api}/projects/${encodeURIComponent(cfg.project)}`;
  const headers: HeadersInit = { Authorization: `Bearer ${cfg.token}` };
  const jsonHeaders: HeadersInit = { ...headers, "Content-Type": "application/json" };

  // Path sets per head sha — the commit API needs to know whether each
  // put is a "create" or an "update", and a listing per commit would be
  // wasteful. Seeded by listTree, advanced by our own commits.
  const pathsByHead = new Map<string, Set<string>>();

  async function getJson<T>(url: string, action: "get" | "list" = "get"): Promise<T> {
    const res = await gitFetch(action, url, { headers, cache: "no-store" });
    return (await res.json()) as T;
  }

  async function headSha(): Promise<string> {
    const res = await gitFetch(
      "get",
      `${projectUrl}/repository/branches/${encodeURIComponent(cfg.branch)}`,
      { headers, cache: "no-store" },
      [404],
    );
    if (!res.ok) return "";
    const data = (await res.json()) as { commit?: { id?: string } };
    return data.commit?.id ?? "";
  }

  async function listTreeAt(head: string): Promise<GitTree> {
    if (!head) return { headSha: "", entries: [] };
    const entries: GitTreeEntry[] = [];
    for (let page = 1; ; page++) {
      const url = `${projectUrl}/repository/tree?${new URLSearchParams({
        ref: head,
        recursive: "true",
        per_page: "100",
        page: String(page),
      })}`;
      const res = await gitFetch("list", url, { headers, cache: "no-store" });
      const items = (await res.json()) as Array<{ id: string; path: string; type: "blob" | "tree" }>;
      for (const item of items) {
        if (item.type === "blob") entries.push({ path: item.path, sha: item.id });
      }
      const nextPage = res.headers.get("x-next-page");
      if (!nextPage || items.length === 0) break;
    }
    pathsByHead.set(head, new Set(entries.map((e) => e.path)));
    return { headSha: head, entries };
  }

  async function rawBlob(sha: string): Promise<Response> {
    return gitFetch("get", `${projectUrl}/repository/blobs/${sha}/raw`, { headers });
  }

  async function readTexts(entries: GitTreeEntry[]): Promise<Map<string, string>> {
    const shas = [...new Set(entries.map((e) => e.sha))];
    const bySha = await getCachedTexts(shas);
    const missing = shas.filter((sha) => !bySha.has(sha));
    const fetched = new Map<string, string>();
    await mapLimit(missing, 6, async (sha) => {
      fetched.set(sha, await (await rawBlob(sha)).text());
    });
    await putCachedTexts(fetched);
    const out = new Map<string, string>();
    for (const e of entries) {
      const text = bySha.get(e.sha) ?? fetched.get(e.sha);
      if (text !== undefined) out.set(e.path, text);
    }
    return out;
  }

  async function readBytes(entry: GitTreeEntry): Promise<Uint8Array> {
    return new Uint8Array(await (await rawBlob(entry.sha)).arrayBuffer());
  }

  async function existingPaths(head: string): Promise<Set<string>> {
    if (!head) return new Set();
    return pathsByHead.get(head) ?? new Set((await listTreeAt(head)).entries.map((e) => e.path));
  }

  async function defaultBranch(): Promise<string | undefined> {
    const project = await getJson<{ default_branch?: string }>(projectUrl);
    return project.default_branch || undefined;
  }

  async function commit(changes: GitChange[], opts: GitCommitOptions): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      const head = await headSha();
      if (opts.expectedHeadSha !== undefined && head !== opts.expectedHeadSha) {
        throw new GitConflictError(`Branch ${cfg.branch} moved`, head);
      }
      const existing = await existingPaths(head);
      const actions: Array<Record<string, unknown>> = [];
      const after = new Set(existing);
      for (const change of changes) {
        if (change.type === "delete") {
          if (!existing.has(change.path)) continue;
          actions.push({ action: "delete", file_path: change.path });
          after.delete(change.path);
        } else {
          actions.push({
            action: existing.has(change.path) ? "update" : "create",
            file_path: change.path,
            encoding: "base64",
            content: change.encoding === "base64" ? change.content : utf8ToBase64(change.content),
          });
          after.add(change.path);
        }
      }
      if (actions.length === 0) return head;

      const body: Record<string, unknown> = {
        branch: cfg.branch,
        commit_message: opts.message,
        actions,
      };
      // Missing branch on a non-empty project: start it from the default
      // branch (GitLab has no orphan-branch API). Empty project: the
      // first commit creates the branch on its own.
      if (!head) {
        const base = await defaultBranch();
        if (base && base !== cfg.branch) body.start_branch = base;
      }
      const res = await gitFetch(
        "commit",
        `${projectUrl}/repository/commits`,
        { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) },
        // 400 = create/update mismatch: someone added / removed a file
        // since our listing. Refresh and retry.
        [400],
      );
      if (res.ok) {
        const created = (await res.json()) as { id: string };
        pathsByHead.set(created.id, after);
        return created.id;
      }
      pathsByHead.delete(head);
      if (opts.expectedHeadSha !== undefined || attempt >= MAX_RETRIES) {
        throw new GitConflictError(`Commit on ${cfg.branch} rejected: ${await res.text()}`, await headSha());
      }
    }
  }

  async function permissions(): Promise<GitPermissions> {
    const [user, project] = await Promise.all([
      getJson<{ username: string }>(`${api}/user`),
      getJson<{
        visibility?: string;
        permissions?: {
          project_access?: { access_level?: number } | null;
          group_access?: { access_level?: number } | null;
        };
      }>(projectUrl),
    ]);
    const level = Math.max(
      project.permissions?.project_access?.access_level ?? 0,
      project.permissions?.group_access?.access_level ?? 0,
    );
    const v = project.visibility;
    const visibility = v === "public" || v === "private" || v === "internal" ? v : undefined;
    return { login: user.username, canWrite: level >= WRITE_LEVEL, isAdmin: level >= ADMIN_LEVEL, visibility };
  }

  return {
    kind: "gitlab",
    label: `${cfg.project}@${cfg.branch}`,
    headSha,
    listTree: async () => listTreeAt(await headSha()),
    readTexts,
    readBytes,
    commit,
    permissions,
  };
}
