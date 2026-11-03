import { createContext, useContext } from "react";
import type { FileMeta, FileTarget } from "../../../core/types";

// What the file components need from the data layer (provided by
// app/CrmDataContext, so the UI kit never imports the app / ops).
export interface PreparedUpload {
  name: string;
  mime: string;
  bytes: Uint8Array;
  width?: number;
  height?: number;
  thumbnail?: { bytes: Uint8Array; mime: string; width?: number; height?: number };
}

export interface UploadOptions {
  targets?: (FileTarget | string)[];
  // Documents keep their bytes; images are resized unless true.
  keepOriginal?: boolean;
  // Already processed (e.g. a cropped avatar).
  prepared?: PreparedUpload;
}

export interface FilesBridge {
  // Live metadata (undefined while unknown / deleted).
  meta(id: string): FileMeta | undefined;
  // Bytes as a Blob (typed with the file's MIME). thumb → the thumbnail when there is one.
  load(id: string, opts?: { thumb?: boolean }): Promise<Blob>;
  upload(file: File | Blob, opts?: UploadOptions & { name?: string }): Promise<FileMeta>;
  remove(id: string): Promise<void>;
  canWrite: boolean;
  canDelete: boolean;
  maxUploadBytes: number;
  // Distinguishes datasets in the URL cache.
  key: string;
}

export const FilesContext = createContext<FilesBridge | null>(null);

export function useFilesBridge(): FilesBridge | null {
  return useContext(FilesContext);
}
