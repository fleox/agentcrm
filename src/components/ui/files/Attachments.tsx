// Attachments display: image thumbnails grid (→ lightbox) + document
// chips (icon by type, size, download, open, delete).

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, ExternalLink, ImageOff, Trash2 } from "lucide-react";
import { fileKind, formatBytes, isPreviewable } from "../../../core/files";
import type { FileMeta } from "../../../core/types";
import { cn } from "../../../shared/lib/utils";
import { confirmDialog } from "../ConfirmDialog";
import { Spinner } from "../Display";
import { useFilesBridge } from "./context";
import { useFileUrl } from "./fileUrls";
import { FileIcon, fileTypeLabel } from "./FileIcon";
import { Lightbox } from "./Lightbox";
import { downloadStoredFile, openStoredFile } from "./actions";

export function ImageThumb({ meta, className, onClick, rounded = "rounded-md" }: { meta: Pick<FileMeta, "id" | "name">; className?: string; onClick?(): void; rounded?: string }) {
  const { url, loading, error } = useFileUrl(meta.id, { thumb: true });
  const content = url ? (
    <img src={url} alt={meta.name} className="h-full w-full object-cover" draggable={false} />
  ) : loading ? (
    <Spinner size="sm" />
  ) : (
    <ImageOff className="h-4 w-4 text-surface-400" aria-label={error ?? undefined} />
  );
  const cls = cn("flex items-center justify-center overflow-hidden border border-surface-200 bg-surface-100 dark:border-surface-700 dark:bg-surface-800", rounded, className);
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, "cursor-zoom-in transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent-500")} title={meta.name} aria-label={meta.name}>
      {content}
    </button>
  ) : (
    <span className={cls}>{content}</span>
  );
}

export function FileChip({ meta, onDelete, className }: { meta: FileMeta; onDelete?(): void; className?: string }) {
  const { t } = useTranslation();
  const bridge = useFilesBridge();
  const icon = "inline-flex h-6 w-6 items-center justify-center rounded text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800 dark:hover:text-surface-200 [&>svg]:h-3.5 [&>svg]:w-3.5";
  return (
    <div className={cn("group/chip flex min-w-0 max-w-full items-center gap-2 rounded-md border border-surface-200 bg-white py-1 pl-1 pr-1 dark:border-surface-700 dark:bg-surface-900", className)} data-file-id={meta.id}>
      <FileIcon mime={meta.mime} name={meta.name} />
      <button
        type="button"
        onClick={() => bridge && void (isPreviewable(meta.mime) ? openStoredFile(bridge, meta) : downloadStoredFile(bridge, meta))}
        className="min-w-0 flex-1 text-left"
        title={meta.name}
      >
        <div className="truncate text-xs font-medium text-surface-800 hover:underline dark:text-surface-100">{meta.name}</div>
        <div className="text-2xs text-surface-400">
          {fileTypeLabel(meta.mime, meta.name)} · {formatBytes(meta.size)}
        </div>
      </button>
      {bridge && (
        <span className="flex shrink-0 items-center">
          {isPreviewable(meta.mime) && (
            <button type="button" className={icon} title={t("files.openNewTab")} aria-label={t("files.openNewTab")} onClick={() => void openStoredFile(bridge, meta)}>
              <ExternalLink />
            </button>
          )}
          <button type="button" className={icon} title={t("files.download")} aria-label={t("files.download")} onClick={() => void downloadStoredFile(bridge, meta)}>
            <Download />
          </button>
          {onDelete && (
            <button type="button" className={cn(icon, "hover:text-red-600")} title={t("files.delete")} aria-label={t("files.delete")} onClick={onDelete}>
              <Trash2 />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

// Attachments of an activity (or any id list). Deleted / unknown ids are
// skipped. `onRemove` (permission-aware, by the caller) deletes a file.
export function AttachmentList({ ids, onRemove, className, size = "md" }: { ids: string[]; onRemove?(meta: FileMeta): void | Promise<void>; className?: string; size?: "sm" | "md" }) {
  const { t } = useTranslation();
  const bridge = useFilesBridge();
  const [open, setOpen] = useState<number | null>(null);
  const metas = useMemo(() => (bridge ? ids.map((id) => bridge.meta(id)).filter((m): m is FileMeta => !!m && !m.deletedAt) : []), [bridge, ids]);
  const images = metas.filter((m) => fileKind(m.mime, m.name) === "image");
  const docs = metas.filter((m) => fileKind(m.mime, m.name) !== "image");
  if (!metas.length) return null;
  const remove = onRemove
    ? async (m: FileMeta) => {
        if (!(await confirmDialog({ title: t("files.deleteTitle", { name: m.name }), description: t("files.deleteHint"), danger: true, confirmLabel: t("common.delete") }))) return;
        await onRemove(m);
      }
    : undefined;
  const dim = size === "sm" ? "h-14 w-14" : "h-20 w-20";
  return (
    <div className={cn("space-y-1.5", className)} data-testid="attachments">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((m, i) => (
            <div key={m.id} className="group/thumb relative">
              <ImageThumb meta={m} className={dim} onClick={() => setOpen(i)} />
              {remove && (
                <button
                  type="button"
                  aria-label={t("files.delete")}
                  title={t("files.delete")}
                  onClick={() => void remove(m)}
                  className="absolute right-0.5 top-0.5 hidden h-5 w-5 items-center justify-center rounded bg-black/60 text-white hover:bg-red-600 group-hover/thumb:inline-flex [&>svg]:h-3 [&>svg]:w-3"
                >
                  <Trash2 />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {docs.length > 0 && (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {docs.map((m) => (
            <FileChip key={m.id} meta={m} onDelete={remove ? () => void remove(m) : undefined} />
          ))}
        </div>
      )}
      {open !== null && images[open] && <Lightbox items={images} index={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
