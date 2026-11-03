// Re-encrypts a journal dataset: change the passphrase, turn encryption
// on (null → passphrase) or off (passphrase → null). Additive to
// ./journalStore.ts, same file formats.
//
//   1. open the dataset with the OLD passphrase and compact it, so the
//      state lives in ONE file (snapshot.bin) and no segment remains;
//   2. re-encode any segment that slipped in meanwhile;
//   3. back up the old snapshot + keyinfo (`*.rekey-backup`), write the
//      new snapshot, then the new keyinfo.json, then drop the backups.
//
// Every other browser / CLI must re-enter the new passphrase afterwards;
// run it while nobody else is editing (segments written with the old key
// after step 2 would be unreadable).

import { decryptText, encryptText, newEncryptionParams, PassphraseError, PBKDF2_ITERATIONS } from "../../shared/crypto";
import { base64ToBytes, bytesToBase64 } from "../../shared/git/encoding";
import type { StorageConnector } from "../../shared/storage/types";
import { decodeJson, encodeJson, type CodecKey } from "./codec";
import { createJournalStore, JOURNAL_FORMAT, JOURNAL_VERSION, type KeyInfo } from "./journalStore";

// Same constant as journalStore.ts (the encrypted check value).
const KEY_CHECK = "agentcrm-keycheck";

export interface RekeyOptions {
  connector: StorageConnector;
  root: string;
  oldPassphrase: string | null;
  // null → store unencrypted.
  newPassphrase: string | null;
  iterations?: number;
  onProgress?(step: "compact" | "segments" | "snapshot" | "keyinfo" | "done"): void;
}

function join(root: string, path: string): string {
  const r = root.replace(/^\/+|\/+$/g, "");
  return r ? `${r}/${path}` : path;
}

export async function readKeyInfo(connector: StorageConnector, root: string): Promise<KeyInfo | null> {
  const bytes = await connector.getBytes?.(join(root, "keyinfo.json"));
  if (!bytes) return null;
  const info = JSON.parse(new TextDecoder().decode(bytes)) as KeyInfo;
  return info.format === JOURNAL_FORMAT ? info : null;
}

export async function rekeyJournal(opts: RekeyOptions): Promise<{ encrypted: boolean }> {
  const { connector, root } = opts;
  if (!connector.getBytes || !connector.listPrefix) throw new Error(`The "${connector.id}" storage can't hold a journal dataset.`);
  const next = opts.newPassphrase?.trim() || null;
  const info = await readKeyInfo(connector, root);
  if (!info) throw new Error("No AgentCRM dataset at this location.");

  // 1. Compact with the old key (validates the old passphrase too).
  opts.onProgress?.("compact");
  const store = createJournalStore({ connector, root, encrypted: info.encrypted, passphrase: opts.oldPassphrase, pollIntervalMs: 3_600_000 });
  try {
    await store.ready();
    await store.compact();
  } finally {
    store.close?.();
  }
  const oldPass = info.encrypted ? opts.oldPassphrase : null;
  if (info.encrypted && !oldPass) throw new PassphraseError("missing");

  const key: CodecKey | null = next ? { passphrase: next, params: newEncryptionParams(opts.iterations ?? PBKDF2_ITERATIONS) } : null;

  // 2. Segments written since the compaction.
  opts.onProgress?.("segments");
  const prefix = join(root, "journal/");
  for (const path of (await connector.listPrefix(prefix)).filter((p) => p.endsWith(".bin"))) {
    const bytes = await connector.getBytes(path);
    if (!bytes) continue;
    const seg = await decodeJson<unknown>(bytes, oldPass);
    await connector.put({ path, content: bytesToBase64(await encodeJson(seg, key)), encoding: "base64" });
  }

  // 3. Snapshot + keyinfo, with backups for a crash in between.
  opts.onProgress?.("snapshot");
  const snapPath = join(root, "snapshot.bin");
  const keyPath = join(root, "keyinfo.json");
  const snapBytes = await connector.getBytes(snapPath);
  const keyBackup = join(root, "keyinfo.json.rekey-backup");
  const snapBackup = join(root, "snapshot.bin.rekey-backup");
  await connector.put({ path: keyBackup, content: JSON.stringify(info, null, 2) + "\n" });
  if (snapBytes) {
    await connector.put({ path: snapBackup, content: bytesToBase64(snapBytes), encoding: "base64" });
    const snapshot = await decodeJson<unknown>(snapBytes, oldPass);
    await connector.put({ path: snapPath, content: bytesToBase64(await encodeJson(snapshot, key)), encoding: "base64" });
  }
  opts.onProgress?.("keyinfo");
  const nextInfo: KeyInfo = { format: JOURNAL_FORMAT, version: JOURNAL_VERSION, encrypted: !!key, createdAt: info.createdAt ?? Date.now() };
  if (key) {
    nextInfo.kdf = { name: "PBKDF2-SHA256", iterations: key.params.iterations, salt: bytesToBase64(key.params.salt) };
    nextInfo.check = bytesToBase64(await encryptText(KEY_CHECK, key.passphrase, key.params));
  }
  await connector.put({ path: keyPath, content: JSON.stringify(nextInfo, null, 2) + "\n" });
  await connector.delete(keyBackup);
  if (snapBytes) await connector.delete(snapBackup);
  opts.onProgress?.("done");
  return { encrypted: !!key };
}

// Checks a passphrase against keyinfo.json without loading the data
// (setup wizard / access page). true = opens, false = wrong passphrase.
export async function checkJournalPassphrase(connector: StorageConnector, root: string, passphrase: string | null): Promise<{ exists: boolean; encrypted: boolean; ok: boolean }> {
  const info = await readKeyInfo(connector, root);
  if (!info) return { exists: false, encrypted: false, ok: true };
  if (!info.encrypted) return { exists: true, encrypted: false, ok: true };
  if (!passphrase || !info.check) return { exists: true, encrypted: true, ok: !info.check && !!passphrase };
  try {
    const check = await decryptText(base64ToBytes(info.check), passphrase);
    return { exists: true, encrypted: true, ok: check === KEY_CHECK };
  } catch {
    return { exists: true, encrypted: true, ok: false };
  }
}
