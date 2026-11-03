// Client-side image processing before upload (browser only, no deps):
// big photos are scaled down to IMAGE_MAX_DIMENSION and re-encoded
// (WebP, JPEG where the browser can't encode WebP) at IMAGE_QUALITY, and
// every raster image gets a THUMB_SIZE WebP thumbnail. GIFs (animation)
// and SVGs (vector) are kept as they are; documents are never touched.
// createImageBitmap + OffscreenCanvas when available, <canvas> otherwise.

import { guessMime, IMAGE_MAX_DIMENSION, IMAGE_QUALITY, isResizableImage, sanitizeFileName, THUMB_SIZE } from "../../../core/files";
import type { PreparedUpload } from "./context";

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

async function toBlob(canvas: AnyCanvas, type: string, quality: number): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => (canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error("Image encoding failed."))), type, quality));
}

// WebP when the browser encodes it (Safari < 17 silently returns PNG).
async function encode(canvas: AnyCanvas, quality: number, preferAlpha: boolean): Promise<Blob> {
  const webp = await toBlob(canvas, "image/webp", quality);
  if (webp.type === "image/webp") return webp;
  return toBlob(canvas, preferAlpha ? "image/png" : "image/jpeg", quality);
}

export interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

export async function decodeImage(blob: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(blob);
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function draw(src: Decoded, w: number, h: number, crop?: { sx: number; sy: number; sw: number; sh: number }): AnyCanvas {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("Canvas 2D is not available.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (crop) ctx.drawImage(src.source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
  else ctx.drawImage(src.source, 0, 0, w, h);
  return canvas;
}

function fit(w: number, h: number, max: number): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

function renamed(name: string, mime: string): string {
  const ext = mime === "image/webp" ? "webp" : mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "";
  return ext ? name.replace(/\.[A-Za-z0-9]{1,8}$/, "") + `.${ext}` : name;
}

export async function makeThumbnail(src: Decoded): Promise<PreparedUpload["thumbnail"]> {
  const { w, h } = fit(src.width, src.height, THUMB_SIZE);
  const blob = await encode(draw(src, w, h), 0.8, true);
  return { bytes: await bytesOf(blob), mime: blob.type, width: w, height: h };
}

// Bytes ready for ops/files.uploadFile.
export async function prepareUpload(file: Blob, opts: { name?: string; keepOriginal?: boolean; maxDimension?: number; quality?: number } = {}): Promise<PreparedUpload> {
  const name = sanitizeFileName(opts.name ?? (file as File).name ?? "file");
  const mime = guessMime(name, file.type);
  const original = async (): Promise<PreparedUpload> => ({ name, mime, bytes: await bytesOf(file) });
  if (!isResizableImage(mime) || (typeof document === "undefined" && typeof OffscreenCanvas === "undefined")) {
    if (mime === "image/gif") {
      // Thumbnail of the first frame; the GIF itself stays animated.
      try {
        const src = await decodeImage(file);
        try {
          return { ...(await original()), width: src.width, height: src.height, thumbnail: await makeThumbnail(src) };
        } finally {
          src.close();
        }
      } catch {
        return original();
      }
    }
    return original();
  }
  let src: Decoded;
  try {
    src = await decodeImage(file);
  } catch {
    // Not decodable here (HEIC, broken file…): upload as is.
    return original();
  }
  try {
    const max = opts.maxDimension ?? IMAGE_MAX_DIMENSION;
    const thumbnail = await makeThumbnail(src);
    const small = Math.max(src.width, src.height) <= max;
    if (opts.keepOriginal || (small && file.size <= 1.5 * 1024 * 1024)) {
      return { ...(await original()), width: src.width, height: src.height, thumbnail };
    }
    const { w, h } = fit(src.width, src.height, max);
    const blob = await encode(draw(src, w, h), opts.quality ?? IMAGE_QUALITY, mime === "image/png");
    // Re-encoding a small PNG can make it bigger: keep the smaller.
    if (small && blob.size >= file.size) return { ...(await original()), width: src.width, height: src.height, thumbnail };
    return { name: renamed(name, blob.type), mime: blob.type, bytes: await bytesOf(blob), width: w, height: h, thumbnail };
  } finally {
    src.close();
  }
}

// Square crop for avatars / logos: `zoom` ≥ 1 (1 = the largest centred
// square), `x` / `y` in −1…1 pan the crop inside the image.
export interface SquareCrop {
  zoom: number;
  x: number;
  y: number;
}

export function squareCropRect(width: number, height: number, crop: SquareCrop): { sx: number; sy: number; sw: number; sh: number } {
  const side = Math.min(width, height) / Math.max(1, crop.zoom);
  const maxX = (width - side) / 2;
  const maxY = (height - side) / 2;
  const cx = width / 2 + Math.max(-1, Math.min(1, crop.x)) * maxX;
  const cy = height / 2 + Math.max(-1, Math.min(1, crop.y)) * maxY;
  return { sx: cx - side / 2, sy: cy - side / 2, sw: side, sh: side };
}

export async function cropToSquare(file: Blob, crop: SquareCrop, opts: { name?: string; size?: number } = {}): Promise<PreparedUpload> {
  const name = sanitizeFileName(opts.name ?? (file as File).name ?? "image");
  const src = await decodeImage(file);
  try {
    const rect = squareCropRect(src.width, src.height, crop);
    const size = Math.max(64, Math.min(opts.size ?? 512, Math.round(rect.sw)));
    const blob = await encode(draw(src, size, size, rect), IMAGE_QUALITY, true);
    const tsize = Math.min(THUMB_SIZE, size);
    const thumbBlob = await encode(draw(src, tsize, tsize, rect), 0.8, true);
    return {
      name: renamed(name, blob.type),
      mime: blob.type,
      bytes: await bytesOf(blob),
      width: size,
      height: size,
      thumbnail: { bytes: await bytesOf(thumbBlob), mime: thumbBlob.type, width: tsize, height: tsize },
    };
  } finally {
    src.close();
  }
}
