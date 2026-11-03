// What a browser still needs before it can open a journal dataset: the
// connector's secret settings (S3 keys, git token) — entered once per
// browser on the access page — or, for a local folder, a fresh grant of
// the folder permission (browsers drop it on reload; re-granting needs a
// click). The data factory (../index.ts) turns "something missing" into
// identity() === null, which shows the access screen (loginScreen slot)
// instead of failing on the first request.

import { ensureFolderPermission, loadFolderHandle } from "../../shared/git";

// Secret settings each connector needs (never in config.js).
export const CONNECTOR_SECRET_FIELDS: Record<string, string[]> = {
  s3: ["accessKeyId", "secretAccessKey"],
  "git-pages": ["token"],
  "local-folder": [],
  "browser-mirror": [],
};

const LOCAL_DATA_HANDLE_KEY = "data-folder";

export async function missingJournalAccess(connectorId: string, settings: Record<string, unknown>): Promise<string[]> {
  const missing = (CONNECTOR_SECRET_FIELDS[connectorId] ?? []).filter((k) => typeof settings[k] !== "string" || !(settings[k] as string).trim());
  if (connectorId === "local-folder") {
    if (typeof indexedDB === "undefined") return missing;
    const handle = await loadFolderHandle(typeof settings.handleKey === "string" && settings.handleKey ? settings.handleKey : LOCAL_DATA_HANDLE_KEY);
    if (!handle || !(await ensureFolderPermission(handle, false).catch(() => false))) missing.push("folder");
  }
  return missing;
}
