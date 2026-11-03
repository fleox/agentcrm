// Appearance defaults, validation and resolution (pure, shared by
// src/ops/appearance.ts, the admin and the CLI).

import { isHexColor, normalizeHex } from "./color";
import { FONTS } from "./fonts";
import {
  BUTTON_STYLES,
  COLOR_MODES,
  CONTRASTS,
  DEFAULT_ACCENT,
  DENSITIES,
  MAX_CUSTOM_CSS,
  MAX_IMAGE_BYTES,
  NEUTRALS,
  RADII,
  SIDEBAR_STYLES,
  type Appearance,
  type AppearancePatch,
  type ThemeDefinition,
} from "./types";

export const DEFAULT_APPEARANCE: Appearance = {
  preset: "default",
  accent: DEFAULT_ACCENT,
  neutral: "zinc",
  radius: "md",
  density: "comfortable",
  font: "system",
  sidebar: "default",
  defaultMode: "system",
  contrast: "normal",
  buttons: "neutral",
};

export const APPEARANCE_KEYS: readonly (keyof Appearance)[] = ["preset", "accent", "neutral", "radius", "density", "font", "sidebar", "defaultMode", "contrast", "buttons", "logo", "favicon", "customCss", "themeId"];

const ENUMS: Partial<Record<keyof Appearance, readonly string[]>> = {
  neutral: NEUTRALS,
  radius: RADII,
  density: DENSITIES,
  sidebar: SIDEBAR_STYLES,
  defaultMode: COLOR_MODES,
  contrast: CONTRASTS,
  buttons: BUTTON_STYLES,
};

const IMAGE_RE = /^data:image\/(png|jpeg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/]+=*$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Decoded byte size of a base64 data URL.
export function dataUrlBytes(url: string): number {
  const b64 = url.slice(url.indexOf(",") + 1);
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export function validateImageDataUrl(value: unknown, label = "image"): string | null {
  if (typeof value !== "string" || !IMAGE_RE.test(value)) return `The ${label} must be a base64 image data URL (PNG, JPEG, GIF, WebP, SVG or ICO).`;
  const bytes = dataUrlBytes(value);
  if (bytes > MAX_IMAGE_BYTES) return `The ${label} is ${Math.round(bytes / 1024)} KB — the limit is ${MAX_IMAGE_BYTES / 1024} KB.`;
  return null;
}

export interface AppearanceValidation {
  // Normalised patch: `undefined` values mean "remove (back to default)".
  value: Partial<Record<keyof Appearance, unknown>>;
  errors: string[];
}

// Validates a patch (unknown keys and bad values are reported). `null`
// resets a key to its default.
export function validateAppearancePatch(patch: unknown): AppearanceValidation {
  const errors: string[] = [];
  const value: Partial<Record<keyof Appearance, unknown>> = {};
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { value, errors: ["The appearance patch must be an object."] };
  for (const [key, raw] of Object.entries(patch as Record<string, unknown>)) {
    if (!(APPEARANCE_KEYS as readonly string[]).includes(key)) {
      errors.push(`Unknown appearance key "${key}". Keys: ${APPEARANCE_KEYS.join(", ")}.`);
      continue;
    }
    const k = key as keyof Appearance;
    if (raw === null || raw === undefined) {
      value[k] = undefined;
      continue;
    }
    const allowed = ENUMS[k];
    if (allowed) {
      if (typeof raw !== "string" || !allowed.includes(raw)) errors.push(`${k} must be one of ${allowed.join(", ")}.`);
      else value[k] = raw;
      continue;
    }
    switch (k) {
      case "accent":
        if (!isHexColor(raw)) errors.push("accent must be a hex color like #3366ff.");
        else value.accent = normalizeHex(raw);
        break;
      case "font":
        if (typeof raw !== "string" || !FONTS.some((f) => f.id === raw)) errors.push(`font must be one of ${FONTS.map((f) => f.id).join(", ")}.`);
        else value.font = raw;
        break;
      case "preset":
        if (typeof raw !== "string" || !ID_RE.test(raw)) errors.push("preset must be a preset id.");
        else value.preset = raw;
        break;
      case "themeId":
        if (typeof raw !== "string" || !ID_RE.test(raw)) errors.push("themeId must be an extension id.");
        else value.themeId = raw;
        break;
      case "logo":
      case "favicon": {
        if (raw === "") {
          value[k] = undefined;
          break;
        }
        const err = validateImageDataUrl(raw, k);
        if (err) errors.push(err);
        else value[k] = raw;
        break;
      }
      case "customCss": {
        if (typeof raw !== "string") errors.push("customCss must be a string.");
        else if (new TextEncoder().encode(raw).length > MAX_CUSTOM_CSS) errors.push(`customCss is larger than ${MAX_CUSTOM_CSS / 1024} KB.`);
        else if (/<\/?style|<script/i.test(raw)) errors.push("customCss must be plain CSS (no <style> / <script> tags).");
        else value.customCss = raw.trim() ? raw : undefined;
        break;
      }
    }
  }
  return { value, errors };
}

// Theme values only fill what the workspace didn't set explicitly.
export function resolveAppearance(stored: Partial<Appearance> | undefined, theme?: Pick<ThemeDefinition, "appearance"> | null): Appearance {
  const clean = (o: Partial<Appearance> | undefined): Partial<Appearance> => {
    if (!o) return {};
    const { value } = validateAppearancePatch(Object.fromEntries(Object.entries(o).filter(([k, v]) => (APPEARANCE_KEYS as readonly string[]).includes(k) && v !== undefined && v !== null)));
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<Appearance>;
  };
  const themeValues = clean(theme?.appearance);
  delete themeValues.themeId;
  delete themeValues.logo;
  delete themeValues.favicon;
  return { ...DEFAULT_APPEARANCE, ...themeValues, ...clean(stored) };
}

export function stripPatchNulls(patch: AppearancePatch): Partial<Appearance> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null && v !== undefined)) as Partial<Appearance>;
}
