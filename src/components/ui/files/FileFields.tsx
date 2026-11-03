// FieldValue / FieldInput renderers of the `image` and `files` field types.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, Paperclip, Trash2, X } from "lucide-react";
import { formatBytes } from "../../../core/files";
import type { FieldDef, FileMeta } from "../../../core/types";
import { toast } from "../../../shared/lib/toast";
import { cn } from "../../../shared/lib/utils";
import { useFilesBridge } from "./context";
import { AttachmentList, ImageThumb } from "./Attachments";
import { FileIcon } from "./FileIcon";
import { FileDropZone, FilePickerButton } from "./uploads";

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" && v ? [v] : []);

export function FileFieldValue({ field, value, compact, className }: { field: FieldDef; value: unknown; compact?: boolean; className?: string }) {
  const bridge = useFilesBridge();
  const list = ids(value);
  const metas = bridge ? list.map((id) => bridge.meta(id)).filter((m): m is FileMeta => !!m && !m.deletedAt) : [];
  if (!metas.length) return null;
  if (field.type === "image") {
    const m = metas[0];
    return compact ? (
      <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
        <ImageThumb meta={m} className="h-5 w-5" rounded="rounded" />
        <span className="truncate">{m.name}</span>
      </span>
    ) : (
      <AttachmentList ids={[m.id]} size="sm" className={className} />
    );
  }
  if (compact) {
    return (
      <span className={cn("inline-flex min-w-0 items-center gap-1", className)} title={metas.map((m) => m.name).join(", ")}>
        <Paperclip className="h-3.5 w-3.5 shrink-0 text-surface-400" />
        <span className="truncate">{metas.length === 1 ? metas[0].name : `${metas.length} · ${metas.map((m) => m.name).join(", ")}`}</span>
      </span>
    );
  }
  return <AttachmentList ids={metas.map((m) => m.id)} size="sm" className={className} />;
}

export function FileFieldInput({ field, value, onChange, onCommit, disabled, className }: { field: FieldDef; value: unknown; onChange(v: unknown): void; onCommit?(v: unknown): void; disabled?: boolean; className?: string }) {
  const { t } = useTranslation();
  const bridge = useFilesBridge();
  const [busy, setBusy] = useState(false);
  const current = ids(value);
  const single = field.type === "image";
  if (!bridge) return <p className={cn("text-xs text-surface-400", className)}>{t("files.unavailable")}</p>;
  const set = (next: string[]) => {
    const v = single ? next[0] : next.length ? next : undefined;
    onChange(v);
    onCommit?.(v);
  };
  const upload = async (files: File[]) => {
    const picked = single ? files.slice(0, 1) : files;
    if (single && picked[0] && !picked[0].type.startsWith("image/")) {
      toast.error(t("files.notAnImage"));
      return;
    }
    setBusy(true);
    try {
      const added: string[] = [];
      for (const f of picked) added.push((await bridge.upload(f)).id);
      set(single ? added : [...current, ...added]);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const metas = current.map((id) => bridge.meta(id)).filter((m): m is FileMeta => !!m && !m.deletedAt);
  return (
    <FileDropZone onFiles={(f) => void upload(f)} disabled={disabled || busy} className={cn("space-y-1.5", className)}>
      {metas.length > 0 && (
        <ul className={cn(single ? "" : "space-y-1")}>
          {metas.map((m) => (
            <li key={m.id} className="flex min-w-0 items-center gap-2 rounded-md border border-surface-200 p-1 dark:border-surface-700">
              {single || m.mime.startsWith("image/") ? <ImageThumb meta={m} className={single ? "h-12 w-12" : "h-7 w-7"} /> : <FileIcon mime={m.mime} name={m.name} size="sm" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{m.name}</div>
                <div className="text-2xs text-surface-400">{formatBytes(m.size)}</div>
              </div>
              {!disabled && (
                <button type="button" aria-label={t("files.removeImage")} title={t("files.removeImage")} onClick={() => set(current.filter((x) => x !== m.id))} className="rounded p-1 text-surface-400 hover:bg-surface-100 hover:text-red-600 dark:hover:bg-surface-800">
                  {single ? <Trash2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="flex items-center gap-1.5">
          <FilePickerButton
            size="xs"
            variant="outline"
            accept={single ? "image/*" : undefined}
            multiple={!single}
            icon={single ? <ImagePlus /> : <Paperclip />}
            label={single ? (metas.length ? t("files.replaceImage") : t("files.uploadImage")) : t("files.addFiles")}
            disabled={busy}
            onFiles={(f) => void upload(f)}
          />
          {busy && <span className="text-2xs text-surface-400">{t("files.status.uploading")}</span>}
        </div>
      )}
    </FileDropZone>
  );
}
