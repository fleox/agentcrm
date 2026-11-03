// Appearance → CSS. Produces the stylesheet that overrides the CSS
// variables declared in src/index.css (Tailwind's `accent`, `surface`,
// `primary` colors, radii, font, density all read them), plus the
// attributes set on <html>. Pure — apply.ts writes it to the DOM and the
// anti-FOUC cache.

import { foregroundOn, generateScale, rgbTriplet, SCALE_STEPS, type ColorScale } from "./color";
import { findFont, googleFontHref } from "./fonts";
import { DEFAULT_ACCENT_SCALE, NEUTRAL_SCALES, SURFACE_STEPS, type SurfaceScale } from "./palettes";
import { DEFAULT_ACCENT, type Appearance, type RadiusName } from "./types";

export const RADIUS_SCALE: Record<RadiusName, number> = { none: 0, sm: 0.5, md: 1, lg: 1.35, xl: 1.75 };

export const DENSITY_VARS: Record<Appearance["density"], Record<string, string>> = {
  comfortable: { "--row-h": "2rem", "--ctl-h": "2rem", "--card-pad": "1rem", "--card-head-py": "0.625rem", "--page-py": "0.75rem" },
  compact: { "--row-h": "1.75rem", "--ctl-h": "1.75rem", "--card-pad": "0.75rem", "--card-head-py": "0.375rem", "--page-py": "0.5rem" },
};

export interface AppearanceCss {
  // Stylesheet for <style id="agentcrm-appearance">.
  css: string;
  // Attributes for <html> (data-density, data-sidebar…).
  attrs: Record<string, string>;
  // Google Fonts stylesheet, when the font needs one.
  fontHref: string | null;
}

export function accentScale(accent: string): ColorScale {
  return accent.toLowerCase() === DEFAULT_ACCENT ? DEFAULT_ACCENT_SCALE : generateScale(accent);
}

function block(selector: string, vars: Record<string, string>): string {
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  return body ? `${selector}{${body}}` : "";
}

export function surfaceVars(scale: SurfaceScale): Record<string, string> {
  return Object.fromEntries(SURFACE_STEPS.map((s) => [`--srf-${s}`, rgbTriplet(scale[s])]));
}

export function accentVars(scale: ColorScale): Record<string, string> {
  return Object.fromEntries(SCALE_STEPS.map((s) => [`--acc-${s}`, rgbTriplet(scale[s])]));
}

// CSS variables of an appearance (light mode) — for scoped previews
// (style={{...}} on a container re-themes everything inside it).
export function appearanceVars(a: Appearance): Record<string, string> {
  const acc = accentScale(a.accent);
  const srf = NEUTRAL_SCALES[a.neutral] ?? NEUTRAL_SCALES.zinc;
  const vars: Record<string, string> = {
    ...accentVars(acc),
    ...surfaceVars(srf),
    "--acc-fg": rgbTriplet(foregroundOn(acc[600], srf[900])),
    "--radius-scale": String(RADIUS_SCALE[a.radius] ?? 1),
    "--font-sans": findFont(a.font).family,
    ...DENSITY_VARS[a.density],
  };
  if (a.buttons === "accent") Object.assign(vars, { "--primary": vars["--acc-600"], "--primary-hover": vars["--acc-700"], "--primary-fg": vars["--acc-fg"] });
  else Object.assign(vars, { "--primary": vars["--srf-900"], "--primary-hover": vars["--srf-800"], "--primary-fg": "255 255 255" });
  if (a.contrast === "high") Object.assign(vars, { "--srf-400": rgbTriplet(srf[600]), "--srf-500": rgbTriplet(srf[700]), "--srf-200": rgbTriplet(srf[400]), "--srf-100": rgbTriplet(srf[200]) });
  return vars;
}

// `html:root` outranks the `:root` defaults of src/index.css whatever the
// order of the stylesheets.
export function computeAppearanceCss(a: Appearance): AppearanceCss {
  const acc = accentScale(a.accent);
  const srf = NEUTRAL_SCALES[a.neutral] ?? NEUTRAL_SCALES.zinc;
  const font = findFont(a.font);
  const root: Record<string, string> = {
    ...accentVars(acc),
    ...surfaceVars(srf),
    "--acc-fg": rgbTriplet(foregroundOn(acc[600], srf[900])),
    "--radius-scale": String(RADIUS_SCALE[a.radius] ?? 1),
    "--font-sans": font.family,
    ...DENSITY_VARS[a.density],
  };
  const rules = [block("html:root", root)];
  if (a.buttons === "accent") {
    rules.push(block("html:root", { "--primary": "var(--acc-600)", "--primary-hover": "var(--acc-700)", "--primary-fg": "var(--acc-fg)" }));
    rules.push(block("html:root.dark", { "--primary": "var(--acc-500)", "--primary-hover": "var(--acc-600)", "--primary-fg": rgbTriplet(foregroundOn(acc[500], srf[900])) }));
  }
  if (a.contrast === "high") {
    // Darker secondary text and borders in light mode, lighter in dark.
    rules.push(block("html:root:not(.dark)", { "--srf-400": rgbTriplet(srf[600]), "--srf-500": rgbTriplet(srf[700]), "--srf-200": rgbTriplet(srf[400]), "--srf-100": rgbTriplet(srf[200]) }));
    rules.push(block("html:root.dark", { "--srf-400": rgbTriplet(srf[200]), "--srf-500": rgbTriplet(srf[300]), "--srf-800": rgbTriplet(srf[600]), "--srf-700": rgbTriplet(srf[500]) }));
  }
  return {
    css: rules.filter(Boolean).join("\n"),
    attrs: { "data-density": a.density, "data-sidebar": a.sidebar, "data-contrast": a.contrast, "data-buttons": a.buttons, "data-radius": a.radius },
    fontHref: googleFontHref(a.font),
  };
}
