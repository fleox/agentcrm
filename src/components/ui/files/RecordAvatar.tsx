import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "../Display";
import { Button } from "../Button";
import { Modal } from "../Overlay";
import { useFieldContext } from "../fieldContext";
import { useFileUrl } from "./fileUrls";
import { cropToSquare, decodeImage, squareCropRect, type SquareCrop } from "./imageProcessing";
import type { PreparedUpload } from "./context";

type Size = "xs" | "sm" | "md" | "lg";

// Avatar showing a stored image (thumbnail) with the initials fallback.
export function FileAvatar({ fileId, name, size = "md", square, className }: { fileId?: string | null; name: string; size?: Size; square?: boolean; className?: string }) {
  const { url } = useFileUrl(fileId ?? null, { thumb: true });
  return <Avatar name={name} src={url ?? undefined} size={size} square={square} className={className} />;
}

// A record's avatar / logo: its object's image field (FieldContext), else initials.
export function RecordAvatar({ recordId, name, size = "md", square, className, imageId }: { recordId?: string; name: string; size?: Size; square?: boolean; className?: string; imageId?: string }) {
  const ctx = useFieldContext();
  const id = imageId ?? (recordId ? ctx.recordImage?.(recordId) : undefined);
  return <FileAvatar fileId={id} name={name} size={size} square={square} className={className} />;
}

// Square crop (centred, zoom slider, drag to pan) before saving an avatar.
export function ImageCropModal({ file, open, onClose, onConfirm, round = true, title }: { file: File | null; open: boolean; onClose(): void; onConfirm(prepared: PreparedUpload): void | Promise<void>; round?: boolean; title?: string }) {
  const { t } = useTranslation();
  const [crop, setCrop] = useState<SquareCrop>({ zoom: 1, x: 0, y: 0 });
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; crop: SquareCrop } | null>(null);
  const BOX = 240;

  useEffect(() => {
    setCrop({ zoom: 1, x: 0, y: 0 });
    setError(null);
    setDims(null);
    if (!file || !open) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    let alive = true;
    decodeImage(file)
      .then((d) => {
        if (alive) setDims({ w: d.width, h: d.height });
        d.close();
      })
      .catch(() => alive && setError(t("files.notAnImage")));
    return () => {
      alive = false;
      URL.revokeObjectURL(u);
    };
  }, [file, open, t]);

  const rect = dims ? squareCropRect(dims.w, dims.h, crop) : null;
  const scale = rect ? BOX / rect.sw : 1;

  const confirm = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await onConfirm(await cropToSquare(file, crop, { name: file.name }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title ?? t("files.cropTitle")}
      dismissible={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} disabled={!dims} onClick={() => void confirm()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3" data-testid="crop-modal">
        <div
          className="relative cursor-grab touch-none overflow-hidden rounded-lg bg-surface-100 active:cursor-grabbing dark:bg-surface-800"
          style={{ width: BOX, height: BOX }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, crop };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || !dims || !rect) return;
            const maxX = (dims.w - rect.sw) / 2;
            const maxY = (dims.h - rect.sh) / 2;
            const dx = ((e.clientX - d.x) / scale) / (maxX || 1);
            const dy = ((e.clientY - d.y) / scale) / (maxY || 1);
            setCrop({ ...d.crop, x: Math.max(-1, Math.min(1, d.crop.x - dx)), y: Math.max(-1, Math.min(1, d.crop.y - dy)) });
          }}
          onPointerUp={() => (drag.current = null)}
        >
          {url && dims && rect && (
            <img
              src={url}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none select-none"
              style={{ width: dims.w * scale, height: dims.h * scale, left: -rect.sx * scale, top: -rect.sy * scale }}
            />
          )}
          <div className={`pointer-events-none absolute inset-0 ring-[999px] ring-black/35 ${round ? "rounded-full" : "rounded-lg"}`} style={{ margin: 0 }} aria-hidden="true" />
        </div>
        <label className="flex w-full items-center gap-2 text-xs text-surface-500">
          <span>{t("files.zoom")}</span>
          <input type="range" min={1} max={4} step={0.01} value={crop.zoom} onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))} className="flex-1 accent-[rgb(var(--acc-600))]" aria-label={t("files.zoom")} />
        </label>
        <p className="text-2xs text-surface-400">{t("files.cropHint")}</p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
