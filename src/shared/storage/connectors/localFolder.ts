import i18n from "../../../i18n";
import { toast } from "../../lib/toast";
import {
  createLocalFsTransport,
  ensureFolderPermission,
  loadFolderHandle,
  type GitTransport,
  type GitTreeEntry,
} from "../../git";
import type { StorageConnectorFactory } from "../registry";
import { StorageError, type ListItem, type StorageConnector } from "../types";

// Local-folder storage (File System Access API, Chromium only): files
// are written straight into a folder on this machine — a synced folder
// (Dropbox, iCloud, a NAS) for the journal backend, or a folder served by
// a local web server for hosting. The folder handle lives in IndexedDB
// under `handleKey` (default LOCAL_PUBLISH_HANDLE_KEY), picked in the
// setup wizard / Settings. Copied from cms-ia (see SHARED.md);
// listPrefix() and `handleKey` added.

export const LOCAL_PUBLISH_HANDLE_KEY = "publish-target";
export const LOCAL_DATA_HANDLE_KEY = "data-folder";

export interface LocalFolderSettings {
  // Where the folder is served, e.g. http://localhost:8080 (optional).
  siteUrl?: string;
  // IndexedDB key of the folder handle.
  handleKey?: string;
}

export function createLocalFolderConnector(settings: LocalFolderSettings): StorageConnector {
  const siteUrl = (settings.siteUrl ?? "").replace(/\/+$/, "");
  let transport: GitTransport | null = null;

  // Browsers drop the folder grant on reload; it can only be re-granted
  // from a click (Settings → "Reconnect folder").
  async function open(): Promise<GitTransport> {
    if (transport) return transport;
    const handle = await loadFolderHandle(settings.handleKey || LOCAL_PUBLISH_HANDLE_KEY);
    if (!handle || !(await ensureFolderPermission(handle, false))) {
      const message = i18n.t("storage.errors.folderAccess");
      toast.error(message);
      throw new StorageError(message, 403);
    }
    transport = createLocalFsTransport(handle);
    return transport;
  }

  async function entry(path: string): Promise<GitTreeEntry | undefined> {
    const tree = await (await open()).listTree();
    return tree.entries.find((e) => e.path === path.replace(/^\/+/, ""));
  }

  return {
    id: "local-folder",
    model: "files",
    capabilities: {
      list: true,
      rename: false,
      renameFolder: false,
      folders: false,
      deletePrefix: true,
    },

    async put(input) {
      await (await open()).commit([{ type: "put", ...input, path: input.path.replace(/^\/+/, "") }], { message: "" });
    },

    async get(path) {
      const e = await entry(path);
      const text = e ? (await (await open()).readTexts([e])).get(e.path) : undefined;
      if (text === undefined) throw new StorageError(`File not found: ${path}`, 404);
      return text;
    },

    async getBytes(path) {
      const e = await entry(path);
      return e ? (await open()).readBytes(e) : null;
    },

    async delete(path) {
      await (await open()).commit([{ type: "delete", path: path.replace(/^\/+/, "") }], { message: "" });
    },

    async deletePrefix(path) {
      const t = await open();
      const prefix = path.replace(/^\/+|\/+$/g, "") + "/";
      const doomed = (await t.listTree()).entries.filter((e) => e.path.startsWith(prefix));
      await t.commit(doomed.map((e) => ({ type: "delete" as const, path: e.path })), { message: "" });
    },

    async list(page, perPage) {
      const all: ListItem[] = (await (await open()).listTree()).entries.map((e) => ({
        path: e.path,
        type: "file" as const,
        size: e.size,
        url: siteUrl ? `${siteUrl}/${e.path}` : `/${e.path}`,
      }));
      return { items: all.slice((page - 1) * perPage, page * perPage), page, per_page: perPage, total: all.length };
    },

    async listPrefix(under) {
      const want = under.replace(/^\/+/, "");
      return (await (await open()).listTree()).entries.map((e) => e.path).filter((p) => p.startsWith(want));
    },

    async publicUrl(path) {
      const clean = path.replace(/^\/+/, "");
      return siteUrl ? `${siteUrl}/${clean}` : `/${clean}`;
    },
  };
}

export const localFolderFactory: StorageConnectorFactory<LocalFolderSettings> = {
  id: "local-folder",
  create: createLocalFolderConnector,
};
