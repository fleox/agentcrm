// Demo images & attachments, drawn locally and deterministically (nothing
// downloaded): SVG avatars (colored geometric initials) for ~10 people,
// SVG logos for ~8 companies, a small PNG chart and a one-page PDF on a
// demo note. Pure TS (tiny PNG / PDF encoders below), so the CLI and the
// browser produce the very same bytes.

import { sha256Hex } from "../core/files";
import { seededId } from "../core/ids";
import type { Activity, CrmRecord, FileMeta } from "../core/types";
import type { DocMutation } from "../data/types";
import { asDoc } from "./store";
import type { OpsContext } from "./context";

const PALETTES: [string, string][] = [
  ["#6366f1", "#8b5cf6"],
  ["#0ea5e9", "#2563eb"],
  ["#10b981", "#0d9488"],
  ["#f59e0b", "#ea580c"],
  ["#ec4899", "#db2777"],
  ["#14b8a6", "#0891b2"],
  ["#8b5cf6", "#c026d3"],
  ["#f97316", "#dc2626"],
  ["#22c55e", "#65a30d"],
  ["#3b82f6", "#7c3aed"],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const SKIN = ["#f1c7a5", "#e0ac86", "#c68a62", "#a56b46", "#7d4f33", "#f5d6bf"];
const HAIR = ["#2b1d14", "#4a3020", "#8a5a2b", "#c9a25c", "#1f2937", "#6b7280", "#7c2d12"];
const SHIRT = ["#1e3a8a", "#065f46", "#7c3aed", "#be123c", "#0f766e", "#334155", "#b45309", "#0369a1"];

// 256×256 stylised portrait (gradient backdrop, shoulders, face, hair) —
// deterministic per name, clearly a "photo" next to the initials fallback.
export function demoAvatarSvg(name: string): string {
  const h = hash(name);
  const [a, b] = PALETTES[h % PALETTES.length];
  const skin = SKIN[(h >>> 3) % SKIN.length];
  const hair = HAIR[(h >>> 6) % HAIR.length];
  const shirt = SHIRT[(h >>> 9) % SHIRT.length];
  const style = (h >>> 12) % 3;
  const angle = (h >>> 4) % 360;
  const hairShape =
    style === 0
      ? `<path d="M78 118 C78 62 178 50 180 112 C168 92 120 86 92 104 Z" fill="${hair}"/>`
      : style === 1
        ? `<path d="M70 132 C60 52 196 46 188 132 L176 168 C178 120 168 96 128 92 C90 96 78 120 82 168 Z" fill="${hair}"/>`
        : `<path d="M84 104 C96 70 160 64 174 102 C150 90 112 90 84 104 Z" fill="${hair}"/><circle cx="128" cy="66" r="22" fill="${hair}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<defs><linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)"><stop offset="0" stop-color="${a}" stop-opacity=".55"/><stop offset="1" stop-color="${b}" stop-opacity=".85"/></linearGradient></defs>
<rect width="256" height="256" fill="#e2e8f0"/>
<rect width="256" height="256" fill="url(#g)"/>
<path d="M40 256 C44 196 84 172 128 172 C172 172 212 196 216 256 Z" fill="${shirt}"/>
<rect x="112" y="146" width="32" height="34" rx="12" fill="${skin}"/>
<path d="M104 176 L128 200 L152 176" fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="5" stroke-linecap="round"/>
<ellipse cx="128" cy="116" rx="46" ry="52" fill="${skin}"/>
${hairShape}
<circle cx="111" cy="120" r="4" fill="#1f2937" fill-opacity=".75"/><circle cx="145" cy="120" r="4" fill="#1f2937" fill-opacity=".75"/>
<path d="M114 142 Q128 152 142 142" fill="none" stroke="#7c2d12" stroke-opacity=".55" stroke-width="3.5" stroke-linecap="round"/>
</svg>
`;
}

// 256×256 company logo: a geometric mark + monogram on a tinted tile.
export function demoLogoSvg(name: string): string {
  const h = hash(`logo:${name}`);
  const [a, b] = PALETTES[h % PALETTES.length];
  const shape = h % 4;
  const letter = esc((name.trim()[0] ?? "?").toUpperCase());
  const mark =
    shape === 0
      ? `<circle cx="128" cy="128" r="84" fill="${a}"/><circle cx="160" cy="96" r="40" fill="${b}" fill-opacity=".9"/>`
      : shape === 1
        ? `<polygon points="128,36 220,196 36,196" fill="${a}"/><polygon points="128,92 176,176 80,176" fill="${b}"/>`
        : shape === 2
          ? `<polygon points="128,32 211,80 211,176 128,224 45,176 45,80" fill="${a}"/><polygon points="128,72 176,100 176,156 128,184 80,156 80,100" fill="${b}"/>`
          : `<rect x="44" y="44" width="168" height="168" rx="40" fill="${a}"/><rect x="92" y="92" width="120" height="120" rx="30" fill="${b}" fill-opacity=".85"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<rect width="256" height="256" rx="48" fill="#f8fafc"/>
${mark}
<text x="128" y="128" dy=".36em" text-anchor="middle" font-family="Inter, system-ui, -apple-system, Segoe UI, sans-serif" font-size="88" font-weight="800" fill="#ffffff">${letter}</text>
</svg>
`;
}

// ─── Minimal PNG encoder (indexed colour, stored deflate) ───────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function concat(parts: (Uint8Array | number[])[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const td = concat([new TextEncoder().encode(type), data]);
  return concat([u32(data.length), td, u32(crc32(td))]);
}

// zlib stream made of stored (uncompressed) deflate blocks.
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks: (Uint8Array | number[])[] = [[0x78, 0x01]];
  for (let i = 0; i < raw.length || i === 0; i += 65535) {
    const part = raw.subarray(i, Math.min(raw.length, i + 65535));
    const final = i + 65535 >= raw.length ? 1 : 0;
    blocks.push([final, part.length & 255, part.length >>> 8, ~part.length & 255, (~part.length >>> 8) & 255], part);
    if (final) break;
  }
  blocks.push(u32(adler32(raw)));
  return concat(blocks);
}

export function encodeIndexedPng(width: number, height: number, palette: [number, number, number][], pixel: (x: number, y: number) => number): Uint8Array {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = pixel(x, y);
  }
  const ihdr = concat([u32(width), u32(height), [8, 3, 0, 0, 0]]);
  const plte = new Uint8Array(palette.flat());
  return concat([[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], chunk("IHDR", ihdr), chunk("PLTE", plte), chunk("IDAT", zlibStored(raw)), chunk("IEND", new Uint8Array())]);
}

// 360×200 bar chart (pipeline by month), flat colours.
export function demoChartPng(): { bytes: Uint8Array; width: number; height: number } {
  const width = 360;
  const height = 200;
  const palette: [number, number, number][] = [
    [255, 255, 255], // 0 bg
    [226, 232, 240], // 1 grid
    [99, 102, 241], // 2 bar
    [16, 185, 129], // 3 highlight bar
    [148, 163, 184], // 4 axis
  ];
  const values = [42, 58, 51, 77, 69, 94, 88, 120];
  const max = 130;
  const left = 24;
  const bottom = height - 20;
  const bw = 28;
  const gap = (width - left - 16 - values.length * bw) / (values.length - 1);
  const bytes = encodeIndexedPng(width, height, palette, (x, y) => {
    if (y === bottom && x >= left - 4) return 4;
    if (x === left - 4 && y <= bottom && y > 10) return 4;
    for (let i = 0; i < values.length; i++) {
      const x0 = Math.round(left + i * (bw + gap));
      const top = Math.round(bottom - (values[i] / max) * (bottom - 16));
      if (x >= x0 && x < x0 + bw && y >= top && y < bottom) return i === values.length - 1 ? 3 : 2;
    }
    if (y < bottom && y > 10 && (bottom - y) % 40 === 0) return 1;
    return 0;
  });
  return { bytes, width, height };
}

// One-page PDF (Helvetica text), byte offsets computed for a valid xref.
export function demoPdf(title: string, lines: string[]): Uint8Array {
  const pdfText = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "?");
  const content = [
    "BT /F1 22 Tf 56 760 Td (" + pdfText(title) + ") Tj ET",
    ...lines.map((l, i) => `BT /F1 12 Tf 56 ${720 - i * 20} Td (${pdfText(l)}) Tj ET`),
    "0.39 0.4 0.95 RG 2 w 56 745 m 540 745 l S",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

export interface DemoFilesReport {
  files: number;
  avatars: number;
  logos: number;
  attachments: number;
}

// Writes the demo files (one blob batch + one data write). No-op when
// the backend has no FileStore or the files already exist.
export async function seedDemoFiles(ctx: OpsContext, data: { companies: CrmRecord[]; people: CrmRecord[]; activities: Activity[]; ownerId?: string }): Promise<DemoFilesReport> {
  const report: DemoFilesReport = { files: 0, avatars: 0, logos: 0, attachments: 0 };
  const files = ctx.store.files;
  if (!files) return report;
  const first = seededId("demo:file:avatar:0");
  if (ctx.store.get("files", first)) return report;
  const now = ctx.now();
  const blobs: { id: string; bytes: Uint8Array; meta: { name: string; mime: string } }[] = [];
  const metas: FileMeta[] = [];
  const mutations: DocMutation[] = [];
  const enc = new TextEncoder();
  const add = async (id: string, name: string, mime: string, bytes: Uint8Array, targets: FileMeta["targets"], dims?: { width: number; height: number }) => {
    blobs.push({ id, bytes, meta: { name, mime } });
    metas.push({ id, name, mime, size: bytes.length, ...(dims ?? {}), sha256: await sha256Hex(bytes), createdAt: now, updatedAt: now, ...(data.ownerId ? { createdBy: data.ownerId } : {}), targets });
  };
  const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  for (const [i, p] of data.people.slice(0, 10).entries()) {
    const id = seededId(`demo:file:avatar:${i}`);
    const name = String(p.fields.name ?? "Person");
    await add(id, `${slug(name)}.svg`, "image/svg+xml", enc.encode(demoAvatarSvg(name)), [{ kind: "record", object: "people", id: p.id }], { width: 256, height: 256 });
    mutations.push({ op: "patch", collection: "records", id: p.id, fields: { "fields.avatar": id } });
    report.avatars++;
  }
  for (const [i, c] of data.companies.slice(0, 8).entries()) {
    const id = seededId(`demo:file:logo:${i}`);
    const name = String(c.fields.name ?? "Company");
    await add(id, `${slug(name)}-logo.svg`, "image/svg+xml", enc.encode(demoLogoSvg(name)), [{ kind: "record", object: "companies", id: c.id }], { width: 256, height: 256 });
    mutations.push({ op: "patch", collection: "records", id: c.id, fields: { "fields.logo": id } });
    report.logos++;
  }
  // A note with a chart (inline + attached) and a proposal PDF.
  const note = data.activities.find((a) => a.type === "note");
  if (note) {
    const chart = demoChartPng();
    const chartId = seededId("demo:file:chart");
    const pdfId = seededId("demo:file:pdf");
    await add(chartId, "pipeline-chart.png", "image/png", chart.bytes, [{ kind: "activity", id: note.id }], { width: chart.width, height: chart.height });
    const pdf = demoPdf("Proposal — Annual plan", ["Prepared for the demo workspace.", "Scope: onboarding, annual license, support.", "Total: 24,000 USD / year.", "Valid 30 days."]);
    await add(pdfId, "proposal.pdf", "application/pdf", pdf, [{ kind: "activity", id: note.id }]);
    const body = `${note.body ?? ""}\n\nPipeline trend this quarter:\n\n![pipeline-chart.png](file:${chartId})`.trim();
    mutations.push({ op: "patch", collection: "activities", id: note.id, fields: { attachments: [chartId, pdfId], body } });
    report.attachments += 2;
  }
  if (files.putMany) await files.putMany(blobs);
  else for (const b of blobs) await files.put(b.id, b.bytes, b.meta);
  await ctx.store.write([...metas.map((m) => ({ op: "set" as const, collection: "files" as const, doc: asDoc(m) })), ...mutations], { message: "Add demo files" });
  report.files = metas.length;
  return report;
}
