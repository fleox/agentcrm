// Firebase backend (Firestore + Firebase Auth) — STUB.
//
// Owned by the backend agent: implement createFirebaseStore() with
// createStoreCore() from ./core (load = read every collection; persist =
// batched writes, `patch` → updateDoc with dot paths; watch = onSnapshot),
// Firebase Auth sign-in (email/password + Google), roles from users/{uid}.
// Registered lazily by ./index.ts (the SDK only loads for Firebase users).

import type { FirebaseRuntimeConfig, RuntimeConfig } from "../lib/runtimeConfig";
import type { BackendOptions } from "./registry";
import type { DataStore } from "./types";

export function createFirebaseStore(config: RuntimeConfig, _opts: BackendOptions = {}): DataStore {
  const cfg = config as FirebaseRuntimeConfig;
  throw new Error(`The Firebase backend is not implemented yet (project ${cfg.firebase?.projectId ?? "?"}).`);
}
