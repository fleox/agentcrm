// Conflict-free merge of journal operations: per-field last-writer-wins on
// hybrid logical clock stamps (core/hlc.ts). Operations commute and are
// idempotent, so clients can apply segments in any order, any number of
// times, and converge to the same state.
//
// Per document the state keeps:
//   reset  stamp of the latest `set` (a full replace): every value older
//          than it is void;
//   del    stamp of the latest `delete`;
//   e      entries path → { v, t } (path = top-level key or dot path,
//          `u: 1` = "removed at t").
// A document is visible iff it was set and its latest set is newer than
// its latest delete — a patch never resurrects a deleted document (a
// restore is a `set`).
//
// An entry at path P with stamp t loses to any entry at an ancestor-or-
// self path with a newer stamp, and overrides older entries at
// descendant paths. Materialisation applies entries in stamp order.

import { normalizeDoc, setPath, splitPath } from "../patch";
import type { CollectionName, DocMutation, StoredDoc } from "../types";
import { COLLECTIONS } from "../types";

export type JournalOp =
  | { t: string; op: "set"; c: CollectionName; doc: StoredDoc }
  // f: [path, value] to set, [path] to remove.
  | { t: string; op: "patch"; c: CollectionName; id: string; f: Array<[string, unknown] | [string]> }
  | { t: string; op: "delete"; c: CollectionName; id: string };

export interface Entry {
  t: string;
  v?: unknown;
  u?: 1;
}

export interface DocState {
  reset?: string;
  del?: string;
  e: Record<string, Entry>;
}

export type MergeState = Record<CollectionName, Map<string, DocState>>;

export function emptyMergeState(): MergeState {
  return Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()])) as MergeState;
}

export function toJournalOp(m: DocMutation, t: string): JournalOp {
  if (m.op === "set") return { t, op: "set", c: m.collection, doc: m.doc };
  if (m.op === "delete") return { t, op: "delete", c: m.collection, id: m.id };
  return {
    t,
    op: "patch",
    c: m.collection,
    id: m.id,
    f: Object.entries(m.fields)
      .filter(([k]) => splitPath(k)[0] !== "id")
      .map(([k, v]) => (v === undefined ? [k] : [k, v])) as Array<[string, unknown] | [string]>,
  };
}

function docState(state: MergeState, c: CollectionName, id: string): DocState {
  let ds = state[c].get(id);
  if (!ds) {
    ds = { e: {} };
    state[c].set(id, ds);
  }
  return ds;
}

function isDescendant(path: string, ancestor: string): boolean {
  return path.length > ancestor.length && path.startsWith(ancestor) && path[ancestor.length] === ".";
}

export function applyEntry(ds: DocState, path: string, entry: Entry): boolean {
  if (ds.reset && entry.t < ds.reset) return false;
  const parts = splitPath(path);
  for (let i = 1; i <= parts.length; i++) {
    const existing = ds.e[parts.slice(0, i).join(".")];
    // Self: equal stamp = same op replayed (idempotent). Ancestors: an
    // equal stamp is the same op writing "a" then "a.b" — keep both.
    if (existing && (i === parts.length ? existing.t >= entry.t : existing.t > entry.t)) return false;
  }
  for (const key of Object.keys(ds.e)) {
    if (isDescendant(key, path) && ds.e[key].t < entry.t) delete ds.e[key];
  }
  ds.e[path] = entry;
  return true;
}

function applySet(ds: DocState, t: string, doc: StoredDoc): boolean {
  if (ds.reset && ds.reset >= t) return false;
  ds.reset = t;
  for (const [key, entry] of Object.entries(ds.e)) if (entry.t < t) delete ds.e[key];
  for (const [key, value] of Object.entries(doc)) {
    if (key === "id" || value === undefined) continue;
    applyEntry(ds, key, { t, v: value });
  }
  return true;
}

// Applies one op. Returns true when the state changed.
export function applyOp(state: MergeState, op: JournalOp): boolean {
  if (!state[op.c]) return false;
  const id = op.op === "set" ? op.doc.id : op.id;
  if (typeof id !== "string" || !id) return false;
  const ds = docState(state, op.c, id);
  if (op.op === "set") return applySet(ds, op.t, op.doc);
  if (op.op === "delete") {
    if (ds.del && ds.del >= op.t) return false;
    ds.del = op.t;
    return true;
  }
  let changed = false;
  for (const item of op.f) {
    const entry: Entry = item.length === 1 ? { t: op.t, u: 1 } : { t: op.t, v: item[1] };
    if (applyEntry(ds, item[0], entry)) changed = true;
  }
  return changed;
}

// Merges another state (e.g. a snapshot written by another client).
export function mergeStates(into: MergeState, other: MergeState): Set<string> {
  const touched = new Set<string>();
  for (const c of COLLECTIONS) {
    for (const [id, src] of other[c] ?? []) {
      const ds = docState(into, c, id);
      let changed = false;
      if (src.reset && (!ds.reset || src.reset > ds.reset)) {
        ds.reset = src.reset;
        for (const [key, entry] of Object.entries(ds.e)) if (entry.t < src.reset) delete ds.e[key];
        changed = true;
      }
      if (src.del && (!ds.del || src.del > ds.del)) {
        ds.del = src.del;
        changed = true;
      }
      // Apply in stamp order so ancestor / descendant pruning matches a
      // sequential replay.
      for (const [path, entry] of Object.entries(src.e).sort((a, b) => (a[1].t < b[1].t ? -1 : 1))) {
        if (applyEntry(ds, path, entry)) changed = true;
      }
      if (changed) touched.add(`${c}/${id}`);
    }
  }
  return touched;
}

export function isVisible(ds: DocState): boolean {
  return !!ds.reset && (!ds.del || ds.reset > ds.del);
}

export function materializeDoc(id: string, ds: DocState): StoredDoc | null {
  if (!isVisible(ds)) return null;
  let out: Record<string, unknown> = {};
  const entries = Object.entries(ds.e).sort((a, b) => (a[1].t < b[1].t ? -1 : a[1].t > b[1].t ? 1 : a[0].length - b[0].length));
  for (const [path, entry] of entries) out = setPath(out, splitPath(path), entry.u ? undefined : entry.v);
  out.id = id;
  return normalizeDoc(out as StoredDoc);
}

export function maxStamp(state: MergeState): string {
  let max = "";
  for (const c of COLLECTIONS) {
    for (const ds of state[c].values()) {
      if (ds.reset && ds.reset > max) max = ds.reset;
      if (ds.del && ds.del > max) max = ds.del;
      for (const e of Object.values(ds.e)) if (e.t > max) max = e.t;
    }
  }
  return max;
}

// Compaction: drops every value of invisible documents (deleted, or
// patched without ever being set), keeping only a tombstone (`del`) so a
// lagging segment can't resurrect them. Returns the number of purged docs.
export function purgeState(state: MergeState): number {
  let purged = 0;
  for (const c of COLLECTIONS) {
    for (const [id, ds] of state[c]) {
      if (isVisible(ds)) continue;
      if (Object.keys(ds.e).length || ds.reset) purged++;
      if (ds.del) state[c].set(id, { del: ds.del, e: {} });
      else state[c].delete(id);
    }
  }
  return purged;
}

// JSON form (snapshot.bin).
export type SerializedState = Partial<Record<CollectionName, Record<string, DocState>>>;

export function serializeState(state: MergeState): SerializedState {
  const out: SerializedState = {};
  for (const c of COLLECTIONS) {
    if (state[c].size === 0) continue;
    out[c] = Object.fromEntries(state[c]);
  }
  return out;
}

export function deserializeState(raw: SerializedState | undefined): MergeState {
  const state = emptyMergeState();
  for (const c of COLLECTIONS) {
    for (const [id, ds] of Object.entries(raw?.[c] ?? {})) {
      state[c].set(id, { ...(ds.reset ? { reset: ds.reset } : {}), ...(ds.del ? { del: ds.del } : {}), e: { ...(ds.e ?? {}) } });
    }
  }
  return state;
}

export function cloneMergeState(state: MergeState): MergeState {
  return deserializeState(JSON.parse(JSON.stringify(serializeState(state))) as SerializedState);
}
