import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { FileMeta } from "../../src/core/types";
import type { OpsContext } from "../../src/ops/context";
import { withSession } from "../ops/session";
import type { Command } from "./types";
import { AS_OPTION, boolOpt, numOpt, positional, SITE_OPTION, strOpt, table, usage, YES_OPTION } from "./util";

// Files (images & attachments) from the command line. Bytes are read
// from / written to local paths; the CRM's size limit applies; images
// are uploaded as they are (no resizing in Node — the admin resizes).

export function fileOut(f: FileMeta & { via?: { kind: string; id: string } }) {
  return {
    id: f.id,
    name: f.name,
    mime: f.mime,
    size: f.size,
    ...(f.width && f.height ? { width: f.width, height: f.height } : {}),
    targets: f.targets,
    ...(f.via ? { via: f.via.kind } : {}),
    createdAt: new Date(f.createdAt).toISOString(),
    ...(f.deletedAt ? { deletedAt: new Date(f.deletedAt).toISOString() } : {}),
  };
}

// Reads a local file for upload (exists, regular file, under the hard cap;
// the CRM limit is enforced by the op).
export function readLocalFile(path: string): { name: string; bytes: Uint8Array } {
  const full = resolve(path);
  if (!existsSync(full)) usage(`${path} does not exist.`);
  const st = statSync(full);
  if (!st.isFile()) usage(`${path} is not a file.`);
  if (st.size > 1024 * 1024 * 1024) usage(`${path} is larger than 1 GB.`);
  return { name: basename(full), bytes: new Uint8Array(readFileSync(full)) };
}

// Uploads local paths (no target: attached by the caller afterwards).
export async function uploadLocalFiles(ctx: OpsContext, paths: string[], targets: string[] = []): Promise<FileMeta[]> {
  const { uploadFile } = await import("../../src/ops/files");
  const { guessMime, imageDimensions } = await import("../../src/core/files");
  const out: FileMeta[] = [];
  for (const p of paths) {
    const { name, bytes } = readLocalFile(p);
    const mime = guessMime(name);
    const dims = mime.startsWith("image/") ? imageDimensions(bytes) : null;
    out.push(await uploadFile(ctx, { name, mime, bytes, targets, ...(dims ?? {}) }));
  }
  return out;
}

export const ATTACH_OPTION = { name: "attach", type: "string" as const, description: "Attach a local file (repeatable; images are uploaded as they are).", multiple: true };

const U = {
  list: "files list [--record <id> | --activity <id>] [--related] [--kind image|pdf|document|…] [--search <name>] [--limit n]",
  upload: "files upload <path>… (--record <id> | --activity <id>)",
  get: "files get <id> --out <path> [--thumb]",
  delete: "files delete <id> [--yes]",
  usage: "files usage",
};

export const filesCommand: Command = {
  name: "files",
  usage: "files <list|upload|get|delete|usage> …",
  summary: "Images and attachments: list a record's / activity's files (metadata), upload local files to a record or an activity, download one, soft-delete (bytes purged by `compact`), storage usage.",
  subcommands: [
    { name: "list", usage: U.list, summary: "Files of a record (its own, its activities', --related: linked records') or of an activity; all files without a target." },
    { name: "upload", usage: U.upload, summary: "Upload local files and attach them to a record or an activity (CRM size limit applies).", writes: true },
    { name: "get", usage: U.get, summary: "Download a file's bytes (decrypted) to a local path." },
    { name: "delete", usage: U.delete, summary: "Soft-delete a file (removed from its records / activities; bytes purged by `compact`). Plan unless --yes.", writes: true, destructive: true },
    { name: "usage", usage: U.usage, summary: "Number of files and total size." },
  ],
  options: [
    SITE_OPTION,
    AS_OPTION,
    YES_OPTION,
    { name: "record", type: "string", description: "Record id." },
    { name: "activity", type: "string", description: "Activity id (note, task, call, email, meeting)." },
    { name: "related", type: "boolean", description: "list: include files of related records." },
    { name: "kind", type: "string", description: "list: image, pdf, document, spreadsheet, presentation, archive, text, audio, video, other." },
    { name: "search", type: "string", description: "list: part of the file name." },
    { name: "limit", type: "string", description: "list: max items (default 100)." },
    { name: "out", type: "string", description: "get: local path to write." },
    { name: "thumb", type: "boolean", description: "get: the thumbnail when there is one." },
  ],
  async run({ io, options, positionals }) {
    const [action, ...args] = positionals;
    switch (action) {
      case "list":
        return withSession(io, options, {}, async ({ ctx }) => {
          const { listFiles } = await import("../../src/ops/files");
          const target = strOpt(options, "record") ?? strOpt(options, "activity") ?? null;
          const items = listFiles(ctx, target, { includeRelated: boolOpt(options, "related"), kind: strOpt(options, "kind") as never, search: strOpt(options, "search") });
          const limit = Math.min(1000, numOpt(options, "limit") ?? 100);
          return { total: items.length, files: items.slice(0, limit).map(fileOut) };
        }, (r) => `${r.total} file(s)\n${table(r.files, ["id", "name", "mime", "size", "createdAt"])}`);
      case "upload": {
        if (!args.length) usage("files upload needs at least one path.", `Usage: agentcrm ${U.upload}`);
        const record = strOpt(options, "record");
        const activity = strOpt(options, "activity");
        if (!record && !activity) usage("files upload needs --record <id> or --activity <id>.");
        if (record && activity) usage("Give --record or --activity, not both.");
        for (const p of args) readLocalFile(p);
        return withSession(io, options, { lock: true }, async ({ ctx }) => {
          const { attachFile } = await import("../../src/ops/files");
          const files = await uploadLocalFiles(ctx, args, record ? [record] : []);
          if (activity) for (const f of files) await attachFile(ctx, f.id, { kind: "activity", id: activity });
          const { requireFile } = await import("../../src/ops/store");
          return { uploaded: files.map((f) => fileOut(requireFile(ctx.store, f.id))) };
        }, (r) => `Uploaded ${r.uploaded.length} file(s)\n${table(r.uploaded, ["id", "name", "size"])}`);
      }
      case "get": {
        const id = positional(args, 0, "file id", U.get);
        const out = strOpt(options, "out");
        if (!out) usage("files get needs --out <path>.");
        return withSession(io, options, {}, async ({ ctx }) => {
          const { getFile, getFileBytes } = await import("../../src/ops/files");
          const meta = getFile(ctx, id);
          const bytes = await getFileBytes(ctx, id, { thumb: boolOpt(options, "thumb") });
          writeFileSync(resolve(out), bytes);
          return { id, name: meta.name, mime: meta.mime, bytes: bytes.length, path: resolve(out) };
        }, (r) => `Wrote ${r.bytes} bytes (${r.name}) to ${r.path}`);
      }
      case "delete": {
        const id = positional(args, 0, "file id", U.delete);
        return withSession(io, options, { lock: options.yes === true }, async ({ ctx }) => {
          const { getFile, deleteFile } = await import("../../src/ops/files");
          const meta = fileOut(getFile(ctx, id));
          if (options.yes !== true) return { needsConfirmation: true as const, plan: { delete: meta } };
          await deleteFile(ctx, id);
          return { deleted: id };
        }, (r) => ("plan" in r && r.plan ? `Would delete ${r.plan.delete.name} (${r.plan.delete.id}). Re-run with --yes once the user agrees.` : `Deleted ${"deleted" in r ? r.deleted : id} (bytes purged by \`agentcrm compact\`).`));
      }
      case "usage":
        return withSession(io, options, {}, async ({ ctx }) => (await import("../../src/ops/files")).fileUsage(ctx));
      default:
        usage(`Unknown files action "${action ?? ""}".`, "Use list, upload, get, delete or usage.");
    }
  },
};

// `records image <recordId> <path> | --remove [--field <id>]`.
export async function recordImageAction(io: Parameters<Command["run"]>[0]["io"], options: Parameters<Command["run"]>[0]["options"], args: string[]) {
  const [recordId, path] = args;
  if (!recordId) usage("records image needs a record id.", "Usage: agentcrm records image <recordId> <path> | --remove [--field <id>]");
  const remove = options.remove === true;
  if (!remove && !path) usage("records image needs an image path (or --remove).");
  const local = remove ? null : readLocalFile(path);
  return withSession(io, options, { lock: true }, async ({ ctx }) => {
    const { setRecordImage, clearRecordImage } = await import("../../src/ops/files");
    const field = strOpt(options, "field");
    if (!local) {
      const r = await clearRecordImage(ctx, recordId, field);
      return { id: r.id, image: null };
    }
    const { guessMime, imageDimensions } = await import("../../src/core/files");
    const mime = guessMime(local.name);
    const res = await setRecordImage(ctx, recordId, field, { ...local, mime, ...(imageDimensions(local.bytes) ?? {}) });
    return { id: res.record.id, image: fileOut(res.file) };
  }, (r) => (r.image ? `Image of ${r.id} set to ${r.image.name} (${r.image.id})` : `Image of ${r.id} removed`));
}
