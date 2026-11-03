// Shared in-memory engine behind every DataStore (adapted from cms-ia
// src/services/docstore/core.ts, see SHARED.md): snapshot, optimistic
// writes with rollback, serialised persistence, change notification,
// subscriber-driven polling (or push via `watch`). Concrete backends only
// provide I/O.

import { applyPatch, normalizeDoc } from "./patch";
import {
  COLLECTIONS,
  type BackendKind,
  type CollectionName,
  type DataStore,
  type DocMutation,
  type StoreIdentity,
  type StoredDoc,
} from "./types";

export type Snapshot = Record<CollectionName, Map<string, StoredDoc>>;

export interface StoreBackend {
  kind: BackendKind;
  load(): Promise<Snapshot>;
  // Persists `mutations` (patches stay patches — per-field backends need
  // them). `before` is the snapshot they were applied to, `after` the
  // result — backends that write whole documents read from `after`.
  persist(mutations: DocMutation[], before: Snapshot, after: Snapshot, message: string): Promise<void>;
  // Returns a fresh snapshot when the source changed since the last
  // load / persist, null otherwise. Omit for sources nobody else writes.
  poll?(): Promise<Snapshot | null>;
  pollIntervalMs?: number;
  // Push alternative to poll (Firestore onSnapshot): started with the
  // first subscriber, stopped with the last. Call `onRemote` with the
  // full fresh snapshot.
  watch?(onRemote: (fresh: Snapshot) => void): () => void;
  identity(): Promise<StoreIdentity | null>;
  // Physical rewrite (journal). May return the resulting snapshot.
  compact?(current: Snapshot): Promise<Snapshot | void>;
  close?(): void;
}

export function emptySnapshot(): Snapshot {
  return Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()])) as Snapshot;
}

export function cloneSnapshot(s: Snapshot): Snapshot {
  return Object.fromEntries(COLLECTIONS.map((c) => [c, new Map(s[c] ?? [])])) as Snapshot;
}

export function snapshotFromDocs(docs: Partial<Record<CollectionName, StoredDoc[]>>): Snapshot {
  const s = emptySnapshot();
  for (const c of COLLECTIONS) for (const d of docs[c] ?? []) s[c].set(d.id, normalizeDoc(d));
  return s;
}

export function snapshotToDocs(s: Snapshot): Record<CollectionName, StoredDoc[]> {
  return Object.fromEntries(COLLECTIONS.map((c) => [c, [...s[c].values()]])) as Record<CollectionName, StoredDoc[]>;
}

export function applyMutations(base: Snapshot, mutations: DocMutation[]): { next: Snapshot; changed: Set<CollectionName> } {
  const next = cloneSnapshot(base);
  const changed = new Set<CollectionName>();
  for (const m of mutations) {
    if (m.op === "set") {
      next[m.collection].set(m.doc.id, normalizeDoc(m.doc));
      changed.add(m.collection);
    } else if (m.op === "patch") {
      const current = next[m.collection].get(m.id);
      // Patching a missing document is a no-op (see DocMutation).
      if (!current) continue;
      next[m.collection].set(m.id, normalizeDoc(applyPatch(current, m.fields)));
      changed.add(m.collection);
    } else {
      if (next[m.collection].delete(m.id)) changed.add(m.collection);
    }
  }
  return { next, changed };
}

export function diffCollections(a: Snapshot, b: Snapshot): Set<CollectionName> {
  const changed = new Set<CollectionName>();
  for (const c of COLLECTIONS) {
    if (a[c].size !== b[c].size) {
      changed.add(c);
      continue;
    }
    for (const [id, doc] of a[c]) {
      const other = b[c].get(id);
      if (other === doc) continue;
      if (!other || JSON.stringify(other) !== JSON.stringify(doc)) {
        changed.add(c);
        break;
      }
    }
  }
  return changed;
}

function mutationId(m: DocMutation): string {
  return m.op === "set" ? m.doc.id : m.id;
}

function validate(mutations: DocMutation[]): void {
  for (const m of mutations) {
    if (!COLLECTIONS.includes(m.collection)) throw new Error(`Unknown collection "${m.collection}".`);
    const id = mutationId(m);
    if (typeof id !== "string" || !id) throw new Error(`Mutation on ${m.collection} without an id.`);
  }
}

export function createStoreCore(backend: StoreBackend): DataStore {
  let snapshot: Snapshot = emptySnapshot();
  let loading: Promise<void> | null = null;
  let loaded = false;
  let queue: Promise<unknown> = Promise.resolve();
  let pending = 0;
  const listeners = new Set<(changed: Set<CollectionName>) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let unwatch: (() => void) | null = null;
  let closed = false;

  function notify(changed: Set<CollectionName>) {
    if (changed.size === 0) return;
    for (const l of [...listeners]) {
      try {
        l(changed);
      } catch (err) {
        console.error("[datastore] listener failed:", err);
      }
    }
  }

  function adopt(fresh: Snapshot) {
    // Never swap the snapshot under an in-flight write — its rollback
    // base would be wrong. The next tick catches up.
    if (pending > 0) return;
    const changed = diffCollections(snapshot, fresh);
    snapshot = fresh;
    notify(changed);
  }

  function ready(): Promise<void> {
    if (!loading) {
      loading = backend.load().then(
        (s) => {
          snapshot = s;
          loaded = true;
          notify(new Set(COLLECTIONS));
        },
        (err) => {
          loading = null;
          throw err;
        },
      );
    }
    return loading;
  }

  async function refresh(): Promise<void> {
    await ready();
    if (!backend.poll || pending > 0) return;
    const fresh = await backend.poll();
    if (fresh) adopt(fresh);
  }

  function start() {
    if (closed) return;
    if (backend.watch && !unwatch) {
      unwatch = backend.watch((fresh) => {
        void ready().then(() => adopt(fresh));
      });
    }
    if (backend.poll && !timer) {
      timer = setInterval(() => {
        refresh().catch((err) => console.warn("[datastore] poll failed:", err));
      }, backend.pollIntervalMs ?? 30_000);
      // Never keep a Node process (the CLI) alive just for polling.
      (timer as { unref?: () => void }).unref?.();
    }
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    unwatch?.();
    unwatch = null;
  }

  const store: DataStore = {
    kind: backend.kind,
    ready,
    refresh,
    identity: () => backend.identity(),

    list(collection) {
      return [...(snapshot[collection]?.values() ?? [])];
    },

    get(collection, id) {
      return snapshot[collection]?.get(id);
    },

    async write(mutations, opts) {
      // Once loaded, the optimistic apply below is synchronous (visible
      // to readers before write() even yields).
      if (!loaded) await ready();
      if (mutations.length === 0) return;
      validate(mutations);
      // Optimistic: visible to readers right away.
      const before = snapshot;
      const { next, changed } = applyMutations(before, mutations);
      snapshot = next;
      notify(changed);
      pending++;
      const run = queue.then(() => backend.persist(mutations, before, next, opts?.message ?? "Update data"));
      queue = run.catch(() => undefined);
      try {
        await run;
      } catch (err) {
        // Roll back only these mutations — later optimistic writes
        // queued behind this one stay applied.
        const reverted = cloneSnapshot(snapshot);
        for (const m of mutations) {
          const id = mutationId(m);
          const original = before[m.collection].get(id);
          if (original) reverted[m.collection].set(id, original);
          else reverted[m.collection].delete(id);
        }
        snapshot = reverted;
        notify(changed);
        throw err;
      } finally {
        pending--;
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },

    close() {
      closed = true;
      stop();
      listeners.clear();
      backend.close?.();
    },
  };

  if (backend.compact) {
    store.compact = async () => {
      await ready();
      // Wait for queued writes so the rewrite includes them.
      await queue;
      const result = await backend.compact!(snapshot);
      if (result) adopt(result);
    };
  }

  return store;
}
