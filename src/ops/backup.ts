// Full backup as a ZIP: data.json (the JSON export, `files` metadata
// included) + files/<blobId>.bin (decrypted bytes of every live file and
// its thumbnail). Restore = importJson + every blob put back into the
// target backend's FileStore (re-encrypted by it when the backend does).
// The archive itself is NOT encrypted: keep it somewhere safe.

import JSZip from "jszip";
import type { FileMeta } from "../core/types";
import { FILE_ID_RE } from "../data/files/ids";
import { assertCan, OpsError, type OpsContext } from "./context";
import { exportJson, importJson, planImportJson, type ImportJsonPlan, type JsonExport } from "./exportCsv";
import { filesOf } from "./store";

export const BACKUP_DATA_FILE = "data.json";
export const BACKUP_FILES_DIR = "files/";

export interface BackupReport {
  files: number;
  missing: string[];
  bytes: number;
}

export async function exportBackupZip(ctx: OpsContext, opts: { includeFiles?: boolean } = {}): Promise<{ zip: Uint8Array; report: BackupReport }> {
  assertCan(ctx, "export");
  const zip = new JSZip();
  const data = exportJson(ctx);
  zip.file(BACKUP_DATA_FILE, JSON.stringify(data, null, 2));
  const report: BackupReport = { files: 0, missing: [], bytes: 0 };
  if (opts.includeFiles !== false && ctx.store.files) {
    for (const f of filesOf(ctx.store)) {
      for (const id of [f.id, ...(f.thumbId ? [f.thumbId] : [])]) {
        const bytes = await ctx.store.files.get(id).catch(() => null);
        if (!bytes) {
          if (id === f.id) report.missing.push(f.id);
          continue;
        }
        zip.file(`${BACKUP_FILES_DIR}${id}.bin`, bytes, { binary: true });
        report.bytes += bytes.length;
        if (id === f.id) report.files++;
      }
    }
  }
  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { zip: out, report };
}

export async function importBackupZip(ctx: OpsContext, input: Uint8Array | ArrayBuffer, opts: { mode?: "merge" | "replace" } = {}): Promise<{ written: number; deleted: number; files: number }> {
  assertCan(ctx, "settings.write");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    throw new OpsError("validation", "Not a ZIP archive.");
  }
  const entry = zip.file(BACKUP_DATA_FILE);
  if (!entry) throw new OpsError("validation", `Not an AgentCRM backup (no ${BACKUP_DATA_FILE}).`);
  let data: JsonExport;
  try {
    data = JSON.parse(await entry.async("string")) as JsonExport;
  } catch {
    throw new OpsError("validation", `${BACKUP_DATA_FILE} is not valid JSON.`);
  }
  // Bytes first: metadata only appears once its blob is stored.
  let files = 0;
  const blobs = Object.keys(zip.files).filter((p) => p.startsWith(BACKUP_FILES_DIR) && p.endsWith(".bin"));
  if (blobs.length) {
    if (!ctx.store.files) throw new OpsError("invalid", `The "${ctx.store.kind}" backend can't store files: restore the data JSON only.`);
    const metaIds = new Set(((data.collections.files ?? []) as unknown as FileMeta[]).map((f) => f.id));
    for (const p of blobs) {
      const id = p.slice(BACKUP_FILES_DIR.length, -".bin".length);
      if (!FILE_ID_RE.test(id)) continue;
      await ctx.store.files.put(id, await zip.file(p)!.async("uint8array"));
      if (metaIds.has(id)) files++;
    }
  }
  const res = await importJson(ctx, data, { mode: opts.mode });
  return { ...res, files };
}

// What a backup ZIP holds (shown before restoring). No permission needed:
// it only reads the given bytes.
export async function readBackupZipInfo(input: Uint8Array | ArrayBuffer): Promise<{ data: JsonExport; files: number }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    throw new OpsError("validation", "Not a ZIP archive.");
  }
  const entry = zip.file(BACKUP_DATA_FILE);
  if (!entry) throw new OpsError("validation", `Not an AgentCRM backup (no ${BACKUP_DATA_FILE}).`);
  const data = JSON.parse(await entry.async("string")) as JsonExport;
  if (data?.format !== "agentcrm-export") throw new OpsError("validation", "Not an AgentCRM export.");
  const metaIds = new Set(((data.collections.files ?? []) as unknown as FileMeta[]).map((f) => f.id));
  const files = Object.keys(zip.files).filter((p) => p.startsWith(BACKUP_FILES_DIR) && metaIds.has(p.slice(BACKUP_FILES_DIR.length, -".bin".length))).length;
  return { data, files };
}

// The restore plan of a backup ZIP: validates the archive and tells what
// importBackupZip would change (no write).
export async function planBackupZip(ctx: OpsContext, input: Uint8Array | ArrayBuffer, opts: { mode?: "merge" | "replace" } = {}): Promise<ImportJsonPlan & { files: number; exportedAt?: string }> {
  assertCan(ctx, "settings.write");
  let info: Awaited<ReturnType<typeof readBackupZipInfo>>;
  try {
    info = await readBackupZipInfo(input);
  } catch (err) {
    if (err instanceof SyntaxError) throw new OpsError("validation", `${BACKUP_DATA_FILE} is not valid JSON.`);
    throw err;
  }
  if (info.files && !ctx.store.files) throw new OpsError("invalid", `The "${ctx.store.kind}" backend can't store files: restore the data JSON only.`);
  return { ...planImportJson(ctx, info.data, opts), files: info.files, ...(info.data.exportedAt ? { exportedAt: info.data.exportedAt } : {}) };
}
