// AI tools over files (images & attachments) — METADATA only: names,
// types, sizes, what they are attached to. The bytes never go to the
// model, and there is deliberately no "fetch a URL into the CRM" tool
// (no server-side fetch; uploads happen in the admin or `agentcrm files
// upload`). Appended to AI_TOOLS by ./tools.ts.

import { fileKind, formatBytes, inlineFileIds, type FileKind } from "../core/files";
import type { Activity, FileMeta } from "../core/types";
import { OpsError, type OpsContext } from "../ops/context";
import { fileUsage, listFiles } from "../ops/files";
import { activitiesOf, fileOf, recordOf, userOf } from "../ops/store";
import { labelOf } from "../ops/relations";
import type { AiTool } from "./tools";

const KINDS: FileKind[] = ["image", "pdf", "document", "spreadsheet", "presentation", "archive", "text", "audio", "video", "other"];

export function summarizeFile(ctx: OpsContext, f: FileMeta & { via?: { kind: string; id: string } }): Record<string, unknown> {
  return {
    id: f.id,
    name: f.name,
    kind: fileKind(f.mime, f.name),
    mime: f.mime,
    size: f.size,
    sizeLabel: formatBytes(f.size),
    ...(f.width && f.height ? { dimensions: `${f.width}×${f.height}` } : {}),
    createdAt: new Date(f.createdAt).toISOString(),
    ...(f.createdBy ? { uploadedBy: userOf(ctx.store, f.createdBy)?.name ?? f.createdBy } : {}),
    attachedTo: f.targets.map((t) => (t.kind === "record" ? { kind: "record", id: t.id, label: labelOf(ctx, t.id) } : { kind: "activity", id: t.id, title: (ctx.store.get("activities", t.id) as unknown as Activity | undefined)?.title })),
    ...(f.via ? { via: f.via.kind } : {}),
    ...(f.deletedAt ? { deleted: true } : {}),
  };
}

export const FILE_TOOLS: AiTool[] = [
  {
    name: "list_files",
    description:
      "Files (images, PDFs, documents) of a record — attached to it, its image fields, its activities' attachments; includeRelated adds linked records' files — or of one activity. Metadata only (name, type, size, attached to); without recordId / activityId: storage usage + the most recent files.",
    inputSchema: {
      type: "object",
      properties: {
        recordId: { type: "string", description: "Record id." },
        activityId: { type: "string", description: "Activity id (note, task…)." },
        includeRelated: { type: "boolean", description: "Also files of related records (e.g. a company's people and deals)." },
        kind: { type: "string", enum: KINDS },
        search: { type: "string", description: "Part of the file name." },
        limit: { type: "number", default: 30, maximum: 200 },
      },
    },
    mutating: false,
    handler: (ctx, input) => {
      const target = typeof input.recordId === "string" && input.recordId ? input.recordId : typeof input.activityId === "string" && input.activityId ? input.activityId : null;
      const limit = Math.min(200, typeof input.limit === "number" ? input.limit : 30);
      const items = listFiles(ctx, target, {
        includeRelated: input.includeRelated === true,
        kind: KINDS.includes(input.kind as FileKind) ? (input.kind as FileKind) : undefined,
        search: typeof input.search === "string" ? input.search : undefined,
      });
      return {
        ...(target ? {} : { usage: fileUsage(ctx) }),
        total: items.length,
        files: items.slice(0, limit).map((f) => summarizeFile(ctx, f)),
      };
    },
  },
  {
    name: "describe_attachments",
    description:
      "What is attached to an activity, or to every activity of a record: file metadata (name, type, size, dimensions) and the images referenced inline in the Markdown body. Use it before summarising a note / task that mentions attachments. Never returns file contents.",
    inputSchema: {
      type: "object",
      properties: {
        activityId: { type: "string" },
        recordId: { type: "string", description: "All activities of this record that have attachments." },
      },
    },
    mutating: false,
    handler: (ctx, input) => {
      const activityId = typeof input.activityId === "string" ? input.activityId : "";
      const recordId = typeof input.recordId === "string" ? input.recordId : "";
      if (!activityId && !recordId) throw new OpsError("validation", "Give activityId or recordId.");
      if (recordId && !recordOf(ctx.store, recordId)) throw new OpsError("notFound", `Record "${recordId}" not found.`);
      const acts = activitiesOf(ctx.store).filter((a) => (activityId ? a.id === activityId : a.targets.some((t) => t.id === recordId)));
      if (activityId && !acts.length) throw new OpsError("notFound", `Activity "${activityId}" not found.`);
      const out = acts
        .map((a) => {
          const ids = [...new Set([...(a.attachments ?? []), ...inlineFileIds(a.body)])];
          const files = ids.map((id) => fileOf(ctx.store, id)).filter((f): f is FileMeta => !!f && !f.deletedAt);
          return { activity: { id: a.id, type: a.type, title: a.title }, inline: inlineFileIds(a.body), files: files.map((f) => summarizeFile(ctx, f)) };
        })
        .filter((x) => x.files.length);
      return { activities: out };
    },
  },
];
