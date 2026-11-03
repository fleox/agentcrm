// Hosting the admin itself (mirror of cms-ia src/services/adminDeploy.ts).
// A browser can't list the folder it was served from, so the build writes
// admin-files.json (scripts/write-admin-manifest.mjs); the running admin
// fetches each listed file and copies it — plus a config.js describing
// the data backend — onto a hosting target (GitHub / GitLab / Cloudflare
// Pages, S3 static website, local folder), or packs them as a ZIP.
//
// config.js never holds secrets (tokens / keys / passphrases stay in each
// browser), so publishing it next to the admin is safe. The DATA must
// never live on the same public bucket: see docs/hosting.md.

import JSZip from "jszip";
import { buildConfigJsSource, type RuntimeConfig } from "../../../lib/runtimeConfig";
import { bytesToBase64 } from "../../../shared/git/encoding";
import { uploadFile, withStorageBatch } from "../../../shared/siteFiles";
import { setStorageConfigSource, type StorageConfig } from "../../../shared/storage/registry";

export const DEFAULT_ADMIN_FOLDER = "admin";
export const ADMIN_MANIFEST = "admin-files.json";

export interface AdminManifest {
  version: string;
  dataSchema?: number;
  files: string[];
}

export function cleanFolder(folder: string): string {
  return folder.trim().replace(/^\/+|\/+$/g, "");
}

export function adminUrlOn(settings: Record<string, unknown>, folder: string): string | null {
  const siteUrl = typeof settings.siteUrl === "string" ? settings.siteUrl.trim().replace(/\/+$/, "") : "";
  if (!siteUrl) return null;
  const dir = cleanFolder(folder);
  return dir ? `${siteUrl}/${dir}/` : `${siteUrl}/`;
}

// Self-hosting needs the build manifest — missing under `npm run dev`.
export async function readAdminManifest(): Promise<AdminManifest | null> {
  try {
    const res = await fetch(new URL(ADMIN_MANIFEST, document.baseURI).href, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as AdminManifest;
    return Array.isArray(data.files) ? data : null;
  } catch {
    return null;
  }
}

// Fresh copy of an admin file — the query string defeats caches that
// ignore `cache: "no-store"`.
async function fetchAdminFile(file: string, bust: string): Promise<Uint8Array> {
  const url = new URL(file, document.baseURI);
  url.searchParams.set("v", bust);
  const res = await fetch(url.href, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not read admin file ${file} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

// Every ./assets/… file index.html loads must be in the manifest; else
// index.html and the manifest come from different builds (stale tab).
export function missingIndexReferences(indexHtml: string, files: string[]): string[] {
  const known = new Set([...files, "config.js", ADMIN_MANIFEST]);
  const refs = [...indexHtml.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g)].map((m) => m[1]);
  return refs.filter((ref) => !known.has(ref));
}

async function loadBuild(bust: string): Promise<{ manifest: AdminManifest; indexBytes: Uint8Array }> {
  const manifest = await readAdminManifest();
  if (!manifest) throw new Error("admin-files.json not found — deploy from a built admin (npm run build / preview), not npm run dev.");
  const indexBytes = await fetchAdminFile("index.html", bust);
  const missing = missingIndexReferences(new TextDecoder().decode(indexBytes), manifest.files);
  if (missing.length) throw new Error(`This admin's files don't match its build (${missing.join(", ")}). Reload this page (Cmd/Ctrl + Shift + R) and try again.`);
  return { manifest, indexBytes };
}

// Copies every admin file + config.js into `folder` of `target`, as one
// batch (one commit on git targets). index.html goes last so a deploy cut
// halfway never serves an index pointing at missing bundles.
export async function deployAdmin(
  target: StorageConfig,
  folder: string,
  runtime: RuntimeConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<{ files: number; version: string; url: string | null }> {
  const bust = String(Date.now());
  const { manifest, indexBytes } = await loadBuild(bust);
  const dir = cleanFolder(folder);
  const at = (p: string) => (dir ? `${dir}/${p}` : p);
  setStorageConfigSource(async () => target);
  await withStorageBatch(async () => {
    let done = 0;
    const ordered = [...manifest.files.filter((f) => f !== "index.html"), "index.html"];
    for (const file of ordered) {
      const bytes = file === "index.html" ? indexBytes : await fetchAdminFile(file, bust);
      await uploadFile({ path: at(file), content: bytesToBase64(bytes), encoding: "base64" });
      onProgress?.(++done, ordered.length);
    }
    await uploadFile({ path: at(ADMIN_MANIFEST), content: JSON.stringify(manifest, null, 2) + "\n" });
    await uploadFile({ path: at("config.js"), content: buildConfigJsSource(runtime) });
  });
  return { files: manifest.files.length, version: manifest.version, url: adminUrlOn(target.settings, folder) };
}

// Only (re)writes config.js next to an admin already on the target.
export async function uploadConfigJs(target: StorageConfig, folder: string, runtime: RuntimeConfig): Promise<void> {
  const dir = cleanFolder(folder);
  setStorageConfigSource(async () => target);
  await withStorageBatch(() => uploadFile({ path: dir ? `${dir}/config.js` : "config.js", content: buildConfigJsSource(runtime) }));
}

// The whole admin + config.js as a ZIP to upload anywhere by hand.
export async function buildAdminZip(runtime: RuntimeConfig, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const bust = String(Date.now());
  const { manifest, indexBytes } = await loadBuild(bust);
  const zip = new JSZip();
  let done = 0;
  for (const file of manifest.files) {
    zip.file(file, file === "index.html" ? indexBytes : await fetchAdminFile(file, bust));
    onProgress?.(++done, manifest.files.length);
  }
  zip.file(ADMIN_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  zip.file("config.js", buildConfigJsSource(runtime));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(text: string, name: string, type = "text/plain"): void {
  downloadBlob(new Blob([text], { type }), name);
}

export function downloadConfigJs(runtime: RuntimeConfig): void {
  downloadText(buildConfigJsSource(runtime), "config.js", "text/javascript");
}
