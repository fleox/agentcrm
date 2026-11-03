import { createGitHubTransport } from "./github";
import { createGitLabTransport } from "./gitlab";
import type { GitRemoteConfig, GitTransport } from "./types";

export * from "./types";
export { createLocalFsTransport, ensureFolderPermission, isLocalFolderSupported, pickLocalFolder } from "./localFs";
export { loadFolderHandle, saveFolderHandle } from "./handleStore";

export function createRemoteGitTransport(cfg: GitRemoteConfig): GitTransport {
  return cfg.provider === "github" ? createGitHubTransport(cfg) : createGitLabTransport(cfg);
}

// Joins a repo sub-folder ("public", "content/", "") with a relative path.
export function joinRepoPath(dir: string, path: string): string {
  const d = dir.replace(/^\/+|\/+$/g, "");
  const p = path.replace(/^\/+/, "");
  return d ? `${d}/${p}` : p;
}
