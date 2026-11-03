// Per-field patch semantics shared by every backend (see DocMutation).

import type { StoredDoc } from "./types";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

export function splitPath(path: string): string[] {
  return path.split(".").filter(Boolean);
}

// Sets (or deletes, for undefined) `path` in a deep copy of `target`.
// Intermediate non-objects are replaced by objects.
export function setPath(target: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  if (path.length === 0) return target;
  const [head, ...rest] = path;
  const out: Record<string, unknown> = { ...target };
  if (rest.length === 0) {
    if (value === undefined) delete out[head];
    else out[head] = value;
    return out;
  }
  const child = isPlainObject(out[head]) ? (out[head] as Record<string, unknown>) : {};
  out[head] = setPath(child, rest, value);
  return out;
}

export function getPath(target: unknown, path: string[]): unknown {
  let cur: unknown = target;
  for (const p of path) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function applyPatch(doc: StoredDoc, fields: Record<string, unknown>): StoredDoc {
  let out: Record<string, unknown> = { ...doc };
  for (const [key, value] of Object.entries(fields)) {
    const path = splitPath(key);
    // The id is immutable.
    if (path[0] === "id") continue;
    out = setPath(out, path, value);
  }
  return out as StoredDoc;
}

// Drops undefined keys (recursively in plain objects) and freezes, so a
// caller can never mutate the snapshot through a returned reference.
export function normalizeDoc<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map(normalizeDoc)) as unknown as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = normalizeDoc(v);
    return Object.freeze(out) as T;
  }
  return value;
}

// Deep JSON-compatible clone that unfreezes (for backends that need a
// mutable copy, e.g. structured clone into IndexedDB).
export function plainCopy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
