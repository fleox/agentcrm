// Files: images (record avatars / logos, inline note images) and
// attachments (notes, tasks, calls, emails, meetings, records). Metadata
// is a `files/<id>` document (FileMeta); the bytes go to the backend's
// FileStore (DataStore.files — src/data/files/): encrypted next to the
// journal, IndexedDB, git repo, Firebase Storage, memory.
//
// Image resizing / thumbnails happen in the admin (browser canvas, see
// src/components/ui/files/imageProcessing.ts) BEFORE uploadFile; the CLI
// uploads files as they are. Soft delete keeps the blob until `compact`
// purges it (GDPR: blobs of deleted files and of files whose every
// target is gone are physically deleted — purgeFiles).

import { DEFAULT_MAX_UPLOAD_MB, guessMime, sanitizeFileName, sha256Hex, thumbIdOf, fileKind, type FileKind } from "../core/files";
import { newId } from "../core/ids";
import type { CrmRecord, FileMeta, FileTarget } from "../core/types";
import { fileStoreOf, FileStoreUnavailableError } from "../data/files";
import type { DocMutation } from "../data/types";
import { mapLimit } from "../shared/git/http";
import { actorId, assertCan, OpsError, type OpsContext } from "./context";
import { fileFieldIds, fileIdsIn, fileTargetPatch, referencedFileIds, sameTarget } from "./fileRefs";
import { timelineScope } from "./activities";
import { updateRecord } from "./records";
import { activitiesOf, asDoc, fileOf, filesOf, objectOf, recordOf, recordsOf, requireFile, requireObject, requireRecord, settingsDoc } from "./store";

export interface UploadFileInput {
  name: string;
  mime?: string;
  bytes: Uint8Array;
  // Records / activities the file is attached to: refs, or ids (a record
  // or activity id, resolved).
  targets?: (FileTarget | string)[];
  width?: number;
  height?: number;
  // Small preview (images; made by the admin), stored as "<id>_t".
  thumbnail?: { bytes: Uint8Array; mime?: string; width?: number; height?: number };
  id?: string;
}

export interface FileListItem extends FileMeta {
  // How the file relates to the listed target: attached to the record
  // itself, to one of its activities, or to a related record.
  via: { kind: "record" | "activity" | "related"; id: string };
}

export interface ListFilesOptions {
  // Also files of the record's activities (default true).
  includeActivities?: boolean;
  // Also files of related records and their activities (company → people, deals).
  includeRelated?: boolean;
  includeDeleted?: boolean;
  search?: string;
  kind?: FileKind;
  limit?: number;
}

export interface PurgeFilesReport {
  purged: string[];
  blobsDeleted: number;
  orphanBlobs: number;
  errors: { id: string; message: string }[];
  dryRun: boolean;
}

// Orphan files (no target, unreferenced) are kept this long: an upload
// made just before the note that references it is saved must survive a
// concurrent compaction.
export const ORPHAN_GRACE_MS = 86_400_000;

export function maxUploadBytes(ctx: OpsContext): number {
  const mb = settingsDoc(ctx.store)?.maxUploadMb;
  return Math.round((typeof mb === "number" && mb > 0 ? mb : DEFAULT_MAX_UPLOAD_MB) * 1024 * 1024);
}

function resolveTarget(ctx: OpsContext, ref: FileTarget | string): FileTarget {
  const id = typeof ref === "string" ? ref : ref.id;
  const kind = typeof ref === "string" ? undefined : ref.kind;
  if (kind !== "activity") {
    const r = recordOf(ctx.store, id);
    if (r && !r.deletedAt) return { kind: "record", object: r.object, id: r.id };
    if (kind === "record") throw new OpsError("validation", `Record "${id}" not found.`);
  }
  const a = ctx.store.get("activities", id) as { id: string; deletedAt?: number } | undefined;
  if (a && !a.deletedAt) return { kind: "activity", id: a.id };
  throw new OpsError("validation", `Target "${id}" is neither a record nor an activity.`);
}

function uniqueTargets(targets: FileTarget[]): FileTarget[] {
  return targets.filter((t, i) => targets.findIndex((x) => sameTarget(x, t)) === i);
}

// Mutations adding / removing a file id to activities' `attachments`.
function activityAttachmentMutations(ctx: OpsContext, fileId: string, add: string[], remove: string[] = []): DocMutation[] {
  const out: DocMutation[] = [];
  for (const id of new Set([...add, ...remove])) {
    const a = ctx.store.get("activities", id) as { attachments?: string[] } | undefined;
    if (!a) continue;
    const current = a.attachments ?? [];
    const next = add.includes(id) ? (current.includes(fileId) ? current : [...current, fileId]) : current.filter((x) => x !== fileId);
    if (next.length === current.length && next.every((x, i) => x === current[i])) continue;
    out.push({ op: "patch", collection: "activities", id, fields: { attachments: next.length ? next : undefined, updatedAt: ctx.now() } });
  }
  return out;
}

// ─── Upload ─────────────────────────────────────────────────────────────

export async function uploadFile(ctx: OpsContext, input: UploadFileInput): Promise<FileMeta> {
  assertCan(ctx, "records.write");
  if (!(input.bytes instanceof Uint8Array)) throw new OpsError("validation", "uploadFile: bytes must be a Uint8Array.");
  const name = sanitizeFileName(input.name);
  const limit = maxUploadBytes(ctx);
  if (input.bytes.length > limit) {
    throw new OpsError("validation", `${name} is too large (${Math.ceil(input.bytes.length / 1048576)} MB > ${Math.round(limit / 1048576)} MB, Settings → General → Max upload size).`);
  }
  if (input.bytes.length === 0) throw new OpsError("validation", `${name} is empty.`);
  const targets = uniqueTargets((input.targets ?? []).map((t) => resolveTarget(ctx, t)));
  const files = fileStoreOf(ctx.store);
  const now = ctx.now();
  const id = input.id ?? newId(now);
  if (fileOf(ctx.store, id)) throw new OpsError("conflict", `File "${id}" already exists.`);
  const mime = guessMime(name, input.mime);
  const meta: FileMeta = {
    id,
    name,
    mime,
    size: input.bytes.length,
    ...(input.width ? { width: Math.round(input.width) } : {}),
    ...(input.height ? { height: Math.round(input.height) } : {}),
    ...(input.thumbnail ? { thumbId: thumbIdOf(id) } : {}),
    sha256: await sha256Hex(input.bytes),
    createdAt: now,
    updatedAt: now,
    ...(actorId(ctx) ? { createdBy: actorId(ctx) } : {}),
    targets,
  };
  const blobs = [{ id, bytes: input.bytes, meta: { name, mime } }];
  if (input.thumbnail) blobs.push({ id: thumbIdOf(id), bytes: input.thumbnail.bytes, meta: { name: `thumb-${name}`, mime: input.thumbnail.mime ?? "image/webp" } });
  try {
    if (files.putMany) await files.putMany(blobs);
    else for (const b of blobs) await files.put(b.id, b.bytes, b.meta);
  } catch (err) {
    if (err instanceof FileStoreUnavailableError) throw new OpsError("invalid", err.message);
    throw err;
  }
  const mutations: DocMutation[] = [{ op: "set", collection: "files", doc: asDoc(meta) }];
  mutations.push(...activityAttachmentMutations(ctx, id, targets.filter((t) => t.kind === "activity").map((t) => t.id)));
  await ctx.store.write(mutations, { message: `Upload ${name}` });
  return requireFile(ctx.store, id);
}

// ─── Attach / detach ────────────────────────────────────────────────────

export async function attachFile(ctx: OpsContext, fileId: string, target: FileTarget | string): Promise<FileMeta> {
  assertCan(ctx, "records.write");
  const file = requireFile(ctx.store, fileId);
  const t = resolveTarget(ctx, target);
  const mutations: DocMutation[] = [];
  const patch = fileTargetPatch(ctx, file, [t]);
  if (patch) mutations.push(patch);
  if (t.kind === "activity") mutations.push(...activityAttachmentMutations(ctx, fileId, [t.id]));
  if (mutations.length) await ctx.store.write(mutations, { message: `Attach ${file.name}` });
  return requireFile(ctx.store, fileId);
}

export async function detachFile(ctx: OpsContext, fileId: string, target: FileTarget | string): Promise<FileMeta> {
  assertCan(ctx, "records.write");
  const file = requireFile(ctx.store, fileId);
  const id = typeof target === "string" ? target : target.id;
  const t = file.targets.find((x) => x.id === id);
  if (!t) return file;
  const mutations: DocMutation[] = [];
  const patch = fileTargetPatch(ctx, file, [], [t]);
  if (patch) mutations.push(patch);
  if (t.kind === "activity") mutations.push(...activityAttachmentMutations(ctx, fileId, [], [t.id]));
  if (t.kind === "record") mutations.push(...recordFieldCleanup(ctx, fileId, [t.id]));
  await ctx.store.write(mutations, { message: `Detach ${file.name}` });
  return requireFile(ctx.store, fileId);
}

// Record fields (image / files) still pointing at a file → cleared.
function recordFieldCleanup(ctx: OpsContext, fileId: string, onlyRecords?: string[]): DocMutation[] {
  const out: DocMutation[] = [];
  const now = ctx.now();
  for (const r of recordsOf(ctx.store, undefined, { includeDeleted: true })) {
    if (onlyRecords && !onlyRecords.includes(r.id)) continue;
    const fields: Record<string, unknown> = {};
    for (const f of fileFieldIds(ctx, r.object)) {
      const ids = fileIdsIn(r.fields[f]);
      if (!ids.includes(fileId)) continue;
      const rest = ids.filter((x) => x !== fileId);
      fields[`fields.${f}`] = Array.isArray(r.fields[f]) ? (rest.length ? rest : undefined) : undefined;
    }
    if (Object.keys(fields).length) out.push({ op: "patch", collection: "records", id: r.id, fields: { ...fields, updatedAt: now } });
  }
  return out;
}

// ─── Reads ──────────────────────────────────────────────────────────────

export function getFile(ctx: OpsContext, id: string, opts: { includeDeleted?: boolean } = {}): FileMeta {
  assertCan(ctx, "records.read");
  return requireFile(ctx.store, id, opts);
}

// Bytes of a file (or of its thumbnail when there is one).
export async function getFileBytes(ctx: OpsContext, id: string, opts: { thumb?: boolean } = {}): Promise<Uint8Array> {
  assertCan(ctx, "records.read");
  const file = requireFile(ctx.store, id, { includeDeleted: true });
  const files = fileStoreOf(ctx.store);
  if (opts.thumb && file.thumbId) {
    const thumb = await files.get(file.thumbId).catch(() => null);
    if (thumb) return thumb;
  }
  const bytes = await files.get(file.id);
  if (!bytes) throw new OpsError("notFound", `The bytes of ${file.name} are missing from the storage.`);
  return bytes;
}

// Files of a record (attached directly, held in its image / files fields,
// its activities' attachments, optionally its related records'), or of
// an activity. Newest first.
export function listFiles(ctx: OpsContext, target?: FileTarget | string | null, opts: ListFilesOptions = {}): FileListItem[] {
  assertCan(ctx, "records.read");
  const all = filesOf(ctx.store, { includeDeleted: opts.includeDeleted });
  let items: FileListItem[];
  if (!target) {
    items = all.map((f) => ({ ...f, via: f.targets[0] ? { kind: f.targets[0].kind, id: f.targets[0].id } : { kind: "record", id: "" } }));
  } else {
    const id = typeof target === "string" ? target : target.id;
    const activity = ctx.store.get("activities", id) as { id: string; attachments?: string[] } | undefined;
    const record = recordOf(ctx.store, id);
    if (!record && !activity) throw new OpsError("notFound", `"${id}" is neither a record nor an activity.`);
    const byId = new Map(all.map((f) => [f.id, f]));
    const out = new Map<string, FileListItem>();
    const add = (f: FileMeta | undefined, via: FileListItem["via"]) => {
      if (f && !out.has(f.id)) out.set(f.id, { ...f, via });
    };
    if (activity && !record) {
      for (const f of all) if (f.targets.some((t) => t.kind === "activity" && t.id === id)) add(f, { kind: "activity", id });
      for (const fid of activity.attachments ?? []) add(byId.get(fid), { kind: "activity", id });
    } else if (record) {
      const scope = opts.includeRelated ? timelineScope(ctx, record.id, true) : new Set([record.id]);
      const fieldIdsOf = (r: CrmRecord) => fileFieldIds(ctx, r.object).flatMap((f) => fileIdsIn(r.fields[f]));
      // 1. The record itself.
      for (const f of all) if (f.targets.some((t) => t.kind === "record" && t.id === record.id)) add(f, { kind: "record", id: record.id });
      for (const fid of fieldIdsOf(record)) add(byId.get(fid), { kind: "record", id: record.id });
      // 2. Its activities (and related records' when includeRelated).
      if (opts.includeActivities !== false || opts.includeRelated) {
        for (const a of activitiesOf(ctx.store)) {
          if (!a.targets.some((t) => scope.has(t.id))) continue;
          for (const f of all) if (f.targets.some((t) => t.kind === "activity" && t.id === a.id)) add(f, { kind: "activity", id: a.id });
          for (const fid of a.attachments ?? []) add(byId.get(fid), { kind: "activity", id: a.id });
        }
      }
      // 3. Related records.
      if (opts.includeRelated) {
        for (const rid of scope) {
          if (rid === record.id) continue;
          const r = recordOf(ctx.store, rid);
          if (!r || r.deletedAt) continue;
          for (const f of all) if (f.targets.some((t) => t.kind === "record" && t.id === rid)) add(f, { kind: "related", id: rid });
          for (const fid of fieldIdsOf(r)) add(byId.get(fid), { kind: "related", id: rid });
        }
      }
    }
    items = [...out.values()];
  }
  if (opts.kind) items = items.filter((f) => fileKind(f.mime, f.name) === opts.kind);
  const q = opts.search?.trim().toLowerCase();
  if (q) items = items.filter((f) => f.name.toLowerCase().includes(q));
  items.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
  return opts.limit ? items.slice(0, opts.limit) : items;
}

export interface FileUsage {
  count: number;
  totalBytes: number;
  images: number;
  deleted: number;
  deletedBytes: number;
}

export function fileUsage(ctx: OpsContext): FileUsage {
  assertCan(ctx, "records.read");
  const usage: FileUsage = { count: 0, totalBytes: 0, images: 0, deleted: 0, deletedBytes: 0 };
  for (const f of filesOf(ctx.store, { includeDeleted: true })) {
    if (f.deletedAt) {
      usage.deleted++;
      usage.deletedBytes += f.size;
      continue;
    }
    usage.count++;
    usage.totalBytes += f.size;
    if (fileKind(f.mime, f.name) === "image") usage.images++;
  }
  return usage;
}

// ─── Rename / delete ────────────────────────────────────────────────────

export async function renameFile(ctx: OpsContext, id: string, name: string): Promise<FileMeta> {
  assertCan(ctx, "records.write");
  requireFile(ctx.store, id);
  const clean = sanitizeFileName(name);
  await ctx.store.write([{ op: "patch", collection: "files", id, fields: { name: clean, updatedAt: ctx.now() } }], { message: "Rename file" });
  return requireFile(ctx.store, id);
}

// Soft delete: the file disappears from records / activities (their
// references are removed); its bytes stay until `compact` purges them.
export async function deleteFile(ctx: OpsContext, id: string): Promise<{ id: string }> {
  assertCan(ctx, "records.write");
  requireFile(ctx.store, id);
  const now = ctx.now();
  const mutations: DocMutation[] = [{ op: "patch", collection: "files", id, fields: { deletedAt: now, updatedAt: now } }];
  const holders = activitiesOf(ctx.store, { includeDeleted: true }).filter((a) => a.attachments?.includes(id)).map((a) => a.id);
  mutations.push(...activityAttachmentMutations(ctx, id, [], holders));
  mutations.push(...recordFieldCleanup(ctx, id));
  await ctx.store.write(mutations, { message: "Delete file" });
  return { id };
}

export async function restoreFile(ctx: OpsContext, id: string): Promise<FileMeta> {
  assertCan(ctx, "records.write");
  const f = requireFile(ctx.store, id, { includeDeleted: true });
  if (!f.deletedAt) return f;
  const mutations: DocMutation[] = [{ op: "patch", collection: "files", id, fields: { deletedAt: undefined, updatedAt: ctx.now() } }];
  mutations.push(...activityAttachmentMutations(ctx, id, f.targets.filter((t) => t.kind === "activity").map((t) => t.id)));
  await ctx.store.write(mutations, { message: "Restore file" });
  return requireFile(ctx.store, id);
}

// Physical purge (compact): blobs + metadata of soft-deleted files and of
// files whose every target is gone (hard-deleted records / activities)
// and that nothing references any more; plus blobs without metadata.
export async function purgeFiles(ctx: OpsContext, opts: { olderThanDays?: number; dryRun?: boolean } = {}): Promise<PurgeFilesReport> {
  assertCan(ctx, "compact");
  const report: PurgeFilesReport = { purged: [], blobsDeleted: 0, orphanBlobs: 0, errors: [], dryRun: !!opts.dryRun };
  const store = ctx.store.files;
  const now = ctx.now();
  const cutoff = now - (opts.olderThanDays ?? 0) * 86_400_000;
  const referenced = referencedFileIds(ctx);
  const exists = (t: FileTarget) => (t.kind === "record" ? !!recordOf(ctx.store, t.id) : !!ctx.store.get("activities", t.id));
  const all = filesOf(ctx.store, { includeDeleted: true });
  const doomed = all.filter((f) => {
    if (f.deletedAt) return f.deletedAt <= cutoff;
    if (referenced.has(f.id)) return false;
    const live = f.targets.filter(exists);
    if (live.length) return false;
    // Never attached at all: keep it a day (upload before save).
    return f.targets.length > 0 || f.createdAt <= now - ORPHAN_GRACE_MS;
  });
  if (opts.dryRun || !store) {
    report.purged = doomed.map((f) => f.id);
    return report;
  }
  const done: string[] = [];
  await mapLimit(doomed, 4, async (f) => {
    try {
      await store.delete(f.id);
      if (f.thumbId) await store.delete(f.thumbId);
      report.blobsDeleted += f.thumbId ? 2 : 1;
      done.push(f.id);
    } catch (err) {
      report.errors.push({ id: f.id, message: (err as Error).message });
    }
  });
  if (done.length) {
    const mutations: DocMutation[] = done.map((id) => ({ op: "delete", collection: "files", id }));
    for (const id of done) {
      const holders = activitiesOf(ctx.store, { includeDeleted: true }).filter((a) => a.attachments?.includes(id)).map((a) => a.id);
      mutations.push(...activityAttachmentMutations(ctx, id, [], holders));
    }
    await ctx.store.write(mutations, { message: `Purge ${done.length} files` });
  }
  report.purged = done;
  // Blobs nobody describes any more (an upload whose metadata write failed).
  if (store.list) {
    try {
      const known = new Set<string>();
      for (const f of filesOf(ctx.store, { includeDeleted: true })) {
        known.add(f.id);
        if (f.thumbId) known.add(f.thumbId);
      }
      const orphans = (await store.list()).filter((id) => !known.has(id));
      await mapLimit(orphans, 4, (id) => store.delete(id));
      report.orphanBlobs = orphans.length;
    } catch (err) {
      report.errors.push({ id: "*", message: `Listing stored files failed: ${(err as Error).message}` });
    }
  }
  return report;
}

// ─── Record images (avatar / logo) ──────────────────────────────────────

function imageFieldOf(ctx: OpsContext, record: CrmRecord, fieldId?: string): string {
  const object = requireObject(ctx.store, record.object);
  const id = fieldId ?? object.imageField;
  if (!id) throw new OpsError("validation", `${object.labelPlural} have no image field (Settings → Data model → ${object.labelPlural} → image field).`);
  const field = object.fields.find((f) => f.id === id);
  if (!field) throw new OpsError("validation", `Unknown field "${id}" on ${object.labelPlural}.`);
  if (field.type !== "image") throw new OpsError("validation", `${field.label} is not an image field.`);
  return id;
}

// Uploads `file` and sets it as the record's image (avatar / logo). The
// previous image is soft-deleted when nothing else uses it.
export async function setRecordImage(ctx: OpsContext, recordId: string, fieldId: string | undefined, file: UploadFileInput): Promise<{ record: CrmRecord; file: FileMeta }> {
  assertCan(ctx, "records.write");
  const record = requireRecord(ctx.store, recordId);
  const field = imageFieldOf(ctx, record, fieldId);
  if (!/^image\//.test(guessMime(file.name, file.mime))) throw new OpsError("validation", `${sanitizeFileName(file.name)} is not an image.`);
  const previous = typeof record.fields[field] === "string" ? (record.fields[field] as string) : undefined;
  const meta = await uploadFile(ctx, { ...file, targets: [{ kind: "record", object: record.object, id: record.id }] });
  const updated = await updateRecord(ctx, recordId, { [field]: meta.id });
  if (previous && previous !== meta.id) await retireImage(ctx, previous, record.id);
  return { record: updated, file: meta };
}

export async function clearRecordImage(ctx: OpsContext, recordId: string, fieldId?: string): Promise<CrmRecord> {
  assertCan(ctx, "records.write");
  const record = requireRecord(ctx.store, recordId);
  const field = imageFieldOf(ctx, record, fieldId);
  const previous = typeof record.fields[field] === "string" ? (record.fields[field] as string) : undefined;
  const updated = await updateRecord(ctx, recordId, { [field]: null });
  if (previous) await retireImage(ctx, previous, record.id);
  return updated;
}

// A replaced / removed image: soft-deleted unless still used elsewhere.
async function retireImage(ctx: OpsContext, fileId: string, recordId: string): Promise<void> {
  const f = fileOf(ctx.store, fileId);
  if (!f || f.deletedAt) return;
  if (referencedFileIds(ctx).has(fileId)) return;
  if (f.targets.some((t) => !(t.kind === "record" && t.id === recordId))) return;
  await deleteFile(ctx, fileId);
}

// Record image file id (for avatars), or undefined.
export function recordImageId(ctx: Pick<OpsContext, "store">, record: CrmRecord): string | undefined {
  const object = objectOf(ctx.store, record.object);
  const id = object?.imageField ? record.fields[object.imageField] : undefined;
  return typeof id === "string" && id ? id : undefined;
}
