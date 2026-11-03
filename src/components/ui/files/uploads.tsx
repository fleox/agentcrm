// Upload flows shared by the composer, the task editor, the Files tab and
// the file fields: drag & drop zone, paste from the clipboard, a picker
// button, and pending uploads with progress / remove-before-saving.

import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Check, ImagePlus, Paperclip, X } from "lucide-react";
import { fileKind, formatBytes } from "../../../core/files";
import type { FileMeta, FileTarget } from "../../../core/types";
import { toast } from "../../../shared/lib/toast";
import { cn } from "../../../shared/lib/utils";
import { Button } from "../Button";
import { Spinner } from "../Display";
import { useFilesBridge } from "./context";
import { ImageThumb } from "./Attachments";
import { FileIcon } from "./FileIcon";

export function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  if (dt.items?.length) {
    for (const it of dt.items) if (it.kind === "file") {
      const f = it.getAsFile();
      if (f) out.push(f);
    }
  } else for (const f of dt.files ?? []) out.push(f);
  return out;
}

export function hasFiles(e: DragEvent): boolean {
  return [...(e.dataTransfer?.types ?? [])].includes("Files");
}

// Wraps children; dropping files calls onFiles. Shows an overlay while dragging.
export function FileDropZone({ onFiles, disabled, children, className, label, testId }: { onFiles(files: File[]): void; disabled?: boolean; children: ReactNode; className?: string; label?: string; testId?: string }) {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  return (
    <div
      className={cn("relative", className)}
      data-testid={testId}
      onDragEnter={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        if (disabled) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDrop={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        depth.current = 0;
        setOver(false);
        const files = filesFromDataTransfer(e.dataTransfer);
        if (files.length) onFiles(files);
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-accent-500 bg-accent-50/80 text-sm font-medium text-accent-700 dark:bg-accent-500/10 dark:text-accent-200">
          {label ?? t("files.dropHere")}
        </div>
      )}
    </div>
  );
}

// onPaste handler collecting pasted files (screenshots, copied files).
export function pastedFiles(e: ClipboardEvent): File[] {
  const files = filesFromDataTransfer(e.clipboardData);
  return files.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `pasted-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}${i ? `-${i}` : ""}.${(f.type.split("/")[1] ?? "png").replace("jpeg", "jpg")}`, { type: f.type })));
}

// Hidden <input type=file> + button.
export function FilePickerButton({ onFiles, accept, multiple = true, disabled, label, icon, size = "xs", variant = "ghost", testId }: { onFiles(files: File[]): void; accept?: string; multiple?: boolean; disabled?: boolean; label?: string; icon?: ReactNode; size?: "xs" | "sm" | "md"; variant?: "ghost" | "outline" | "secondary"; testId?: string }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        data-testid={testId}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <Button size={size} variant={variant} icon={icon ?? <Paperclip />} disabled={disabled} onClick={() => input.current?.click()}>
        {label ?? t("files.attach")}
      </Button>
    </>
  );
}

export interface PendingUpload {
  key: string;
  name: string;
  size: number;
  image: boolean;
  status: "processing" | "uploading" | "done" | "error";
  // 0–1 (staged: processing / uploading / stored).
  progress: number;
  file?: FileMeta;
  error?: string;
}

// Files uploaded right away (so the user sees progress) and attached on
// save; removing one before saving soft-deletes it.
export function usePendingUploads(opts: { targets?: (FileTarget | string)[] } = {}) {
  const bridge = useFilesBridge();
  const [items, setItems] = useState<PendingUpload[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const patch = (key: string, p: Partial<PendingUpload>) => alive.current && setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const add = useCallback(
    async (files: File[]): Promise<FileMeta[]> => {
      if (!bridge) return [];
      const out: FileMeta[] = [];
      const fresh = files.map((f, i) => ({ f, key: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}` }));
      setItems((xs) => [...xs, ...fresh.map(({ f, key }) => ({ key, name: f.name || "file", size: f.size, image: fileKind(f.type, f.name) === "image", status: "processing" as const, progress: 0.15 }))]);
      for (const { f, key } of fresh) {
        if (f.size > bridge.maxUploadBytes && fileKind(f.type, f.name) !== "image") {
          const error = `${f.name}: ${formatBytes(f.size)} > ${formatBytes(bridge.maxUploadBytes)}`;
          patch(key, { status: "error", error, progress: 1 });
          toast.error(error);
          continue;
        }
        try {
          patch(key, { status: "uploading", progress: 0.55 });
          const meta = await bridge.upload(f, { targets: opts.targets });
          out.push(meta);
          patch(key, { status: "done", progress: 1, file: meta, name: meta.name, size: meta.size });
        } catch (err) {
          const error = (err as Error).message;
          patch(key, { status: "error", error, progress: 1 });
          toast.error(error);
        }
      }
      return out;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bridge, JSON.stringify(opts.targets ?? [])],
  );

  const remove = useCallback(
    async (key: string) => {
      const it = items.find((x) => x.key === key);
      setItems((xs) => xs.filter((x) => x.key !== key));
      if (it?.file && bridge) await bridge.remove(it.file.id).catch(() => undefined);
    },
    [items, bridge],
  );

  const reset = useCallback(() => setItems([]), []);
  const ids = items.filter((x) => x.status === "done" && x.file).map((x) => x.file!.id);
  const busy = items.some((x) => x.status === "processing" || x.status === "uploading");
  return { items, add, remove, reset, ids, busy, available: !!bridge };
}

export type PendingUploads = ReturnType<typeof usePendingUploads>;

// Chips of pending uploads with a progress bar; images can be inserted inline.
export function PendingUploadList({ uploads, onInsertInline, className }: { uploads: PendingUploads; onInsertInline?(file: FileMeta): void; className?: string }) {
  const { t } = useTranslation();
  if (!uploads.items.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} data-testid="pending-uploads">
      {uploads.items.map((it) => (
        <li key={it.key} className={cn("relative flex max-w-[240px] items-center gap-2 overflow-hidden rounded-md border bg-white py-1 pl-1 pr-1 text-xs dark:bg-surface-900", it.status === "error" ? "border-red-300 dark:border-red-500/40" : "border-surface-200 dark:border-surface-700")}>
          {it.file && it.image ? <ImageThumb meta={it.file} className="h-8 w-8" /> : <FileIcon mime={it.file?.mime ?? ""} name={it.name} />}
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-surface-800 dark:text-surface-100" title={it.name}>
              {it.name}
            </div>
            <div className="flex items-center gap-1 text-2xs text-surface-400">
              {it.status === "processing" && <Spinner size="sm" className="h-3 w-3" />}
              {it.status === "uploading" && <Spinner size="sm" className="h-3 w-3" />}
              {it.status === "done" && <Check className="h-3 w-3 text-emerald-600" />}
              {it.status === "error" && <AlertCircle className="h-3 w-3 text-red-600" />}
              <span className="truncate">{it.status === "error" ? (it.error ?? t("files.failed")) : it.status === "done" ? formatBytes(it.size) : t(`files.status.${it.status}`)}</span>
            </div>
          </div>
          {it.status === "done" && it.image && it.file && onInsertInline && (
            <button type="button" title={t("files.insertInline")} aria-label={t("files.insertInline")} onClick={() => onInsertInline(it.file!)} className="rounded p-0.5 text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800">
              <ImagePlus className="h-3.5 w-3.5" />
            </button>
          )}
          <button type="button" title={t("files.removeUpload")} aria-label={t("files.removeUpload")} disabled={it.status === "processing" || it.status === "uploading"} onClick={() => void uploads.remove(it.key)} className="rounded p-0.5 text-surface-400 hover:bg-surface-100 hover:text-surface-700 disabled:opacity-40 dark:hover:bg-surface-800">
            <X className="h-3.5 w-3.5" />
          </button>
          {it.status !== "done" && it.status !== "error" && (
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-surface-100 dark:bg-surface-800" aria-hidden="true">
              <span className="block h-full bg-accent-500 transition-all duration-500" style={{ width: `${Math.round(it.progress * 100)}%` }} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
