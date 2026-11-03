// Pure helpers about uploaded files (images & attachments): limits, MIME
// guessing, kinds (for icons), sizes, safe names. Shared by the ops, the
// CLI and the admin UI (which does the image resizing in the browser).

export const DEFAULT_MAX_UPLOAD_MB = 25;
// Client-side image processing (admin): longest side, quality, thumbnail.
export const IMAGE_MAX_DIMENSION = 2560;
export const IMAGE_QUALITY = 0.85;
export const THUMB_SIZE = 320;
// Suffix of a file's thumbnail blob id.
export const THUMB_SUFFIX = "_t";

export const thumbIdOf = (id: string) => `${id}${THUMB_SUFFIX}`;

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  heic: "image/heic",
  bmp: "image/bmp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
  zip: "application/zip",
  gz: "application/gzip",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  eml: "message/rfc822",
  ics: "text/calendar",
  vcf: "text/vcard",
};

export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

export function guessMime(name: string, given?: string | null): string {
  const g = (given ?? "").split(";")[0].trim().toLowerCase();
  if (g && g !== "application/octet-stream") return g;
  return MIME_BY_EXT[extensionOf(name)] ?? "application/octet-stream";
}

// Raster images the browser can display and resize (SVG is an image but
// never resized / opened as a page: it can carry scripts).
export function isImageMime(mime: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/.test(mime);
}

export function isResizableImage(mime: string): boolean {
  return /^image\/(png|jpe?g|webp|bmp|avif)$/.test(mime);
}

export type FileKind = "image" | "pdf" | "document" | "spreadsheet" | "presentation" | "archive" | "text" | "audio" | "video" | "other";

export function fileKind(mime: string, name = ""): FileKind {
  const m = guessMime(name, mime);
  if (isImageMime(m)) return "image";
  if (m === "application/pdf") return "pdf";
  if (/spreadsheet|excel|csv/.test(m)) return "spreadsheet";
  if (/presentation|powerpoint/.test(m)) return "presentation";
  if (/wordprocessing|msword|opendocument\.text|rtf/.test(m)) return "document";
  if (/zip|gzip|tar|compressed|7z|rar/.test(m)) return "archive";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("text/") || m === "application/json" || m === "message/rfc822") return "text";
  return "other";
}

// Files a browser can safely open in a new tab from a blob URL (no
// script-capable types: HTML / SVG are downloaded instead).
export function isPreviewable(mime: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(mime) || mime === "application/pdf" || mime === "text/plain" || mime.startsWith("video/") || mime.startsWith("audio/");
}

export function formatBytes(n: number, locale = "en-US"): string {
  if (!Number.isFinite(n) || n < 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 || v >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(v)} ${units[i]}`;
}

// File name safe to show and to download (no path, no control chars).
export function sanitizeFileName(name: string): string {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  return clean || "file";
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Markdown reference of an inline image (notes, tasks): ![name](file:<id>).
export function fileImageMarkdown(name: string, id: string): string {
  return `![${name.replace(/[[\]]/g, "")}](file:${id})`;
}

// File ids referenced inline by a markdown body.
export function inlineFileIds(markdown: string | undefined): string[] {
  const out: string[] = [];
  for (const m of (markdown ?? "").matchAll(/\]\(file:([A-Za-z0-9_-]{1,80})\)/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// Pixel size of a PNG / JPEG / GIF / WebP from its header (no decoding —
// used by the CLI, which uploads images as they are).
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const b = bytes;
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u32be = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { width: u32be(16), height: u32be(20) };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { width: u16le(6), height: u16le(8) };
  if (b.length > 30 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") {
    const kind = String.fromCharCode(...b.slice(12, 16));
    if (kind === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (kind === "VP8 ") return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (kind === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = u16be(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16be(i + 7), height: u16be(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}
