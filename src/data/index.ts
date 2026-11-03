// Data store resolution: getDataStore() builds (once) the store described
// by the runtime config (lib/runtimeConfig.ts). The admin calls it at
// boot; the CLI calls createDataStore(config, { passphrase, secrets })
// with values from its credentials file.

import {
  getConnectorSecrets,
  getPassphrase,
  getRuntimeConfig,
  type JournalRuntimeConfig,
  type RuntimeConfig,
} from "../lib/runtimeConfig";
import { instantiateStorageConnector } from "../shared/storage/registry";
import { createJournalStore } from "./journal";
import { createLocalStore } from "./local";
import { createMemoryStore } from "./memory";
import { getBackendFactory, registerBackend, type BackendOptions } from "./registry";
import type { DataStore } from "./types";

export * from "./types";
export { createStoreCore, emptySnapshot, snapshotFromDocs, snapshotToDocs, type Snapshot, type StoreBackend } from "./core";
export { registerBackend, listBackends, type BackendFactory, type BackendOptions } from "./registry";
export { createMemoryStore } from "./memory";

registerBackend("local", () => createLocalStore());
registerBackend("memory", () => createMemoryStore());
registerBackend("journal", (config, opts) => {
  const cfg = (config as JournalRuntimeConfig).journal;
  const connector = instantiateStorageConnector(cfg.connectorId, { ...cfg.settings, ...(opts.secrets ?? {}) });
  return createJournalStore({
    connector,
    root: cfg.root,
    encrypted: cfg.encrypted,
    passphrase: opts.passphrase,
    clientId: opts.clientId,
    pollIntervalMs: opts.pollIntervalMs,
  });
});
// Lazy: Firebase / git-json code only loads when used.
registerBackend("firebase", async (config, opts) => (await import("./firebase")).createFirebaseStore(config, opts));
registerBackend("git-json", async (config, opts) => (await import("./gitJson")).createGitJsonStore(config, opts));

export async function createDataStore(config: RuntimeConfig, opts: BackendOptions = {}): Promise<DataStore> {
  const factory = getBackendFactory(config.backend);
  if (!factory) throw new Error(`Unknown data backend "${config.backend}".`);
  return factory(config, opts);
}

// Browser defaults: secrets + passphrase from this browser's localStorage.
export function browserBackendOptions(config: RuntimeConfig): BackendOptions {
  return {
    secrets: getConnectorSecrets(config),
    passphrase: () => getPassphrase(config),
  };
}

let current: { config: RuntimeConfig; store: Promise<DataStore> } | null = null;

// The store of the active runtime config (singleton). Rejects when no
// config is set (the setup wizard is showing).
export function getDataStore(): Promise<DataStore> {
  const config = getRuntimeConfig();
  if (!config) return Promise.reject(new Error("AgentCRM is not configured yet."));
  if (!current || current.config !== config) {
    current?.store.then((s) => s.close?.()).catch(() => undefined);
    const store = createDataStore(config, browserBackendOptions(config));
    current = { config, store };
    store.catch(() => {
      if (current?.store === store) current = null;
    });
  }
  return current.store;
}

// Installs an explicit store (CLI, tests, setup wizard after install).
export function setDataStore(store: DataStore, config: RuntimeConfig): void {
  current?.store.then((s) => s !== store && s.close?.()).catch(() => undefined);
  current = { config, store: Promise.resolve(store) };
}

export function resetDataStore(): void {
  current?.store.then((s) => s.close?.()).catch(() => undefined);
  current = null;
}
