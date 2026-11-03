import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { EXTENSION_LIMITS } from "../../src/extensions/api";
import { ExtensionPackageError, validatePackage } from "../../src/extensions/package";
import type { ExtensionPackage } from "../../src/extensions/types";
import { CliError } from "../output";

// Reads an extension from where an author or a user has it — the ZIP, an
// unpacked package folder (manifest.json + bundle.js [+ style.css]) or an
// author's project (manifest.json at the root, the build in dist/) — into
// the raw { manifest, files } that src/extensions/package.ts validates.
// Same ZIP rules as the admin (readExtensionZip): one wrapping folder is
// accepted, __MACOSX / dotfiles ignored.

export interface RawPackage {
  source: string;
  sourceType: "zip" | "folder" | "project";
  // Parsed manifest.json (null when missing / not JSON; see `problems`).
  manifest: unknown;
  files: { "bundle.js"?: string; "style.css"?: string };
  zipBytes?: number;
  // Reading problems (missing manifest, bad JSON, missing build…).
  problems: { code: string; message: string; hint?: string }[];
  // Files found in a ZIP that the admin ignores.
  ignored: string[];
}

function parseManifest(text: string | undefined, problems: RawPackage["problems"]): unknown {
  if (text === undefined) {
    problems.push({ code: "missingManifest", message: "No manifest.json found.", hint: "Point at the project folder (manifest.json at its root), an unpacked package or the .zip." });
    return null;
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch (err) {
    problems.push({ code: "invalidManifest", message: `manifest.json is not valid JSON (${(err as Error).message}).` });
    return null;
  }
}

async function readZip(source: string): Promise<RawPackage> {
  const problems: RawPackage["problems"] = [];
  const data = readFileSync(source);
  const { default: JSZip } = await import("jszip");
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (err) {
    throw new CliError("invalid-zip", `${source} is not a readable ZIP: ${(err as Error).message}`, undefined, 2);
  }
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const kept = names.filter((n) => !n.startsWith("__MACOSX/") && !n.split("/").pop()!.startsWith("."));
  let prefix = "";
  if (!kept.includes("manifest.json")) {
    const candidates = kept.filter((n) => /^[^/]+\/manifest\.json$/.test(n));
    if (candidates.length === 1) prefix = candidates[0].slice(0, -"manifest.json".length);
  }
  const read = async (name: string) => {
    const f = zip.file(prefix + name);
    return f ? f.async("string") : undefined;
  };
  const known = new Set(["manifest.json", "bundle.js", "style.css"].map((n) => prefix + n));
  const manifest = parseManifest(await read("manifest.json"), problems);
  const bundle = await read("bundle.js");
  const style = await read("style.css");
  if (data.byteLength > EXTENSION_LIMITS.zip) problems.push({ code: "tooLarge", message: `The ZIP is ${(data.byteLength / 1024 / 1024).toFixed(2)} MB — the limit is ${EXTENSION_LIMITS.zip / 1024 / 1024} MB.` });
  return {
    source,
    sourceType: "zip",
    manifest,
    files: { ...(bundle !== undefined ? { "bundle.js": bundle } : {}), ...(style !== undefined ? { "style.css": style } : {}) },
    zipBytes: data.byteLength,
    problems,
    ignored: names.filter((n) => !known.has(n)),
  };
}

function readText(path: string): string | undefined {
  return existsSync(path) && statSync(path).isFile() ? readFileSync(path, "utf8") : undefined;
}

function readFolder(source: string): RawPackage {
  const problems: RawPackage["problems"] = [];
  const manifest = parseManifest(readText(join(source, "manifest.json")), problems);
  const declaresStyle = !!manifest && typeof manifest === "object" && (manifest as { style?: unknown }).style === "style.css";
  // An unpacked package: bundle.js next to manifest.json (and no package.json).
  if (existsSync(join(source, "bundle.js")) && !existsSync(join(source, "package.json"))) {
    const bundle = readText(join(source, "bundle.js"));
    const style = readText(join(source, "style.css"));
    return { source, sourceType: "folder", manifest, files: { ...(bundle !== undefined ? { "bundle.js": bundle } : {}), ...(style !== undefined ? { "style.css": style } : {}) }, problems, ignored: [] };
  }
  // An author's project: the build is dist/bundle.js; the stylesheet is
  // dist/style.css, else src/style.css, else style.css.
  const bundle = readText(join(source, "dist", "bundle.js"));
  if (bundle === undefined) problems.push({ code: "notBuilt", message: "dist/bundle.js not found.", hint: "Build the project first: npm run build (vite build)." });
  const stylePath = [join(source, "dist", "style.css"), join(source, "src", "style.css"), join(source, "style.css")].find((p) => existsSync(p));
  const style = declaresStyle && stylePath ? readText(stylePath) : undefined;
  return { source, sourceType: "project", manifest, files: { ...(bundle !== undefined ? { "bundle.js": bundle } : {}), ...(style !== undefined ? { "style.css": style } : {}) }, problems, ignored: stylePath && !declaresStyle ? [stylePath] : [] };
}

export async function readRawPackage(input: string): Promise<RawPackage> {
  const source = resolve(input);
  if (!existsSync(source)) throw new CliError("not-found", `${input} does not exist.`, "Pass the extension's project folder, an unpacked package folder or its .zip.", 2);
  if (statSync(source).isFile()) {
    if (!/\.zip$/i.test(source)) throw new CliError("usage", `${input} is not a .zip.`, "Pass the extension's .zip, its project folder or an unpacked folder.", 2);
    return readZip(source);
  }
  return readFolder(source);
}

// Reads and validates (throws a CliError with every problem).
export async function readPackage(input: string): Promise<{ raw: RawPackage; pkg: ExtensionPackage }> {
  const raw = await readRawPackage(input);
  if (raw.problems.length) {
    const p = raw.problems[0];
    throw new CliError(p.code === "notBuilt" ? "not-built" : "invalid-package", raw.problems.map((x) => x.message).join(" "), p.hint ?? "Run `agentcrm ext check` on it for the full report.", 2);
  }
  try {
    return { raw, pkg: validatePackage({ manifest: raw.manifest, files: raw.files }) };
  } catch (err) {
    if (err instanceof ExtensionPackageError) throw new CliError("invalid-package", err.message, "Run `agentcrm ext check` on it for the full report.", 2);
    throw err;
  }
}
