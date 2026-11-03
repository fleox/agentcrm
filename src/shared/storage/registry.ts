import i18n from "../../i18n";
import { toast } from "../lib/toast";
import { browserMirrorFactory } from "./connectors/browserMirror";
import { gitPagesFactory } from "./connectors/gitPages";
import { localFolderFactory } from "./connectors/localFolder";
import { s3Factory } from "./connectors/s3";
import { StorageError, type StorageConnector } from "./types";

// Registry of storage connectors + resolution of the active hosting
// target (used by the siteFiles facade).
//
// A connector is registered either as a ready instance or as a factory
// that builds an instance from its `settings` (repo + token, bucket +
// keys, …). Where the active target's settings come from is configured
// by the app with setStorageConfigSource() (AgentCRM keeps it in the
// data store, `config/hosting`); without a source the in-browser mirror
// is used.

export interface StorageConfig {
  connectorId: string;
  // Connector-specific settings (repo, bucket, tokens, …). Opaque here;
  // each connector narrows it.
  settings: Record<string, unknown>;
}

let configSource: () => Promise<StorageConfig | null> = async () => null;

export function setStorageConfigSource(source: () => Promise<StorageConfig | null>): void {
  configSource = source;
  active = null;
}

export function getStorageConfig(): Promise<StorageConfig | null> {
  return configSource();
}

// Used when no target is stored: the in-browser ZIP mirror — never
// silently publish to an unconfigured remote.
export const DEFAULT_CONNECTOR_ID = "browser-mirror";

export interface StorageConnectorFactory<S = Record<string, unknown>> {
  id: string;
  create(settings: S): StorageConnector;
}

type Entry = StorageConnector | StorageConnectorFactory;

let active: { id: string; connector: Promise<StorageConnector> } | null = null;

// Built-ins. Factories are typed on their own settings; the registry
// stores them erased (settings come back from storage untyped).
const connectors = new Map<string, Entry>(
  [
    gitPagesFactory,
    s3Factory,
    browserMirrorFactory,
    localFolderFactory,
  ].map((e) => [e.id, e as unknown as Entry]),
);

function isFactory(entry: Entry): entry is StorageConnectorFactory {
  return typeof (entry as StorageConnectorFactory).create === "function";
}

export function registerStorageConnector(entry: Entry): void {
  connectors.set(entry.id, entry);
  // A re-registration (e.g. an external connector upgraded at runtime)
  // must not keep serving the previous instance.
  if (active && active.id === entry.id) active = null;
}

export function defaultConnectorId(): string {
  return DEFAULT_CONNECTOR_ID;
}

export function listStorageConnectorIds(): string[] {
  return [...connectors.keys()];
}

// Builds a connector instance for arbitrary settings — used by the
// setup wizard / Settings "Test connection" before anything is saved.
export function instantiateStorageConnector(id: string, settings: Record<string, unknown>): StorageConnector {
  const entry = connectors.get(id);
  if (!entry) {
    throw new StorageError(i18n.t("storage.errors.unknownConnector", { connector: id }), 501);
  }
  return isFactory(entry) ? entry.create(settings) : entry;
}

// The active connector is read once per session from the config source
// and cached — the choice only changes from Settings, which calls
// invalidateActiveStorageConnector() after writing.

async function resolveActive(): Promise<StorageConnector> {
  let config: Awaited<ReturnType<typeof getStorageConfig>> = null;
  try {
    config = await getStorageConfig();
  } catch (err) {
    console.warn("[storage] could not read storage config, using the default target:", err);
  }
  const id = config?.connectorId ?? defaultConnectorId();
  try {
    return instantiateStorageConnector(id, config?.settings ?? {});
  } catch (err) {
    toast.error((err as Error).message);
    throw err;
  }
}

export async function getActiveStorageConnector(): Promise<StorageConnector> {
  if (!active) {
    const connector = resolveActive();
    active = { id: "", connector };
    connector.then(
      (c) => {
        if (active?.connector === connector) active.id = c.id;
      },
      () => {
        // Don't cache failures — the next call retries.
        if (active?.connector === connector) active = null;
      },
    );
  }
  return active.connector;
}

export function invalidateActiveStorageConnector(): void {
  active = null;
}
