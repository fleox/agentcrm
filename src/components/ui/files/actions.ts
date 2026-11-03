// Download / open-in-a-new-tab of stored files (blob URLs, revoked later).

import { isPreviewable } from "../../../core/files";
import type { FileMeta } from "../../../core/types";
import { toast } from "../../../shared/lib/toast";
import { downloadBlob } from "../download";
import type { FilesBridge } from "./context";

export async function downloadStoredFile(bridge: FilesBridge, meta: FileMeta): Promise<void> {
  try {
    downloadBlob(meta.name, await bridge.load(meta.id));
  } catch (err) {
    toast.error((err as Error).message);
  }
}

// PDFs / images / text open in a new tab; script-capable types (HTML,
// SVG) and the rest are downloaded instead.
export async function openStoredFile(bridge: FilesBridge, meta: FileMeta): Promise<void> {
  if (!isPreviewable(meta.mime)) return downloadStoredFile(bridge, meta);
  // Open the tab synchronously (popup blockers), then point it at the blob.
  const tab = typeof window !== "undefined" ? window.open("", "_blank") : null;
  try {
    const blob = await bridge.load(meta.id);
    const url = URL.createObjectURL(blob);
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.open(url, "_blank", "noopener");
    }
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (err) {
    tab?.close();
    toast.error((err as Error).message);
  }
}
