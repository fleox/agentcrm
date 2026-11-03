// git-json backend — STUB.
//
// Owned by the backend agent: one JSON file per document in a PRIVATE
// repo (records/<object>/<id>.json, objects/<id>.json, settings/<id>.json…)
// through src/shared/git (GitHub / GitLab REST, local clone), one commit
// per write(), each user signing in with their own token (getGitToken /
// setGitToken in lib/runtimeConfig.ts), repo permission → role. Build it
// on createStoreCore() from ./core, mirroring cms-ia
// src/services/docstore/gitStore.ts. Registered lazily by ./index.ts.

import type { GitJsonRuntimeConfig, RuntimeConfig } from "../lib/runtimeConfig";
import type { BackendOptions } from "./registry";
import type { DataStore } from "./types";

export function createGitJsonStore(config: RuntimeConfig, _opts: BackendOptions = {}): DataStore {
  const cfg = config as GitJsonRuntimeConfig;
  throw new Error(`The git-json backend is not implemented yet (${cfg.git?.provider ?? "?"} repository).`);
}
