// Backend registry: maps a runtime config's `backend` to a factory that
// builds its DataStore. Built-ins (local, journal, memory) are registered
// by ./index.ts; the firebase and git-json backends live in their own
// files (./firebase.ts, ./gitJson.ts), loaded lazily so their SDKs only
// ship to the users who need them.

import type { RuntimeConfig } from "../lib/runtimeConfig";
import type { DataStore } from "./types";

export interface BackendOptions {
  // Passphrase of an encrypted dataset (CLI: from the credentials file;
  // browser: localStorage via getPassphrase(config)). A function is read
  // lazily, so a UI prompt can fill it in and ready() be retried.
  passphrase?: string | null | (() => string | null | undefined);
  // Secret connector / backend settings (token, keys, password).
  secrets?: Record<string, unknown>;
  // Journal client id (stable per CLI process / browser tab).
  clientId?: string;
  pollIntervalMs?: number;
}

export type BackendFactory = (config: RuntimeConfig, opts: BackendOptions) => DataStore | Promise<DataStore>;

const factories = new Map<string, BackendFactory>();

export function registerBackend(kind: RuntimeConfig["backend"] | (string & {}), factory: BackendFactory): void {
  factories.set(kind, factory);
}

export function getBackendFactory(kind: string): BackendFactory | undefined {
  return factories.get(kind);
}

export function listBackends(): string[] {
  return [...factories.keys()];
}
