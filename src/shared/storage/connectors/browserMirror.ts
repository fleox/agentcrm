import JSZip from "jszip";
import { base64ToBytes, base64ToUtf8 } from "../../git/encoding";
import { createKvStore } from "../kvStore";
import type { StorageConnectorFactory } from "../registry";
import { StorageError, type ListItem, type StorageConnector } from "../types";

// "Download as ZIP" target: files are kept in this browser (IndexedDB)
// and exported on demand as a ZIP the user uploads anywhere by hand —
// Netlify Drop, an FTP client, a USB stick… The universal fallback when
// no API-driven target fits. Copied from cms-ia (see SHARED.md);
// listPrefix() added.
//
// The mirror is per-browser: two machines produce two different mirrors.

export interface BrowserMirrorSettings {
  // Where the user intends to serve the site (used for absolute URLs).
  siteUrl?: string;
}

interface StoredFile {
  content: string;
  encoding: "utf-8" | "base64";
  updatedAt: number;
}

const mirror = createKvStore<StoredFile>("agentcrm-site-mirror", "files");

export async function exportMirrorZip(): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, file] of await mirror.entries()) {
    zip.file(path, file.encoding === "base64" ? base64ToBytes(file.content) : file.content);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export async function mirrorFileCount(): Promise<number> {
  return (await mirror.keys()).length;
}

export async function clearMirror(): Promise<void> {
  await mirror.clear();
}

export function createBrowserMirrorConnector(settings: BrowserMirrorSettings): StorageConnector {
  const siteUrl = (settings.siteUrl ?? "").replace(/\/+$/, "");
  const norm = (path: string) => path.replace(/^\/+/, "");

  return {
    id: "browser-mirror",
    model: "files",
    capabilities: {
      list: true,
      rename: false,
      renameFolder: false,
      folders: false,
      deletePrefix: true,
    },

    async put(input) {
      await mirror.set(norm(input.path), {
        content: input.content,
        encoding: input.encoding === "base64" ? "base64" : "utf-8",
        updatedAt: Date.now(),
      });
    },

    async get(path) {
      const file = await mirror.get(norm(path));
      if (!file) throw new StorageError(`File not found: ${path}`, 404);
      return file.encoding === "base64" ? base64ToUtf8(file.content) : file.content;
    },

    async getBytes(path) {
      const file = await mirror.get(norm(path));
      if (!file) return null;
      return file.encoding === "base64" ? base64ToBytes(file.content) : new TextEncoder().encode(file.content);
    },

    delete: (path) => mirror.delete(norm(path)),

    async deletePrefix(path) {
      const prefix = norm(path).replace(/\/+$/, "") + "/";
      for (const key of await mirror.keys()) if (key.startsWith(prefix)) await mirror.delete(key);
    },

    async list(page, perPage) {
      const all: ListItem[] = (await mirror.keys())
        .sort()
        .map((path) => ({ path, type: "file" as const, url: siteUrl ? `${siteUrl}/${path}` : `/${path}` }));
      return { items: all.slice((page - 1) * perPage, page * perPage), page, per_page: perPage, total: all.length };
    },

    async listPrefix(under) {
      const want = norm(under);
      return (await mirror.keys()).filter((k) => k.startsWith(want)).sort();
    },

    async publicUrl(path) {
      return siteUrl ? `${siteUrl}/${norm(path)}` : `/${norm(path)}`;
    },
  };
}

export const browserMirrorFactory: StorageConnectorFactory<BrowserMirrorSettings> = {
  id: "browser-mirror",
  create: createBrowserMirrorConnector,
};
