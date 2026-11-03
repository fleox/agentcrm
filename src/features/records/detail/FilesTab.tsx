// Record "Files" tab: every file of the record (attached to it, in its
// image / files fields) and, with the toggle, of its activities and its
// related records. Drop zone, grid / list, sort, search, preview
// (lightbox / new tab), download, delete (permission-aware).

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownUp, Download, ExternalLink, FolderOpen, LayoutGrid, List, Search, Trash2, Upload } from "lucide-react";
import { fileKind, formatBytes, isPreviewable } from "../../../core/files";
import type { Activity, CrmRecord, FileMeta, ObjectDef } from "../../../core/types";
import {
  Checkbox,
  confirmDialog,
  downloadStoredFile,
  EmptyState,
  FileDropZone,
  FileIcon,
  FilePickerButton,
  fileTypeLabel,
  ImageThumb,
  Lightbox,
  openStoredFile,
  PendingUploadList,
  Select,
  useFieldContext,
  useFilesBridge,
  usePendingUploads,
} from "../../../components/ui";
import { useCan, useCollection, useOps, useUsers } from "../../../app/CrmDataContext";
import { deleteFile, listFiles, type FileListItem } from "../../../ops/files";
import { toast } from "../../../shared/lib/toast";
import { cn, formatRelative } from "../../../shared/lib/utils";

type SortKey = "newest" | "oldest" | "name" | "size";

export function FilesTab({ record }: { record: CrmRecord; object: ObjectDef }) {
  const { t } = useTranslation("records");
  const ops = useOps();
  const ctx = useFieldContext();
  const bridge = useFilesBridge();
  const files = useCollection<FileMeta>("files");
  const activities = useCollection<Activity>("activities");
  const records = useCollection<CrmRecord>("records");
  const users = useUsers({ includeDisabled: true });
  const canWrite = useCan("records.write");
  const [related, setRelated] = useState(true);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<SortKey>("newest");
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const uploads = usePendingUploads({ targets: [{ kind: "record", object: record.object, id: record.id }] });

  const items = useMemo(() => {
    const list = listFiles(ops, record.id, { includeActivities: related, includeRelated: related, search: q });
    const by: Record<SortKey, (a: FileListItem, b: FileListItem) => number> = {
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => b.size - a.size,
    };
    return [...list].sort(by[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops, record.id, related, q, sort, files, activities, records]);
  const images = items.filter((f) => fileKind(f.mime, f.name) === "image");

  if (!bridge) return <EmptyState icon={<FolderOpen />} title={t("files.unavailable")} />;

  const viaLabel = (f: FileListItem): string | null => {
    if (f.via.kind === "record") return null;
    if (f.via.kind === "activity") {
      const a = activities.find((x) => x.id === f.via.id);
      return a ? t("files.onActivity", { title: a.title }) : null;
    }
    return t("files.fromRelated", { name: ctx.recordLabel(f.via.id) ?? f.via.id });
  };
  const remove = async (f: FileMeta) => {
    if (!(await confirmDialog({ title: t("files.deleteTitle", { name: f.name }), description: t("files.deleteHint"), danger: true, confirmLabel: t("files.delete") }))) return;
    try {
      await deleteFile(ops, f.id);
      toast.success(t("files.deleted", { name: f.name }));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  const open = (f: FileMeta) => {
    if (fileKind(f.mime, f.name) === "image") setPreview(f.id);
    else void (isPreviewable(f.mime) ? openStoredFile(bridge, f) : downloadStoredFile(bridge, f));
  };
  const author = (id?: string) => users.find((u) => u.id === id)?.name;
  const iconBtn = "inline-flex h-7 w-7 items-center justify-center rounded text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800 dark:hover:text-surface-100 [&>svg]:h-3.5 [&>svg]:w-3.5";

  const actions = (f: FileListItem) => (
    <span className="flex shrink-0 items-center">
      {isPreviewable(f.mime) && (
        <button type="button" className={iconBtn} title={t("files.open")} aria-label={t("files.open")} onClick={() => void openStoredFile(bridge, f)}>
          <ExternalLink />
        </button>
      )}
      <button type="button" className={iconBtn} title={t("files.download")} aria-label={t("files.download")} onClick={() => void downloadStoredFile(bridge, f)}>
        <Download />
      </button>
      {canWrite && (
        <button type="button" className={cn(iconBtn, "hover:text-red-600")} title={t("files.delete")} aria-label={t("files.delete")} onClick={() => void remove(f)}>
          <Trash2 />
        </button>
      )}
    </span>
  );

  return (
    <FileDropZone onFiles={(f) => void uploads.add(f)} disabled={!canWrite} className="space-y-3" testId="files-tab">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-8 min-w-[180px] flex-1 items-center gap-2 rounded-md border border-surface-200 bg-white px-2 dark:border-surface-700 dark:bg-surface-900">
          <Search className="h-3.5 w-3.5 text-surface-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("files.search")} aria-label={t("files.search")} className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-surface-400" />
        </div>
        <span className="inline-flex items-center gap-1 text-surface-400">
          <ArrowDownUp className="h-3.5 w-3.5" />
          <Select aria-label={t("files.sort")} className="h-8 w-32" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} options={(["newest", "oldest", "name", "size"] as SortKey[]).map((k) => ({ value: k, label: t(`files.sortBy.${k}`) }))} />
        </span>
        <div className="inline-flex rounded-md border border-surface-200 p-0.5 dark:border-surface-700" role="group" aria-label={t("files.layout")}>
          {(["grid", "list"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} title={t(`files.${v}`)} aria-label={t(`files.${v}`)} onClick={() => setView(v)} className={cn("inline-flex h-6 w-7 items-center justify-center rounded [&>svg]:h-3.5 [&>svg]:w-3.5", view === v ? "bg-surface-100 text-surface-900 dark:bg-surface-800 dark:text-white" : "text-surface-400 hover:text-surface-700")}>
              {v === "grid" ? <LayoutGrid /> : <List />}
            </button>
          ))}
        </div>
        {canWrite && <FilePickerButton size="sm" variant="outline" icon={<Upload />} label={t("files.upload")} onFiles={(f) => void uploads.add(f)} testId="files-tab-input" />}
      </div>
      <label className="flex items-center gap-1.5 text-xs text-surface-500">
        <Checkbox checked={related} onChange={(e) => setRelated(e.target.checked)} />
        {t("files.includeRelated")}
      </label>
      <PendingUploadList uploads={uploads} />

      {items.length === 0 ? (
        <div className={cn("rounded-lg border border-dashed border-surface-300 dark:border-surface-700")}>
          <EmptyState icon={<FolderOpen />} title={q ? t("files.noMatch") : t("files.empty")} description={canWrite ? t("files.emptyHint") : undefined} />
        </div>
      ) : view === "grid" ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4" data-testid="files-grid">
          {items.map((f) => {
            const image = fileKind(f.mime, f.name) === "image";
            const via = viaLabel(f);
            return (
              <li key={f.id} className="group/file overflow-hidden rounded-lg border border-surface-200 bg-white dark:border-surface-800 dark:bg-surface-900" data-file-id={f.id}>
                <button type="button" onClick={() => open(f)} className="flex aspect-[4/3] w-full items-center justify-center bg-surface-50 dark:bg-surface-800/60" aria-label={f.name}>
                  {image ? <ImageThumb meta={f} className="h-full w-full border-0" rounded="rounded-none" /> : <FileIcon mime={f.mime} name={f.name} size="lg" />}
                </button>
                <div className="flex items-start gap-1 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-surface-800 dark:text-surface-100" title={f.name}>
                      {f.name}
                    </div>
                    <div className="truncate text-2xs text-surface-400">
                      {fileTypeLabel(f.mime, f.name)} · {formatBytes(f.size, ctx.locale)}
                    </div>
                    {via && <div className="mt-0.5 truncate text-2xs text-accent-700 dark:text-accent-300" title={via}>{via}</div>}
                  </div>
                </div>
                <div className="flex justify-end border-t border-surface-100 px-1 py-0.5 opacity-70 group-hover/file:opacity-100 dark:border-surface-800">{actions(f)}</div>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="divide-y divide-surface-100 overflow-hidden rounded-lg border border-surface-200 bg-white dark:divide-surface-800 dark:border-surface-800 dark:bg-surface-900" data-testid="files-list">
          {items.map((f) => {
            const image = fileKind(f.mime, f.name) === "image";
            const via = viaLabel(f);
            return (
              <li key={f.id} className="flex items-center gap-3 px-2 py-1.5" data-file-id={f.id}>
                <button type="button" onClick={() => open(f)} className="shrink-0" aria-label={f.name}>
                  {image ? <ImageThumb meta={f} className="h-8 w-8" /> : <FileIcon mime={f.mime} name={f.name} />}
                </button>
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => open(f)} className="block max-w-full truncate text-left text-[13px] font-medium text-surface-800 hover:underline dark:text-surface-100">
                    {f.name}
                  </button>
                  <div className="truncate text-2xs text-surface-400">
                    {fileTypeLabel(f.mime, f.name)} · {formatBytes(f.size, ctx.locale)} · {formatRelative(f.createdAt, ctx.locale)}
                    {author(f.createdBy) ? ` · ${author(f.createdBy)}` : ""}
                    {via ? ` · ${via}` : ""}
                  </div>
                </div>
                {actions(f)}
              </li>
            );
          })}
        </ul>
      )}
      {preview && images.length > 0 && <Lightbox items={images} index={Math.max(0, images.findIndex((x) => x.id === preview))} onClose={() => setPreview(null)} />}
    </FileDropZone>
  );
}
