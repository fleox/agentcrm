// git-json store engine, independent of where the transport and the
// secrets come from (../gitJson.ts wires the browser / CLI defaults).
// Mirrors cms-ia src/services/docstore/gitStore.ts, with per-field
// merges instead of whole-document conflicts:
//
//   - load: list the tree at head, read every layout file (batched:
//     GraphQL on GitHub, cached by blob sha), build the snapshot;
//   - write(): ONE commit, guarded by the head it was based on
//     (expectedHeadSha). When someone else pushed in between, the store
//     reloads the remote state and re-applies OUR mutations onto it:
//       · patch: merged per field — a conflict only when the remote
//         changed one of the very fields we change (to another value);
//       · set / delete: a conflict when the remote document differs
//         from the version we edited;
//     then commits again (up to MAX_REBASES). A conflict throws
//     DocConflictError: the core rolls our change back and the next
//     poll shows the remote version.
//   - poll: compares the branch head every ~30 s (10 s for a local
//     folder) and reloads when it moved.

import { GitConflictError, joinRepoPath, type GitChange, type GitPermissions, type GitTransport, type GitTreeEntry } from "../../shared/git";
import { bytesToBase64 } from "../../shared/git/encoding";
import { assertFileId, withFileStore } from "../files";
import type { FileStore } from "../types";
import { applyMutations, createStoreCore, type Snapshot } from "../core";
import { getPath, splitPath } from "../patch";
import { DocConflictError, type CollectionName, type DataStore, type DocMutation, type StoreIdentity, type StoredDoc } from "../types";
import { filesToSnapshot, isLayoutFile, MARKER_FILE, markerContent, planChanges, type LayoutIndex, type SecretBag } from "./layout";

export const GIT_JSON_POLL_MS = 30_000;
export const GIT_JSON_LOCAL_POLL_MS = 10_000;
export const MAX_REBASES = 3;

export interface GitJsonStoreOptions {
  // Repo sub-folder holding the data ("" = repo root).
  dir: string;
  // Resolves the transport, or null when this browser has no access yet
  // (no token / folder grant) → identity() null → login screen.
  openTransport(): Promise<GitTransport | null>;
  // Identity derived from the repo permission (see roleFromPermissions).
  // `email`: the address this user is known by in the CRM (per browser).
  identityFor?(perms: GitPermissions, transport: GitTransport): StoreIdentity;
  // Per-browser bag of the secrets stripped from config docs.
  secrets?: { read(): SecretBag; write(bag: SecretBag): void };
  pollIntervalMs?: number;
  // Commit message suffix (default " — AgentCRM [skip ci]").
  messageSuffix?: string;
}

export interface GitJsonDataStore extends DataStore {
  readonly kind: "git-json";
  // Drops the cached transport / identity / remote state — call after
  // the user entered a new token or re-granted folder access.
  resetSession(): void;
  // Last load's unreadable files (invalid JSON), for diagnostics.
  loadErrors(): string[];
  headSha(): string | null;
}

export function isGitJsonStore(store: DataStore): store is GitJsonDataStore {
  return store.kind === "git-json" && typeof (store as Partial<GitJsonDataStore>).resetSession === "function";
}

// GitHub admin / maintain, GitLab Maintainer+ → admin; write → member;
// read only → viewer.
export function roleFromPermissions(p: GitPermissions): StoreIdentity["role"] {
  if (p.isAdmin) return "admin";
  if (p.canWrite) return "member";
  return "viewer";
}

export function defaultGitIdentity(p: GitPermissions, t: GitTransport, email?: string | null): StoreIdentity {
  const noreply =
    t.kind === "github" ? `${p.login}@users.noreply.github.com` : t.kind === "gitlab" ? `${p.login}@users.noreply.gitlab.com` : "local@localhost";
  return {
    uid: t.kind === "local" ? "local" : `${t.kind}:${p.login}`,
    email: email?.trim().toLowerCase() || noreply,
    displayName: p.login,
    role: t.kind === "local" ? "admin" : roleFromPermissions(p),
  };
}

// Uploaded file bytes: files/<id>.bin in the data folder (metadata is the
// files/<id>.json document). Plain bytes: the repo must be private, and
// its history keeps every file ever uploaded (warned in the UI).
export const GIT_FILES_DIR = "files";
export const GIT_LARGE_FILE_WARN_BYTES = 5 * 1024 * 1024;

interface RemoteState {
  head: string;
  // Blob entries of files/*.bin (path relative to the data folder).
  blobs: Map<string, GitTreeEntry>;
  files: Map<string, string>;
  index: LayoutIndex;
  snapshot: Snapshot;
  errors: string[];
}

function keyOf(m: DocMutation): [CollectionName, string] {
  return [m.collection, m.op === "set" ? m.doc.id : m.id];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Throws DocConflictError when a mutation can't be re-applied onto the
// remote version of its document (see the header).
export function checkRebase(mutations: DocMutation[], before: Snapshot, remote: Snapshot, message = "Someone else changed this document — reload to see their version."): void {
  for (const m of mutations) {
    const [collection, id] = keyOf(m);
    const base = before[collection].get(id);
    const theirs = remote[collection].get(id);
    if (same(base, theirs)) continue;
    if (m.op === "patch") {
      // Remote deleted it: the patch becomes a no-op — that's a conflict
      // only if we were editing an existing doc.
      if (!theirs) throw new DocConflictError(message, collection, id);
      for (const [path, value] of Object.entries(m.fields)) {
        const p = splitPath(path);
        const b = getPath(base, p);
        const r = getPath(theirs, p);
        if (!same(b, r) && !same(r, value)) throw new DocConflictError(message, collection, id);
        // A parent path changed remotely (e.g. they replaced `fields`).
        for (let i = 1; i < p.length; i++) {
          const pb = getPath(base, p.slice(0, i));
          const pr = getPath(theirs, p.slice(0, i));
          if ((pb === undefined) !== (pr === undefined)) throw new DocConflictError(message, collection, id);
        }
      }
      continue;
    }
    if (m.op === "set" && same(theirs, m.doc)) continue;
    if (m.op === "delete" && !theirs) continue;
    throw new DocConflictError(message, collection, id);
  }
}

export function createGitJsonStoreWith(opts: GitJsonStoreOptions): GitJsonDataStore {
  const dir = opts.dir.replace(/^\/+|\/+$/g, "");
  const rel = (path: string) => (dir ? path.slice(dir.length + 1) : path);
  const inDir = (path: string) => !dir || path.startsWith(dir + "/");
  const suffix = opts.messageSuffix ?? " — AgentCRM [skip ci]";
  const secrets = opts.secrets ?? { read: () => ({}), write: () => undefined };

  let transport: GitTransport | null = null;
  let identityPromise: Promise<StoreIdentity | null> | null = null;
  let state: RemoteState | null = null;
  // Set after a rebase: our head contains remote changes the core's
  // snapshot hasn't seen yet, so the next poll reloads regardless.
  let stale = false;

  async function openTransport(): Promise<GitTransport | null> {
    if (!transport) transport = await opts.openTransport();
    return transport;
  }

  async function requireTransport(): Promise<GitTransport> {
    const t = await openTransport();
    if (!t) throw new Error("Not connected to the data repository on this browser (missing token or folder access).");
    return t;
  }

  async function loadRemote(): Promise<RemoteState> {
    const t = await requireTransport();
    const tree = await t.listTree();
    const entries = tree.entries.filter((e) => inDir(e.path) && isLayoutFile(rel(e.path)));
    const texts = await t.readTexts(entries);
    const files = new Map<string, string>();
    for (const [path, text] of texts) files.set(rel(path), text);
    const { snapshot, index, errors } = filesToSnapshot(files, secrets.read());
    if (errors.length) console.warn("[git-json] unreadable files:", errors);
    const blobs = new Map<string, GitTreeEntry>();
    for (const e of tree.entries) {
      if (!inDir(e.path)) continue;
      const r = rel(e.path);
      if (r.startsWith(`${GIT_FILES_DIR}/`) && r.endsWith(".bin")) blobs.set(r, e);
    }
    return { head: tree.headSha, blobs, files, index, snapshot, errors };
  }

  async function persist(mutations: DocMutation[], before: Snapshot, _after: Snapshot, message: string): Promise<void> {
    const t = await requireTransport();
    if (!state) state = await loadRemote();
    for (let attempt = 0; ; attempt++) {
      const base: RemoteState = state;
      // Re-apply onto what the remote holds (identical to `before` on the
      // happy path; newer after a rebase or a missed poll).
      checkRebase(mutations, before, base.snapshot);
      const { next } = applyMutations(base.snapshot, mutations);
      const plan = planChanges(mutations.map(keyOf), next, base.files, base.index, secrets.read());
      if (!base.files.has(MARKER_FILE)) {
        plan.changes.push({ type: "put", path: MARKER_FILE, content: markerContent() });
        plan.files.set(MARKER_FILE, markerContent());
      }
      if (plan.changes.length === 0) return;
      const changes: GitChange[] = plan.changes.map((c) =>
        c.type === "put" ? { type: "put", path: joinRepoPath(dir, c.path), content: c.content ?? "" } : { type: "delete", path: joinRepoPath(dir, c.path) },
      );
      try {
        const head = await t.commit(changes, { message: `${message}${suffix}`, expectedHeadSha: base.head });
        secrets.write(plan.secrets);
        state = { head, blobs: base.blobs, files: plan.files, index: plan.index, snapshot: next, errors: base.errors };
        if (base.snapshot !== before && attempt > 0) stale = true;
        return;
      } catch (err) {
        if (!(err instanceof GitConflictError) || attempt >= MAX_REBASES) throw err;
      }
      // Someone else committed: reload and try to rebase our change.
      state = await loadRemote();
      stale = true;
    }
  }

  const core = createStoreCore({
    kind: "git-json",
    pollIntervalMs: opts.pollIntervalMs ?? GIT_JSON_POLL_MS,

    async load() {
      state = await loadRemote();
      stale = false;
      return state.snapshot;
    },

    persist,

    async poll() {
      const t = await openTransport();
      if (!t || !state) return null;
      const head = await t.headSha();
      if (head === state.head && !stale) return null;
      state = await loadRemote();
      stale = false;
      return state.snapshot;
    },

    identity() {
      if (!identityPromise) {
        identityPromise = (async () => {
          const t = await openTransport();
          if (!t) return null;
          try {
            const p = await t.permissions();
            return opts.identityFor ? opts.identityFor(p, t) : defaultGitIdentity(p, t);
          } catch (err) {
            console.warn("[git-json] permission check failed:", err);
            return null;
          }
        })();
        void identityPromise.then((id) => {
          // Never cache "signed out" — a token entered later must count.
          if (!id) {
            identityPromise = null;
            transport = null;
          }
        });
      }
      return identityPromise;
    },
  });

  // ─── Files ────────────────────────────────────────────────────────────
  const blobPath = (id: string) => `${GIT_FILES_DIR}/${id}.bin`;
  // Commits blob changes in ONE commit. Based on our head when we have
  // one (so the next data write doesn't need a rebase), else / on a
  // conflict last-writer-wins (blobs never conflict: ids are unique).
  async function commitBlobs(changes: GitChange[], message: string): Promise<void> {
    const t = await requireTransport();
    const full: GitChange[] = changes.map((c) => ({ ...c, path: joinRepoPath(dir, c.path) }));
    const msg = `${message}${suffix}`;
    if (state) {
      try {
        const head = await t.commit(full, { message: msg, expectedHeadSha: state.head });
        const blobs = new Map(state.blobs);
        for (const c of changes) {
          if (c.type === "put") blobs.set(c.path, { path: joinRepoPath(dir, c.path), sha: "" });
          else blobs.delete(c.path);
        }
        state = { ...state, head, blobs };
        return;
      } catch (err) {
        if (!(err instanceof GitConflictError)) throw err;
      }
    }
    await t.commit(full, { message: msg });
    stale = true;
  }
  async function findBlob(id: string): Promise<GitTreeEntry | null> {
    const p = blobPath(id);
    let e = state?.blobs.get(p);
    if (!e || !e.sha) {
      // Unknown or just uploaded by us (no sha yet): list the tree again.
      const t = await requireTransport();
      const tree = await t.listTree();
      const full = joinRepoPath(dir, p);
      e = tree.entries.find((x) => x.path === full);
      if (e && state) state.blobs.set(p, e);
    }
    return e ?? null;
  }
  const files: FileStore = {
    kind: "git-json",
    async put(id, bytes) {
      await files.putMany!([{ id, bytes }]);
    },
    async putMany(items) {
      if (!items.length) return;
      for (const it of items) assertFileId(it.id);
      const total = items.reduce((n, it) => n + it.bytes.length, 0);
      if (total > GIT_LARGE_FILE_WARN_BYTES) console.warn(`[git-json] committing ${Math.round(total / 1024)} KB of files: git history keeps them forever and large repos get slow.`);
      await commitBlobs(
        items.map((it) => ({ type: "put", path: blobPath(it.id), content: bytesToBase64(it.bytes), encoding: "base64" })),
        `Upload ${items.length === 1 ? (items[0].meta?.name ?? "a file") : `${items.length} files`}`,
      );
    },
    async get(id) {
      assertFileId(id);
      const entry = await findBlob(id);
      if (!entry) return null;
      return (await requireTransport()).readBytes(entry);
    },
    async delete(id) {
      assertFileId(id);
      if (!(await findBlob(id))) return;
      await commitBlobs([{ type: "delete", path: blobPath(id) }], "Purge a file");
    },
    async list() {
      const t = await requireTransport();
      const tree = await t.listTree();
      const prefix = joinRepoPath(dir, `${GIT_FILES_DIR}/`);
      return tree.entries.filter((e) => e.path.startsWith(prefix) && e.path.endsWith(".bin")).map((e) => e.path.slice(prefix.length, -".bin".length)).filter((id) => !id.includes("/")).sort();
    },
  };
  withFileStore(core, files);

  return Object.assign(core as GitJsonDataStore, {
    resetSession() {
      transport = null;
      identityPromise = null;
      state = null;
      stale = false;
    },
    loadErrors: () => state?.errors ?? [],
    headSha: () => state?.head ?? null,
  });
}

// Reads the marker / documents of a repo folder WITHOUT a store — used by
// the setup wizard to detect an existing dataset (no side effect).
export async function inspectGitJsonFolder(t: GitTransport, dir: string): Promise<{ exists: boolean; documents: number; hasUsers: boolean; name?: string }> {
  const d = dir.replace(/^\/+|\/+$/g, "");
  const tree = await t.listTree();
  const relPaths = tree.entries.map((e) => (d ? (e.path.startsWith(d + "/") ? e.path.slice(d.length + 1) : null) : e.path)).filter((p): p is string => p !== null);
  const docs = relPaths.filter((p) => p !== MARKER_FILE && isLayoutFile(p));
  const exists = relPaths.includes(MARKER_FILE) || docs.some((p) => p.startsWith("objects/"));
  let name: string | undefined;
  const settingsEntry = tree.entries.find((e) => e.path === joinRepoPath(d, "settings/general.json"));
  if (settingsEntry) {
    const text = (await t.readTexts([settingsEntry])).get(settingsEntry.path);
    try {
      name = text ? ((JSON.parse(text) as StoredDoc).name as string | undefined) : undefined;
    } catch {
      // ignore
    }
  }
  return { exists, documents: docs.length, hasUsers: docs.some((p) => p.startsWith("users/")), name };
}
