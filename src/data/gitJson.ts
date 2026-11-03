// git-json backend: one JSON file per document in a PRIVATE repo
// (layout in ./gitJson/layout.ts) through src/shared/git — GitHub /
// GitLab REST (GraphQL batched reads on GitHub) or a local folder that is
// a git clone (File System Access API). One commit per write(); each
// user signs in with their OWN token (per browser, never in config.js
// nor in the repo); repo permission → role (admin / maintain → admin,
// write → member, read → viewer). Engine: ./gitJson/store.ts.
//
// Warning shown in the UI: git history keeps every past version of the
// data, including personal data you later delete.

import {
  datasetId,
  getGitToken,
  getSecret,
  getSecretJson,
  setGitToken,
  setSecret,
  setSecretJson,
  type GitJsonRuntimeConfig,
  type RuntimeConfig,
} from "../lib/runtimeConfig";
import { createLocalFsTransport, createRemoteGitTransport, ensureFolderPermission, loadFolderHandle, type GitTransport } from "../shared/git";
import type { BackendOptions } from "./registry";
import { createGitJsonStoreWith, defaultGitIdentity, GIT_JSON_LOCAL_POLL_MS, GIT_JSON_POLL_MS, type GitJsonDataStore } from "./gitJson/store";
import type { SecretBag } from "./gitJson/layout";

export { createGitJsonStoreWith, isGitJsonStore, inspectGitJsonFolder, roleFromPermissions, checkRebase, type GitJsonDataStore, type GitJsonStoreOptions } from "./gitJson/store";
export { createMemoryGitTransport, createMemoryRepo, type MemoryRepo } from "./gitJson/memoryTransport";
export * from "./gitJson/layout";

export type GitJsonConfig = GitJsonRuntimeConfig["git"];

// IndexedDB key of the local clone folder handle.
export const LOCAL_GIT_HANDLE_KEY = "git-json-folder";

// Transport for a config + token (null when this browser has no access).
export async function openGitJsonTransport(git: GitJsonConfig, token?: string | null): Promise<GitTransport | null> {
  if (git.provider === "local") {
    const handle = await loadFolderHandle(LOCAL_GIT_HANDLE_KEY);
    if (!handle || !(await ensureFolderPermission(handle, false))) return null;
    return createLocalFsTransport(handle);
  }
  const tok = token ?? getGitToken(git);
  if (!tok) return null;
  return git.provider === "github"
    ? createRemoteGitTransport({ provider: "github", owner: git.owner ?? "", repo: git.repo ?? "", branch: git.branch, token: tok, apiBaseUrl: git.apiBaseUrl })
    : createRemoteGitTransport({ provider: "gitlab", project: git.project ?? "", branch: git.branch, token: tok, apiBaseUrl: git.apiBaseUrl });
}

// The address this browser's user is known by in the CRM users list
// (their git login has no reliable email). Per browser, not secret.
export function getGitUserEmail(config: RuntimeConfig): string | null {
  return getSecret(`gitEmail:${datasetId(config)}`);
}

export function setGitUserEmail(config: RuntimeConfig, email: string | null): void {
  setSecret(`gitEmail:${datasetId(config)}`, email?.trim().toLowerCase() || null);
}

export { getGitToken, setGitToken };

export function createGitJsonStore(config: RuntimeConfig, opts: BackendOptions = {}): GitJsonDataStore {
  const cfg = (config as GitJsonRuntimeConfig).git;
  // CLI: the token comes from its credentials file (opts.secrets.token).
  const explicitToken = typeof opts.secrets?.token === "string" ? opts.secrets.token : null;
  const explicitEmail = typeof opts.secrets?.email === "string" ? opts.secrets.email : null;
  const bagKey = `gitSecrets:${datasetId(config)}`;
  return createGitJsonStoreWith({
    dir: cfg.dir,
    openTransport: () => openGitJsonTransport(cfg, explicitToken),
    identityFor: (p, t) => defaultGitIdentity(p, t, explicitEmail ?? getGitUserEmail(config)),
    secrets: {
      read: () => getSecretJson<SecretBag>(bagKey) ?? {},
      write: (bag) => setSecretJson(bagKey, bag),
    },
    pollIntervalMs: opts.pollIntervalMs ?? (cfg.provider === "local" ? GIT_JSON_LOCAL_POLL_MS : GIT_JSON_POLL_MS),
  });
}
