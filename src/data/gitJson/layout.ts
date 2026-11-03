// File layout of the git-json backend: one pretty-printed JSON file per
// document, under the data folder (`git.dir`) of the repository.
//
//   agentcrm.json                    marker: { format, version } (dataset detection)
//   objects/<id>.json
//   records/<object>/<id>.json       records are grouped by object
//   activities/<id>.json
//   pipelines/<id>.json   views/<id>.json   automations/<id>.json
//   forms/<id>.json   users/<id>.json   settings/<id>.json
//   config/<id>.json                 secrets stripped (kept per browser)
//   automationRuns/<id>.json
//
// Ids are URI-encoded in file names (a git-json user id looks like
// "github:octocat" — colons are not portable file names).

import { SECRET_SETTING_KEYS } from "../../lib/runtimeConfig";
import { emptySnapshot, type Snapshot } from "../core";
import { getPath, normalizeDoc, setPath, splitPath } from "../patch";
import { COLLECTIONS, isCollectionName, type CollectionName, type StoredDoc } from "../types";

export const GIT_JSON_FORMAT = "agentcrm-git-json";
export const GIT_JSON_VERSION = 1;
export const MARKER_FILE = "agentcrm.json";

// "collection/id" → file path (relative to the data folder).
export type LayoutIndex = Map<string, string>;

export function docKey(collection: CollectionName, id: string): string {
  return `${collection}/${id}`;
}

function encodeName(id: string): string {
  return encodeURIComponent(id).replace(/\./g, "%2E");
}

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export function docPath(collection: CollectionName, doc: StoredDoc): string {
  if (collection === "records") {
    const object = typeof doc.object === "string" && doc.object ? doc.object : "_";
    return `records/${encodeName(object)}/${encodeName(doc.id)}.json`;
  }
  return `${collection}/${encodeName(doc.id)}.json`;
}

// Parses a data-folder-relative path. Returns null for files that are
// not documents (README, marker, CI files…).
export function parseDocPath(path: string): { collection: CollectionName; id: string } | null {
  const parts = path.split("/");
  const [head] = parts;
  if (!isCollectionName(head)) return null;
  const file = parts[parts.length - 1];
  if (!file.endsWith(".json")) return null;
  if (head === "records" ? parts.length !== 3 : parts.length !== 2) return null;
  const id = decodeName(file.slice(0, -".json".length));
  return id ? { collection: head, id } : null;
}

export function isLayoutFile(path: string): boolean {
  return path === MARKER_FILE || parseDocPath(path) !== null;
}

export function serializeDoc(doc: StoredDoc): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

// ─── Secrets of config docs ──────────────────────────────────────────────

// docId → { "dot.path": secret value }
export type SecretBag = Record<string, Record<string, unknown>>;

function collectSecrets(value: unknown, path: string[], out: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((v, i) => collectSecrets(v, [...path, String(i)], out));
  if (!value || typeof value !== "object") return value;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_SETTING_KEYS.has(k) && typeof v === "string") {
      if (v) out[[...path, k].join(".")] = v;
      continue;
    }
    clean[k] = collectSecrets(v, [...path, k], out);
  }
  return clean;
}

// Returns the doc without secret keys + the removed secrets.
export function stripDocSecrets(doc: StoredDoc): { doc: StoredDoc; secrets: Record<string, unknown> } {
  const secrets: Record<string, unknown> = {};
  const clean = collectSecrets(doc, [], secrets) as StoredDoc;
  return { doc: clean, secrets };
}

export function mergeDocSecrets(doc: StoredDoc, secrets: Record<string, unknown> | undefined): StoredDoc {
  if (!secrets) return doc;
  let out: Record<string, unknown> = { ...doc };
  for (const [path, value] of Object.entries(secrets)) {
    const p = splitPath(path);
    if (getPath(out, p.slice(0, -1)) === undefined && p.length > 1) continue;
    out = setPath(out, p, value);
  }
  return out as StoredDoc;
}

// ─── Files ⇄ snapshot ────────────────────────────────────────────────────

export function filesToSnapshot(files: Map<string, string>, secrets: SecretBag = {}): { snapshot: Snapshot; index: LayoutIndex; errors: string[] } {
  const snapshot = emptySnapshot();
  const index: LayoutIndex = new Map();
  const errors: string[] = [];
  for (const [path, text] of files) {
    const parsed = parseDocPath(path);
    if (!parsed) continue;
    let doc: StoredDoc;
    try {
      const raw = JSON.parse(text) as unknown;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object");
      doc = { ...(raw as Record<string, unknown>), id: parsed.id };
    } catch (err) {
      errors.push(`${path}: ${(err as Error).message}`);
      continue;
    }
    if (parsed.collection === "config") doc = mergeDocSecrets(doc, secrets[parsed.id]);
    snapshot[parsed.collection].set(parsed.id, normalizeDoc(doc));
    index.set(docKey(parsed.collection, parsed.id), path);
  }
  return { snapshot, index, errors };
}

export interface FileChange {
  type: "put" | "delete";
  path: string;
  content?: string;
}

// Changes turning `base` files into the state where the `keys` docs are
// as in `target`. Updates `files`/`index` copies and the secret bag.
export function planChanges(
  keys: Iterable<[CollectionName, string]>,
  target: Snapshot,
  files: Map<string, string>,
  index: LayoutIndex,
  secrets: SecretBag,
): { changes: FileChange[]; files: Map<string, string>; index: LayoutIndex; secrets: SecretBag } {
  const nextFiles = new Map(files);
  const nextIndex = new Map(index);
  const nextSecrets: SecretBag = { ...secrets };
  const changes = new Map<string, FileChange>();
  const seen = new Set<string>();
  for (const [collection, id] of keys) {
    const key = docKey(collection, id);
    if (seen.has(key)) continue;
    seen.add(key);
    const oldPath = nextIndex.get(key);
    const doc = target[collection].get(id);
    if (!doc) {
      if (oldPath) {
        changes.set(oldPath, { type: "delete", path: oldPath });
        nextFiles.delete(oldPath);
        nextIndex.delete(key);
      }
      if (collection === "config") delete nextSecrets[id];
      continue;
    }
    let stored = doc;
    if (collection === "config") {
      const split = stripDocSecrets(doc);
      stored = split.doc;
      if (Object.keys(split.secrets).length) nextSecrets[id] = split.secrets;
      else delete nextSecrets[id];
    }
    const path = docPath(collection, stored);
    const content = serializeDoc(stored);
    if (oldPath && oldPath !== path) {
      changes.set(oldPath, { type: "delete", path: oldPath });
      nextFiles.delete(oldPath);
    }
    if (nextFiles.get(path) !== content) changes.set(path, { type: "put", path, content });
    nextFiles.set(path, content);
    nextIndex.set(key, path);
  }
  return { changes: [...changes.values()], files: nextFiles, index: nextIndex, secrets: nextSecrets };
}

export function markerContent(): string {
  return JSON.stringify({ format: GIT_JSON_FORMAT, version: GIT_JSON_VERSION }, null, 2) + "\n";
}

export function isCollectionFolder(name: string): boolean {
  return (COLLECTIONS as readonly string[]).includes(name);
}
