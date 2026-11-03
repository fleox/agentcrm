// Extension packages (ZIP) — read, validate, pack. DOM-free: shared by the
// admin (Settings → Modules → Install) and the CLI (`agentcrm ext
// check|pack|install`).
//
// ZIP layout (a single wrapping folder, e.g. from macOS "Compress", is
// accepted):
//   manifest.json   { id, kind, name, version, apiVersion, description,
//                     author?, homepage?, entry: "bundle.js", style?: "style.css",
//                     icon?, category?, dependsOn? }
//   bundle.js       ESM, default-exports defineModule({...}) / defineTheme({...});
//                   bare imports limited to RUNTIME_SPECIFIERS
//   style.css       optional

import JSZip from "jszip";
import { BUILTIN_MODULES, MODULE_CATEGORIES } from "../core/modules";
import { EXTENSION_API_VERSION, EXTENSION_LIMITS, EXTENSION_MIN_API_VERSION, isCompatibleApiVersion, RUNTIME_SPECIFIERS } from "./api";
import type { ExtensionFiles, ExtensionManifest, ExtensionPackage } from "./types";

export type ExtensionPackageErrorCode = "invalidZip" | "missingManifest" | "invalidManifest" | "missingEntry" | "tooLarge" | "incompatibleApi" | "invalidBundle";

export class ExtensionPackageError extends Error {
  constructor(
    readonly code: ExtensionPackageErrorCode,
    message: string,
    readonly details?: string[],
  ) {
    super(message);
    this.name = "ExtensionPackageError";
  }
}

export const EXTENSION_ID_RE = /^[a-z][a-z0-9-]{1,48}[a-z0-9]$/;
export const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
// Ids an extension can't take (built-in modules + reserved words).
export const RESERVED_EXTENSION_IDS: readonly string[] = [...BUILTIN_MODULES.map((m) => m.id), "agentcrm", "core", "runtime", "admin", "app", "custom", "default"];

const MANIFEST_KEYS = ["id", "kind", "name", "version", "apiVersion", "description", "author", "homepage", "entry", "style", "icon", "category", "dependsOn"];

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

// Validates and normalises a manifest. Throws ExtensionPackageError
// ("invalidManifest" with every problem in `details`, or "incompatibleApi").
export function validateManifest(raw: unknown): ExtensionManifest {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ExtensionPackageError("invalidManifest", "manifest.json must be a JSON object.");
  const m = raw as Record<string, unknown>;
  const str = (k: string, required: boolean, max = 200): string | undefined => {
    const v = m[k];
    if (v === undefined || v === null || v === "") {
      if (required) errors.push(`"${k}" is required.`);
      return undefined;
    }
    if (typeof v !== "string") {
      errors.push(`"${k}" must be a string.`);
      return undefined;
    }
    if (v.length > max) errors.push(`"${k}" is too long (max ${max} characters).`);
    return v.trim();
  };
  for (const k of Object.keys(m)) if (!MANIFEST_KEYS.includes(k)) errors.push(`Unknown key "${k}".`);
  const id = str("id", true, 50);
  if (id && !EXTENSION_ID_RE.test(id)) errors.push(`"id" must be 3–50 characters: lowercase letters, digits and dashes, starting with a letter (got "${id}").`);
  if (id && RESERVED_EXTENSION_IDS.includes(id)) errors.push(`"id" "${id}" is reserved (built-in module or reserved word).`);
  const kind = str("kind", true, 10);
  if (kind && kind !== "module" && kind !== "theme") errors.push(`"kind" must be "module" or "theme".`);
  const name = str("name", true, 80);
  const version = str("version", true, 40);
  if (version && !SEMVER_RE.test(version)) errors.push(`"version" must be semver (1.2.3), got "${version}".`);
  const apiVersion = str("apiVersion", true, 20);
  const description = str("description", false, 500) ?? "";
  const author = str("author", false, 120);
  const homepage = str("homepage", false, 300);
  if (homepage && !/^https?:\/\/\S+$/i.test(homepage)) errors.push(`"homepage" must be an http(s) URL.`);
  const entry = str("entry", false, 40) ?? "bundle.js";
  if (entry !== "bundle.js") errors.push(`"entry" must be "bundle.js".`);
  const style = str("style", false, 40);
  if (style !== undefined && style !== "style.css") errors.push(`"style" must be "style.css" when set.`);
  const icon = str("icon", false, 60);
  if (icon && !/^[A-Z][A-Za-z0-9]*$/.test(icon)) errors.push(`"icon" must be a lucide icon name in PascalCase ("Target").`);
  const category = str("category", false, 30);
  if (category && !(MODULE_CATEGORIES as readonly string[]).includes(category)) errors.push(`"category" must be one of ${MODULE_CATEGORIES.join(", ")}.`);
  let dependsOn: string[] | undefined;
  if (m.dependsOn !== undefined) {
    if (!Array.isArray(m.dependsOn) || !m.dependsOn.every((d) => typeof d === "string" && /^[a-z][a-z0-9-]*$/.test(d))) errors.push(`"dependsOn" must be an array of module ids.`);
    else dependsOn = [...new Set(m.dependsOn as string[])].filter((d) => d !== id);
  }
  if (kind === "theme" && (category || dependsOn?.length)) errors.push(`Themes can't declare "category" or "dependsOn".`);
  if (errors.length) throw new ExtensionPackageError("invalidManifest", `Invalid manifest.json: ${errors.join(" ")}`, errors);
  if (!isCompatibleApiVersion(apiVersion)) {
    throw new ExtensionPackageError("incompatibleApi", `apiVersion ${apiVersion} is not supported by this admin (supported: ${EXTENSION_MIN_API_VERSION} – ${EXTENSION_API_VERSION}).`);
  }
  return {
    id: id!,
    kind: kind as ExtensionManifest["kind"],
    name: name!,
    version: version!,
    apiVersion: apiVersion!,
    description,
    ...(author ? { author } : {}),
    ...(homepage ? { homepage } : {}),
    entry: "bundle.js",
    ...(style ? { style: "style.css" as const } : {}),
    ...(icon ? { icon } : {}),
    ...(category ? { category: category as ExtensionManifest["category"] } : {}),
    ...(dependsOn?.length ? { dependsOn } : {}),
  };
}

// Bare module specifiers a bundle imports (static, dynamic, re-exports).
export function bundleImports(code: string): string[] {
  const out = new Set<string>();
  const re = /(?:\bimport\s*(?:[\w*{}\s,$]+?\s*from\s*)?|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;
  for (const m of code.matchAll(re)) {
    const spec = m[1];
    if (!spec.startsWith(".") && !spec.startsWith("/") && !/^[a-z]+:/i.test(spec)) out.add(spec);
  }
  return [...out].sort();
}

// Rewrites the runtime specifiers of a bundle to URLs (Blob-URL imports
// can't rely on the import map in every browser / dev server).
export function rewriteRuntimeImports(code: string, resolve: (specifier: string) => string): string {
  const specs = RUNTIME_SPECIFIERS.map((s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|");
  const re = new RegExp(`(\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\bimport\\s+)(["'])(${specs})\\2`, "g");
  return code.replace(re, (_m, prefix: string, quote: string, spec: string) => `${prefix}${quote}${resolve(spec)}${quote}`);
}

// Checks the files of a package against its manifest and the limits.
export function validatePackage(pkg: { manifest: unknown; files: { [name: string]: unknown } | ExtensionFiles }): ExtensionPackage {
  const raw = pkg.files as Record<string, unknown>;
  const manifest = validateManifest(pkg.manifest);
  const bundle = raw["bundle.js"];
  if (typeof bundle !== "string" || !bundle.trim()) throw new ExtensionPackageError("missingEntry", "The package has no bundle.js.");
  if (byteLength(bundle) > EXTENSION_LIMITS.bundle) throw new ExtensionPackageError("tooLarge", `bundle.js is ${(byteLength(bundle) / 1024 / 1024).toFixed(2)} MB — the limit is ${EXTENSION_LIMITS.bundle / 1024 / 1024} MB.`);
  const unknown = bundleImports(bundle).filter((s) => !(RUNTIME_SPECIFIERS as readonly string[]).includes(s));
  if (unknown.length) {
    throw new ExtensionPackageError("invalidBundle", `bundle.js imports modules the admin doesn't provide: ${unknown.join(", ")}. Bundle them, or import from: ${RUNTIME_SPECIFIERS.join(", ")}.`, unknown);
  }
  if (!/\bexport\s*(?:default\b|\{[^}]*\bas\s+default\b)/.test(bundle)) throw new ExtensionPackageError("invalidBundle", "bundle.js must have a default export (defineModule / defineTheme).");
  const files: ExtensionFiles = { "bundle.js": bundle };
  const style = raw["style.css"];
  if (manifest.style) {
    if (typeof style !== "string") throw new ExtensionPackageError("missingEntry", 'manifest.json declares "style": "style.css" but the package has no style.css.');
  }
  if (typeof style === "string" && style.trim()) {
    if (byteLength(style) > EXTENSION_LIMITS.style) throw new ExtensionPackageError("tooLarge", `style.css is larger than ${EXTENSION_LIMITS.style / 1024} KB.`);
    files["style.css"] = style;
  }
  return { manifest, files };
}

type ZipInput = Uint8Array | ArrayBuffer | Blob;

// Reads + validates a ZIP. Throws ExtensionPackageError.
export async function readExtensionZip(data: ZipInput): Promise<ExtensionPackage> {
  const size = data instanceof Uint8Array ? data.byteLength : data instanceof ArrayBuffer ? data.byteLength : (data as Blob).size;
  if (size > EXTENSION_LIMITS.zip) throw new ExtensionPackageError("tooLarge", `The ZIP is larger than ${EXTENSION_LIMITS.zip / 1024 / 1024} MB.`);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (err) {
    throw new ExtensionPackageError("invalidZip", `Not a valid ZIP file (${(err as Error).message}).`);
  }
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !n.startsWith("__MACOSX/") && !n.split("/").pop()!.startsWith("."));
  let prefix = "";
  if (!names.includes("manifest.json")) {
    const candidates = names.filter((n) => /^[^/]+\/manifest\.json$/.test(n));
    if (candidates.length !== 1) throw new ExtensionPackageError("missingManifest", "The ZIP has no manifest.json at its root.");
    prefix = candidates[0].slice(0, -"manifest.json".length);
  }
  const read = async (name: string): Promise<string | undefined> => {
    const f = zip.file(prefix + name);
    return f ? f.async("string") : undefined;
  };
  const manifestText = (await read("manifest.json"))!;
  if (byteLength(manifestText) > EXTENSION_LIMITS.manifest) throw new ExtensionPackageError("tooLarge", "manifest.json is too large.");
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch (err) {
    throw new ExtensionPackageError("invalidManifest", `manifest.json is not valid JSON (${(err as Error).message}).`);
  }
  const files: Record<string, string | undefined> = { "bundle.js": await read("bundle.js"), "style.css": await read("style.css") };
  return validatePackage({ manifest, files });
}

// Builds the ZIP of a package (manifest.json + bundle.js [+ style.css]).
export async function packExtension(pkg: ExtensionPackage): Promise<Uint8Array> {
  const valid = validatePackage(pkg);
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(valid.manifest, null, 2) + "\n");
  zip.file("bundle.js", valid.files["bundle.js"]);
  if (valid.files["style.css"]) zip.file("style.css", valid.files["style.css"]);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
}

// Short, stable fingerprint of a package's content (FNV-1a 32-bit).
export function fingerprint(manifest: Pick<ExtensionManifest, "version">, files: ExtensionFiles): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  feed(manifest.version);
  feed(files["bundle.js"]);
  feed(files["style.css"] ?? "");
  return `${manifest.version}-${h.toString(16).padStart(8, "0")}`;
}
