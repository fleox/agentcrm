import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Download, ExternalLink, X } from "lucide-react";
import { formatBytes, isPreviewable } from "../../../core/files";
import type { FileMeta } from "../../../core/types";
import { cn } from "../../../shared/lib/utils";
import { Portal, useEscape } from "../Overlay";
import { Spinner } from "../Display";
import { useFilesBridge } from "./context";
import { useFileUrl } from "./fileUrls";
import { downloadStoredFile, openStoredFile } from "./actions";

// Full-screen image viewer: ←/→ navigate, Esc closes, download / open.
export function Lightbox({ items, index: initial, onClose }: { items: FileMeta[]; index: number; onClose(): void }) {
  const { t } = useTranslation();
  const bridge = useFilesBridge();
  const [index, setIndex] = useState(Math.min(Math.max(0, initial), items.length - 1));
  const item = items[index];
  const { url, loading, error } = useFileUrl(item?.id);
  useEscape(true, onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % items.length);
      else if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + items.length) % items.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length]);
  if (!item) return null;
  const btn = "inline-flex h-9 w-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white [&>svg]:h-5 [&>svg]:w-5";
  return (
    <Portal>
      <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 animate-fade-in" role="dialog" aria-modal="true" aria-label={item.name} data-testid="lightbox">
        <div className="flex h-14 shrink-0 items-center gap-3 px-4 text-white">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{item.name}</div>
            <div className="text-xs text-white/60">
              {items.length > 1 && <span>{t("files.counter", { index: index + 1, total: items.length })} · </span>}
              {formatBytes(item.size)}
              {item.width && item.height ? ` · ${item.width}×${item.height}` : ""}
            </div>
          </div>
          {bridge && (
            <button type="button" className={btn} title={t("files.download")} aria-label={t("files.download")} onClick={() => void downloadStoredFile(bridge, item)}>
              <Download />
            </button>
          )}
          {bridge && isPreviewable(item.mime) && (
            <button type="button" className={btn} title={t("files.openNewTab")} aria-label={t("files.openNewTab")} onClick={() => void openStoredFile(bridge, item)}>
              <ExternalLink />
            </button>
          )}
          <button type="button" className={btn} title={t("common.close")} aria-label={t("common.close")} onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-6" onClick={onClose}>
          {loading && <Spinner size="lg" className="text-white/70" />}
          {error && <p className="text-sm text-white/70">{t("files.loadError")}</p>}
          {url && <img src={url} alt={item.name} className="max-h-full max-w-full select-none rounded object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />}
          {items.length > 1 && (
            <>
              <button type="button" aria-label={t("files.previous")} className={cn(btn, "absolute left-3 top-1/2 -translate-y-1/2 bg-white/5")} onClick={(e) => (e.stopPropagation(), setIndex((i) => (i - 1 + items.length) % items.length))}>
                <ChevronLeft />
              </button>
              <button type="button" aria-label={t("files.next")} className={cn(btn, "absolute right-3 top-1/2 -translate-y-1/2 bg-white/5")} onClick={(e) => (e.stopPropagation(), setIndex((i) => (i + 1) % items.length))}>
                <ChevronRight />
              </button>
            </>
          )}
        </div>
      </div>
    </Portal>
  );
}
