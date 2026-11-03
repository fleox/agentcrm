// Workspace appearance (doc `config/appearance`): colors, neutral scale,
// radius, density, font, sidebar style, default light / dark mode, logo,
// favicon, custom CSS, selected external theme. Everyone reads; admins
// write (`appearance.write`). The admin applies the resolved value live
// (src/appearance/apply.ts) for every user of the workspace.

import {
  APPEARANCE_DOC_ID,
  APPEARANCE_KEYS,
  DEFAULT_APPEARANCE,
  PRESETS,
  findPreset,
  getExternalTheme,
  resolveAppearance,
  validateAppearancePatch,
  validateImageDataUrl,
  type Appearance,
  type AppearanceDoc,
  type AppearancePatch,
} from "../appearance";
import type { StoredDoc } from "../data/types";
import { assertCan, OpsError, type OpsContext } from "./context";
import { extensionDocOf, extensionDocsOf } from "./store";

// Keys a preset / theme doesn't touch.
const BRANDING_KEYS: readonly (keyof Appearance)[] = ["logo", "favicon", "customCss"];

export function getAppearanceDoc(ctx: OpsContext): AppearanceDoc | undefined {
  assertCan(ctx, "settings.read");
  return ctx.store.get("config", APPEARANCE_DOC_ID) as unknown as AppearanceDoc | undefined;
}

// The effective appearance (defaults ← selected theme ← workspace values).
export function getAppearance(ctx: OpsContext): Appearance {
  const doc = getAppearanceDoc(ctx);
  const theme = doc?.themeId && extensionDocOf(ctx.store, doc.themeId)?.enabled ? getExternalTheme(doc.themeId) : undefined;
  return resolveAppearance(doc, theme);
}

function explicit(doc: AppearanceDoc | undefined): Partial<Appearance> {
  if (!doc) return {};
  return Object.fromEntries(Object.entries(doc).filter(([k, v]) => (APPEARANCE_KEYS as readonly string[]).includes(k) && v !== undefined)) as Partial<Appearance>;
}

async function writeDoc(ctx: OpsContext, values: Partial<Appearance>, message: string): Promise<Appearance> {
  const doc: AppearanceDoc = { ...values, id: APPEARANCE_DOC_ID, updatedAt: ctx.now(), ...(ctx.user?.id ? { updatedBy: ctx.user.id } : {}) };
  await ctx.store.write([{ op: "set", collection: "config", doc: doc as unknown as StoredDoc }], { message });
  return getAppearance(ctx);
}

function assertTheme(ctx: OpsContext, id: string): void {
  const ext = extensionDocOf(ctx.store, id);
  if (!ext || ext.kind !== "theme") {
    const themes = extensionDocsOf(ctx.store).filter((d) => d.kind === "theme").map((d) => d.id);
    throw new OpsError("notFound", `Theme "${id}" is not installed.${themes.length ? ` Installed themes: ${themes.join(", ")}.` : ""}`);
  }
  if (!ext.enabled) throw new OpsError("invalid", `Theme "${id}" is disabled — enable it first.`);
}

// Merges a validated patch (`null` = back to default). Changing a visual
// key without a `preset` marks the appearance "custom".
export async function setAppearance(ctx: OpsContext, patch: AppearancePatch): Promise<Appearance> {
  assertCan(ctx, "appearance.write");
  const { value, errors } = validateAppearancePatch(patch);
  if (errors.length) throw new OpsError("validation", errors.join(" "), errors);
  if (typeof value.themeId === "string") assertTheme(ctx, value.themeId);
  if (typeof value.preset === "string" && value.preset !== "custom" && !findPreset(value.preset) && value.preset !== value.themeId && !extensionDocOf(ctx.store, value.preset)) {
    throw new OpsError("validation", `Unknown preset "${value.preset}". Presets: ${PRESETS.map((p) => p.id).join(", ")}, custom.`);
  }
  const next: Record<string, unknown> = { ...explicit(getAppearanceDoc(ctx)) };
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  const visual = Object.keys(value).some((k) => !BRANDING_KEYS.includes(k as keyof Appearance) && k !== "preset" && k !== "defaultMode" && k !== "themeId");
  if (visual && value.preset === undefined) next.preset = "custom";
  return writeDoc(ctx, next as Partial<Appearance>, "Update appearance");
}

// Applies a built-in preset (its values replace the visual keys; logo,
// favicon, custom CSS and the default mode are kept) or an installed
// theme (`themeId`; its values show unless overridden later).
export async function applyPreset(ctx: OpsContext, id: string): Promise<Appearance> {
  assertCan(ctx, "appearance.write");
  const current = explicit(getAppearanceDoc(ctx));
  const kept: Partial<Appearance> = {};
  for (const k of BRANDING_KEYS) if (current[k] !== undefined) (kept as Record<string, unknown>)[k] = current[k];
  const preset = findPreset(id);
  if (preset) {
    return writeDoc(ctx, { ...kept, ...(current.defaultMode ? { defaultMode: current.defaultMode } : {}), ...preset.values, preset: preset.id }, `Apply appearance preset ${preset.name}`);
  }
  const ext = extensionDocOf(ctx.store, id);
  if (ext?.kind === "theme") {
    assertTheme(ctx, id);
    return writeDoc(ctx, { ...kept, preset: id, themeId: id }, `Apply theme ${ext.manifest.name}`);
  }
  const themes = extensionDocsOf(ctx.store).filter((d) => d.kind === "theme").map((d) => d.id);
  throw new OpsError("notFound", `Unknown preset "${id}". Presets: ${[...PRESETS.map((p) => p.id), ...themes].join(", ")}.`);
}

// Back to the defaults. Keeps the logo / favicon unless `branding`.
export async function resetAppearance(ctx: OpsContext, opts: { branding?: boolean } = {}): Promise<Appearance> {
  assertCan(ctx, "appearance.write");
  const current = explicit(getAppearanceDoc(ctx));
  const kept: Partial<Appearance> = opts.branding ? {} : { ...(current.logo ? { logo: current.logo } : {}), ...(current.favicon ? { favicon: current.favicon } : {}) };
  if (!Object.keys(kept).length) {
    if (getAppearanceDoc(ctx)) await ctx.store.write([{ op: "delete", collection: "config", id: APPEARANCE_DOC_ID }], { message: "Reset appearance" });
    return getAppearance(ctx);
  }
  return writeDoc(ctx, kept, "Reset appearance");
}

// Sets / removes the workspace logo or favicon (image data URL ≤ 200 KB).
export async function setLogo(ctx: OpsContext, dataUrl: string | null, opts: { kind?: "logo" | "favicon" } = {}): Promise<Appearance> {
  assertCan(ctx, "appearance.write");
  const kind = opts.kind ?? "logo";
  if (dataUrl !== null) {
    const err = validateImageDataUrl(dataUrl, kind);
    if (err) throw new OpsError("validation", err);
  }
  return setAppearance(ctx, { [kind]: dataUrl });
}

export interface PresetInfo {
  id: string;
  name: string;
  description: string;
  source: "builtin" | "extension";
  values: Partial<Appearance>;
  // Extension themes: enabled + loaded in this process (values known).
  enabled?: boolean;
  loaded?: boolean;
  version?: string;
}

export function listPresets(ctx: OpsContext): PresetInfo[] {
  assertCan(ctx, "settings.read");
  const builtin: PresetInfo[] = PRESETS.map((p) => ({ id: p.id, name: p.name, description: p.description, source: "builtin", values: { ...DEFAULT_APPEARANCE, ...p.values, preset: p.id } }));
  const themes: PresetInfo[] = extensionDocsOf(ctx.store)
    .filter((d) => d.kind === "theme")
    .map((d) => {
      const loaded = getExternalTheme(d.id);
      return {
        id: d.id,
        name: loaded?.name ?? d.manifest.name,
        description: loaded?.description ?? d.manifest.description,
        source: "extension" as const,
        values: loaded ? { ...DEFAULT_APPEARANCE, ...loaded.appearance, preset: d.id, themeId: d.id } : { themeId: d.id },
        enabled: !!d.enabled,
        loaded: !!loaded,
        version: d.manifest.version,
      };
    });
  return [...builtin, ...themes];
}
