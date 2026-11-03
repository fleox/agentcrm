// External extensions (modules & themes) stored in the data store
// (collection `extensions`, one doc per extension: manifest + files) —
// encrypted with the rest, shared by every user, no hosting needed.
// Installing = running third-party code with the installer's rights:
// admins only (`extensions.write`), the UI asks for an explicit
// confirmation. Loading happens in src/extensions/loader.ts.

import type { ExtensionDoc, ExtensionKind, ExtensionPackage } from "../extensions/types";
import { compareVersions, EXTENSION_LIMITS, isCompatibleApiVersion } from "../extensions/api";
import { ExtensionPackageError, validatePackage } from "../extensions/package";
import type { DocMutation } from "../data/types";
import { assertCan, OpsError, type OpsContext } from "./context";
import { moduleStates, setModuleEnabled } from "./modules";
import { asDoc, extensionDocOf, extensionDocsOf } from "./store";

export interface ExtensionSummary {
  id: string;
  kind: ExtensionKind;
  name: string;
  version: string;
  apiVersion: string;
  description: string;
  author?: string;
  homepage?: string;
  enabled: boolean;
  compatible: boolean;
  installedAt: number;
  installedBy?: string;
  updatedAt: number;
  previousVersion?: string;
  dependsOn?: string[];
  category?: string;
  icon?: string;
  size: { bundle: number; style: number };
}

export interface InstallResult {
  id: string;
  kind: ExtensionKind;
  version: string;
  mode: "install" | "upgrade";
  previousVersion?: string;
  enabled: boolean;
  warnings: string[];
}

const bytes = (s: string | undefined) => (s ? new TextEncoder().encode(s).length : 0);

export function summarizeExtension(doc: ExtensionDoc): ExtensionSummary {
  const m = doc.manifest;
  return {
    id: doc.id,
    kind: doc.kind,
    name: m.name,
    version: m.version,
    apiVersion: m.apiVersion,
    description: m.description,
    ...(m.author ? { author: m.author } : {}),
    ...(m.homepage ? { homepage: m.homepage } : {}),
    enabled: !!doc.enabled,
    compatible: isCompatibleApiVersion(m.apiVersion),
    installedAt: doc.installedAt,
    ...(doc.installedBy ? { installedBy: doc.installedBy } : {}),
    updatedAt: doc.updatedAt,
    ...(doc.previousVersion ? { previousVersion: doc.previousVersion } : {}),
    ...(m.dependsOn?.length ? { dependsOn: m.dependsOn } : {}),
    ...(m.category ? { category: m.category } : {}),
    ...(m.icon ? { icon: m.icon } : {}),
    size: { bundle: bytes(doc.files?.["bundle.js"]), style: bytes(doc.files?.["style.css"]) },
  };
}

export function listExtensions(ctx: OpsContext, opts: { kind?: ExtensionKind } = {}): ExtensionSummary[] {
  assertCan(ctx, "settings.read");
  return extensionDocsOf(ctx.store)
    .filter((d) => !opts.kind || d.kind === opts.kind)
    .map(summarizeExtension)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function requireExtension(ctx: OpsContext, id: string): ExtensionDoc {
  const doc = extensionDocOf(ctx.store, id);
  if (!doc) {
    const known = extensionDocsOf(ctx.store).map((d) => d.id);
    throw new OpsError("notFound", `Extension "${id}" is not installed.${known.length ? ` Installed: ${known.join(", ")}.` : ""}`);
  }
  return doc;
}

export function getExtension(ctx: OpsContext, id: string): ExtensionSummary {
  assertCan(ctx, "settings.read");
  return summarizeExtension(requireExtension(ctx, id));
}

// The installed package (manifest + files) — e.g. to export it as a ZIP
// with packExtension().
export function getExtensionPackage(ctx: OpsContext, id: string): ExtensionPackage {
  assertCan(ctx, "settings.read");
  const doc = requireExtension(ctx, id);
  return { manifest: doc.manifest, files: { ...doc.files } };
}

// Installs a package, or upgrades in place when the id is installed (the
// enabled state is kept, `previousVersion` recorded). Validates the
// manifest, API version, ids, sizes and bundle imports. A module whose
// dependencies are off is installed disabled (see `warnings`).
export async function installExtension(ctx: OpsContext, pkg: ExtensionPackage, opts: { enabled?: boolean } = {}): Promise<InstallResult> {
  assertCan(ctx, "extensions.write");
  let valid: ExtensionPackage;
  try {
    valid = validatePackage(pkg);
  } catch (err) {
    if (err instanceof ExtensionPackageError) throw new OpsError(err.code === "incompatibleApi" ? "invalid" : "validation", err.message, { code: err.code, details: err.details });
    throw err;
  }
  const { manifest, files } = valid;
  const total = bytes(files["bundle.js"]) + bytes(files["style.css"]);
  if (total > EXTENSION_LIMITS.bundle + EXTENSION_LIMITS.style) throw new OpsError("validation", "The package is too large.");
  const existing = extensionDocOf(ctx.store, manifest.id);
  if (existing && existing.kind !== manifest.kind) {
    throw new OpsError("conflict", `"${manifest.id}" is installed as a ${existing.kind}; this package is a ${manifest.kind}. Uninstall it first.`);
  }
  const warnings: string[] = [];
  let enabled = existing ? existing.enabled : opts.enabled ?? true;
  if (opts.enabled !== undefined) enabled = opts.enabled;
  if (enabled && manifest.kind === "module" && manifest.dependsOn?.length) {
    const states = new Map(moduleStates(ctx.store).map((m) => [m.id, m]));
    const missing = manifest.dependsOn.filter((d) => !states.get(d)?.enabled);
    if (missing.length) {
      enabled = false;
      warnings.push(`Installed disabled: it needs ${missing.join(", ")} (${missing.map((d) => (states.has(d) ? "disabled" : "not installed")).join(", ")}).`);
    }
  }
  if (existing) {
    const cmp = compareVersions(manifest.version, existing.manifest.version);
    if (cmp < 0) warnings.push(`Downgrade: ${existing.manifest.version} → ${manifest.version}.`);
    else if (cmp === 0) warnings.push(`Version ${manifest.version} is already installed: its files are replaced (bump "version" for a new release).`);
  }
  const now = ctx.now();
  const doc: ExtensionDoc = {
    id: manifest.id,
    kind: manifest.kind,
    manifest,
    enabled,
    files,
    installedAt: existing?.installedAt ?? now,
    ...(ctx.user?.id ? { installedBy: ctx.user.id } : existing?.installedBy ? { installedBy: existing.installedBy } : {}),
    updatedAt: now,
    ...(existing ? { previousVersion: existing.manifest.version } : {}),
  };
  await ctx.store.write([{ op: "set", collection: "extensions", doc: asDoc(doc) }], { message: `${existing ? "Upgrade" : "Install"} extension ${manifest.id} ${manifest.version}` });
  ctx.log?.(`extension ${manifest.id} ${existing ? `upgraded ${existing.manifest.version} → ${manifest.version}` : `installed (${manifest.version})`}`);
  return {
    id: manifest.id,
    kind: manifest.kind,
    version: manifest.version,
    mode: existing ? "upgrade" : "install",
    ...(existing ? { previousVersion: existing.manifest.version } : {}),
    enabled,
    warnings,
  };
}

// Enables / disables an extension. Modules go through the dependency
// checks of setModuleEnabled.
export async function setExtensionEnabled(ctx: OpsContext, id: string, enabled: boolean, opts: { cascade?: boolean } = {}): Promise<ExtensionSummary> {
  assertCan(ctx, "extensions.write");
  const doc = requireExtension(ctx, id);
  if (enabled && !isCompatibleApiVersion(doc.manifest.apiVersion)) throw new OpsError("invalid", `"${doc.manifest.name}" targets an unsupported API version (${doc.manifest.apiVersion}).`);
  if (doc.kind === "module") {
    await setModuleEnabled(ctx, id, enabled, opts);
  } else if (doc.enabled !== enabled) {
    const mutations: DocMutation[] = [{ op: "patch", collection: "extensions", id, fields: { enabled, updatedAt: ctx.now() } }];
    // Disabling the selected theme falls back to the workspace values.
    if (!enabled) mutations.push(...clearThemeSelection(ctx, id));
    await ctx.store.write(mutations, { message: `${enabled ? "Enable" : "Disable"} theme ${id}` });
  }
  return summarizeExtension(requireExtension(ctx, id));
}

// When theme `id` is the workspace's selected theme / preset, falls back to
// the workspace values: themeId cleared, and a preset pointing at the theme
// reset to the default preset instead of dangling.
function clearThemeSelection(ctx: OpsContext, id: string): DocMutation[] {
  const appearance = ctx.store.get("config", "appearance");
  if (!appearance) return [];
  const fields: Record<string, unknown> = {};
  if (appearance.themeId === id) fields.themeId = undefined;
  if (appearance.preset === id) fields.preset = undefined;
  return Object.keys(fields).length ? [{ op: "patch", collection: "config", id: "appearance", fields }] : [];
}

// Removes an extension (its module configuration is kept). Refused while
// enabled modules depend on it, unless `force`.
export async function uninstallExtension(ctx: OpsContext, id: string, opts: { force?: boolean } = {}): Promise<{ id: string; removed: true }> {
  assertCan(ctx, "extensions.write");
  const doc = requireExtension(ctx, id);
  if (doc.kind === "module" && !opts.force) {
    const dependents = moduleStates(ctx.store).filter((m) => m.enabled && m.dependsOn.includes(id));
    if (dependents.length) throw new OpsError("conflict", `${dependents.map((d) => `"${d.name}"`).join(", ")} depend${dependents.length > 1 ? "" : "s"} on "${doc.manifest.name}". Disable or uninstall ${dependents.length > 1 ? "them" : "it"} first.`, { dependents: dependents.map((d) => d.id) });
  }
  const mutations: DocMutation[] = [{ op: "delete", collection: "extensions", id }];
  mutations.push(...clearThemeSelection(ctx, id));
  await ctx.store.write(mutations, { message: `Uninstall extension ${id}` });
  ctx.log?.(`extension ${id} uninstalled`);
  return { id, removed: true };
}
