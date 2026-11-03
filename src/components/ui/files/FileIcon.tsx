import { File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Presentation, type LucideIcon } from "lucide-react";
import { fileKind, type FileKind } from "../../../core/files";
import { cn } from "../../../shared/lib/utils";

const ICONS: Record<FileKind, LucideIcon> = {
  image: FileImage,
  pdf: FileText,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  archive: FileArchive,
  text: FileText,
  audio: FileAudio,
  video: FileVideo,
  other: File,
};

const TONES: Record<FileKind, string> = {
  image: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300",
  pdf: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300",
  document: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300",
  spreadsheet: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
  presentation: "bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-300",
  archive: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  text: "bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300",
  audio: "bg-pink-50 text-pink-600 dark:bg-pink-500/10 dark:text-pink-300",
  video: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300",
  other: "bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400",
};

export function FileIcon({ mime, name, size = "md", className }: { mime: string; name?: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const kind = fileKind(mime, name);
  const Icon = ICONS[kind];
  const dims = { sm: "h-6 w-6 [&>svg]:h-3.5 [&>svg]:w-3.5", md: "h-8 w-8 [&>svg]:h-4 [&>svg]:w-4", lg: "h-12 w-12 [&>svg]:h-6 [&>svg]:w-6" }[size];
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-md", dims, TONES[kind], className)} aria-hidden="true">
      <Icon />
    </span>
  );
}

// Short label of a file type ("PDF", "DOCX", "PNG").
export function fileTypeLabel(mime: string, name: string): string {
  const ext = /\.([A-Za-z0-9]{1,6})$/.exec(name)?.[1];
  if (ext) return ext.toUpperCase();
  return (mime.split("/")[1] ?? "file").split(/[.+;-]/).pop()!.toUpperCase().slice(0, 6);
}
