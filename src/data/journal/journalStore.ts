// Journal backend (default): an encrypted snapshot + append-only journal
// on any storage connector (S3 / R2 / OVH bucket, git repo, local folder,
// browser mirror). See CLAUDE.md "Journal backend".
//
//   <root>/keyinfo.json                 public: format, encryption flag, PBKDF2 salt
//                                       + iterations, an encrypted check value
//   <root>/snapshot.bin                 merged state + names of the segments it includes
//   <root>/journal/<hlc>.bin            one write() batch, never rewritten
//                                       (<hlc> = <wall>-<counter>-<clientId>)
//
// Writes append a segment — no lock, no conflict, ever. Reads = snapshot
// + every listed segment it doesn't include, merged with per-field
// last-writer-wins on hybrid logical clock stamps (./merge.ts). Polling
// lists `journal/` (connector.listPrefix) every 20 s. compact() writes a
// new snapshot, then deletes the merged segments: the physical purge of
// deleted documents (GDPR erasure). Files are JSON → gzip → AES-256-GCM.
//
// Read-ordering rule that keeps a concurrent compaction safe: LIST the
// journal first, THEN read the snapshot; a listed segment that has
// vanished when fetched was compacted → re-read the snapshot.

import { createHlcClock, maxHlc, type HlcClock } from "../../core/hlc";
import { decryptText, encryptText, newEncryptionParams, PassphraseError, PBKDF2_ITERATIONS, type EncryptionParams } from "../../shared/crypto";
import { base64ToBytes, bytesToBase64 } from "../../shared/git/encoding";
import { mapLimit } from "../../shared/git/http";
import type { StorageConnector } from "../../shared/storage/types";
import { createStoreCore, emptySnapshot, type Snapshot } from "../core";
import type { DataStore, StoreIdentity } from "../types";
import { COLLECTIONS } from "../types";
import { decodeJson, encodeJson, type CodecKey } from "./codec";
import {
  applyOp,
  cloneMergeState,
  deserializeState,
  emptyMergeState,
  materializeDoc,
  maxStamp,
  mergeStates,
  purgeState,
  serializeState,
  toJournalOp,
  type JournalOp,
  type MergeState,
  type SerializedState,
} from "./merge";

export const JOURNAL_FORMAT = "agentcrm-journal";
export const JOURNAL_VERSION = 1;
export const DEFAULT_POLL_MS = 20_000;
const KEY_CHECK = "agentcrm-keycheck";

export interface KeyInfo {
  format: typeof JOURNAL_FORMAT;
  version: number;
  encrypted: boolean;
  kdf?: { name: "PBKDF2-SHA256"; iterations: number; salt: string };
  // base64 of encrypt(KEY_CHECK): detects a wrong passphrase up front.
  check?: string;
  createdAt: number;
}

interface SnapshotFile {
  format: "agentcrm-snapshot";
  version: number;
  hlc: string;
  // Segment names (file names without folder) merged into `state`.
  applied: string[];
  compactionId: string;
  createdAt: number;
  createdBy: string;
  state: SerializedState;
}

interface SegmentFile {
  format: "agentcrm-segment";
  version: number;
  client: string;
  message?: string;
  ops: JournalOp[];
}

export interface JournalStoreOptions {
  connector: StorageConnector;
  // Folder of the dataset on the connector ("" = connector root).
  root: string;
  // Encrypt files (default true). An existing dataset keeps its mode
  // (keyinfo.json wins).
  encrypted?: boolean;
  // Required when encrypted. A function lets the UI supply it lazily.
  passphrase?: string | null | (() => string | null | undefined);
  // Stable per process / tab by default (random).
  clientId?: string;
  pollIntervalMs?: number;
  // PBKDF2 iterations for a NEW dataset (tests use a low count).
  iterations?: number;
  wallClock?: () => number;
  identity?: StoreIdentity | null;
}

export interface JournalStats {
  segments: number;
  pendingSegments: number;
  snapshotSegments: number;
  documents: number;
  tombstones: number;
}

export interface JournalDataStore extends DataStore {
  readonly kind: "journal";
  compact(): Promise<void>;
  stats(): Promise<JournalStats>;
  readonly clientId: string;
}

export function newClientId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => (b % 36).toString(36)).join("") + Date.now().toString(36).slice(-2);
}

function join(root: string, path: string): string {
  const r = root.replace(/^\/+|\/+$/g, "");
  return r ? `${r}/${path}` : path;
}

export function createJournalStore(opts: JournalStoreOptions): JournalDataStore {
  const connector = opts.connector;
  if (!connector.listPrefix) throw new Error(`The "${connector.id}" storage can't list files: it can't hold a journal dataset.`);
  if (!connector.getBytes) throw new Error(`The "${connector.id}" storage can't read binary files: it can't hold a journal dataset.`);
  const listPrefix = connector.listPrefix.bind(connector);
  const getBytes = connector.getBytes.bind(connector);

  const clientId = (opts.clientId ?? newClientId()).toLowerCase().replace(/[^0-9a-z]/g, "") || newClientId();
  const clock: HlcClock = createHlcClock(clientId, opts.wallClock);
  const paths = {
    keyinfo: join(opts.root, "keyinfo.json"),
    snapshot: join(opts.root, "snapshot.bin"),
    journal: join(opts.root, "journal/"),
  };
  const segmentPath = (name: string) => `${paths.journal}${name}`;

  let keyInfo: KeyInfo | null = null;
  let key: CodecKey | null = null;
  let state: MergeState = emptyMergeState();
  // Every segment name merged into `state` (from snapshots or read).
  const applied = new Set<string>();
  // Segments the last read snapshot includes (stats only).
  let snapshotApplied = new Set<string>();
  let materialized: Snapshot = emptySnapshot();

  function passphrase(): string | null {
    const p = typeof opts.passphrase === "function" ? opts.passphrase() : opts.passphrase;
    return p ?? null;
  }

  async function readText(path: string): Promise<string | null> {
    const bytes = await getBytes(path);
    return bytes ? new TextDecoder().decode(bytes) : null;
  }

  // ─── Key handling ─────────────────────────────────────────────────────

  async function loadKey(): Promise<void> {
    const raw = await readText(paths.keyinfo);
    if (raw) {
      const info = JSON.parse(raw) as KeyInfo;
      if (info.format !== JOURNAL_FORMAT) throw new Error(`${paths.keyinfo} is not an AgentCRM journal key file.`);
      keyInfo = info;
    }
    const encrypted = keyInfo ? keyInfo.encrypted : opts.encrypted !== false;
    if (!encrypted) {
      key = null;
      return;
    }
    const pass = passphrase();
    if (!pass) throw new PassphraseError("missing");
    if (keyInfo?.kdf) {
      const params: EncryptionParams = { salt: base64ToBytes(keyInfo.kdf.salt), iterations: keyInfo.kdf.iterations };
      if (keyInfo.check) {
        const check = await decryptText(base64ToBytes(keyInfo.check), pass); // throws PassphraseError("wrong")
        if (check !== KEY_CHECK) throw new PassphraseError("wrong");
      }
      key = { passphrase: pass, params };
    } else {
      key = { passphrase: pass, params: newEncryptionParams(opts.iterations ?? PBKDF2_ITERATIONS) };
    }
  }

  // Written before the first segment of a new dataset.
  async function ensureKeyInfo(): Promise<void> {
    if (keyInfo) return;
    const info: KeyInfo = { format: JOURNAL_FORMAT, version: JOURNAL_VERSION, encrypted: !!key, createdAt: Date.now() };
    if (key) {
      info.kdf = { name: "PBKDF2-SHA256", iterations: key.params.iterations, salt: bytesToBase64(key.params.salt) };
      info.check = bytesToBase64(await encryptText(KEY_CHECK, key.passphrase, key.params));
    }
    await connector.put({ path: paths.keyinfo, content: JSON.stringify(info, null, 2) + "\n" });
    keyInfo = info;
  }

  // ─── Reading ──────────────────────────────────────────────────────────

  async function readSnapshot(): Promise<SnapshotFile | null> {
    const bytes = await getBytes(paths.snapshot);
    if (!bytes) return null;
    const file = await decodeJson<SnapshotFile>(bytes, passphrase());
    if (file.format !== "agentcrm-snapshot") throw new Error(`${paths.snapshot} is not an AgentCRM snapshot.`);
    return file;
  }

  // Merges a snapshot into the state; returns touched "collection/id" keys.
  function adoptSnapshot(file: SnapshotFile | null): Set<string> {
    if (!file) return new Set();
    if (file.hlc) clock.receive(file.hlc);
    snapshotApplied = new Set(file.applied);
    for (const name of file.applied) applied.add(name);
    return mergeStates(state, deserializeState(file.state));
  }

  function applySegment(name: string, seg: SegmentFile, touched: Set<string>): void {
    for (const op of seg.ops ?? []) {
      if (!COLLECTIONS.includes(op.c)) continue;
      clock.receive(op.t);
      if (applyOp(state, op)) touched.add(`${op.c}/${op.op === "set" ? op.doc.id : op.id}`);
    }
    applied.add(name);
  }

  // Lists the journal, reads what's new. `withSnapshot`: (re)read the
  // snapshot after listing (initial load).
  async function sync(withSnapshot: boolean): Promise<Set<string>> {
    const touched = new Set<string>();
    const listed = (await listPrefix(paths.journal)).filter((p) => p.endsWith(".bin")).map((p) => p.slice(paths.journal.length));
    if (withSnapshot) for (const k of adoptSnapshot(await readSnapshot())) touched.add(k);
    let todo = listed.filter((n) => !applied.has(n)).sort();
    for (let attempt = 0; todo.length && attempt < 3; attempt++) {
      const missing: string[] = [];
      const read = await mapLimit(todo, 6, async (name) => {
        const bytes = await getBytes(segmentPath(name));
        if (!bytes) {
          missing.push(name);
          return null;
        }
        return { name, seg: await decodeJson<SegmentFile>(bytes, passphrase()) };
      });
      for (const r of read) if (r) applySegment(r.name, r.seg, touched);
      if (!missing.length) break;
      // Compacted between our listing and our read: the new snapshot has them.
      for (const k of adoptSnapshot(await readSnapshot())) touched.add(k);
      todo = missing.filter((n) => !applied.has(n));
    }
    return touched;
  }

  function rematerialize(touched: Set<string> | null): Snapshot {
    const next = emptySnapshot();
    for (const c of COLLECTIONS) {
      if (touched === null) {
        for (const [id, ds] of state[c]) {
          const doc = materializeDoc(id, ds);
          if (doc) next[c].set(id, doc);
        }
      } else {
        for (const [id, doc] of materialized[c]) next[c].set(id, doc);
      }
    }
    if (touched) {
      for (const key of touched) {
        const slash = key.indexOf("/");
        const c = key.slice(0, slash) as (typeof COLLECTIONS)[number];
        const id = key.slice(slash + 1);
        const ds = state[c].get(id);
        const doc = ds ? materializeDoc(id, ds) : null;
        if (doc) next[c].set(id, doc);
        else next[c].delete(id);
      }
    }
    materialized = next;
    return next;
  }

  // ─── Store ────────────────────────────────────────────────────────────

  const core = createStoreCore({
    kind: "journal",
    pollIntervalMs: opts.pollIntervalMs ?? DEFAULT_POLL_MS,

    async load() {
      await loadKey();
      state = emptyMergeState();
      applied.clear();
      await sync(true);
      return rematerialize(null);
    },

    async persist(mutations, before, _after, message) {
      // A patch on a document that doesn't exist is a no-op (DataStore
      // contract) — don't journal it.
      const effective = mutations.filter((m) => m.op !== "patch" || before[m.collection].has(m.id));
      if (effective.length === 0) return;
      const ops = effective.map((m) => toJournalOp(m, clock.now()));
      const name = `${ops[0].t}.bin`;
      const seg: SegmentFile = { format: "agentcrm-segment", version: JOURNAL_VERSION, client: clientId, message, ops };
      await ensureKeyInfo();
      const bytes = await encodeJson(seg, key);
      await connector.put({ path: segmentPath(name), content: bytesToBase64(bytes), encoding: "base64" });
      const touched = new Set<string>();
      applySegment(name, seg, touched);
      rematerialize(touched);
    },

    async poll() {
      const touched = await sync(false);
      return touched.size ? rematerialize(touched) : null;
    },

    async identity() {
      return opts.identity === undefined ? { uid: "owner", email: "", displayName: "Owner", role: "admin" } : opts.identity;
    },

    async compact() {
      // 1. Catch up with everything published so far.
      const touched = await sync(true);
      // 2. New state without the data of deleted documents.
      const next = cloneMergeState(state);
      purgeState(next);
      const merged = (await listPrefix(paths.journal))
        .filter((p) => p.endsWith(".bin"))
        .map((p) => p.slice(paths.journal.length))
        .filter((n) => applied.has(n));
      const compactionId = `${clientId}-${clock.now()}`;
      const file: SnapshotFile = {
        format: "agentcrm-snapshot",
        version: JOURNAL_VERSION,
        hlc: maxHlc(clock.last(), maxStamp(next)) ?? "",
        applied: merged.sort(),
        compactionId,
        createdAt: Date.now(),
        createdBy: clientId,
        state: serializeState(next),
      };
      await ensureKeyInfo();
      await connector.put({ path: paths.snapshot, content: bytesToBase64(await encodeJson(file, key)), encoding: "base64" });
      // 3. Only the client whose snapshot is in place deletes segments
      //    (two concurrent compactions: the loser keeps its hands off).
      const check = await readSnapshot();
      if (check?.compactionId === compactionId) {
        await mapLimit(merged, 4, (name) => connector.delete(segmentPath(name)));
      }
      state = next;
      snapshotApplied = new Set(merged);
      void touched;
      return rematerialize(null);
    },
  });

  const store = core as JournalDataStore;
  Object.defineProperty(store, "clientId", { value: clientId });
  store.stats = async () => {
    const listed = (await listPrefix(paths.journal)).filter((p) => p.endsWith(".bin"));
    let documents = 0;
    let tombstones = 0;
    for (const c of COLLECTIONS) {
      for (const ds of state[c].values()) {
        if (materializeDoc("x", ds)) documents++;
        else tombstones++;
      }
    }
    return {
      segments: listed.length,
      pendingSegments: listed.filter((p) => !snapshotApplied.has(p.slice(paths.journal.length))).length,
      snapshotSegments: snapshotApplied.size,
      documents,
      tombstones,
    };
  };
  return store;
}
