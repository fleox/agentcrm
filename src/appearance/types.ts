// Workspace appearance (doc `config/appearance`). Shared by every user of
// the workspace; the per-user light / dark choice stays per browser
// (localStorage "agentcrm.theme").

export const NEUTRALS = ["zinc", "slate", "stone", "gray", "neutral"] as const;
export type NeutralName = (typeof NEUTRALS)[number];

export const RADII = ["none", "sm", "md", "lg", "xl"] as const;
export type RadiusName = (typeof RADII)[number];

export const DENSITIES = ["compact", "comfortable"] as const;
export type DensityName = (typeof DENSITIES)[number];

export const SIDEBAR_STYLES = ["default", "dark", "accent"] as const;
export type SidebarStyle = (typeof SIDEBAR_STYLES)[number];

export const COLOR_MODES = ["system", "light", "dark"] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const CONTRASTS = ["normal", "high"] as const;
export type ContrastName = (typeof CONTRASTS)[number];

// Primary buttons: neutral (near-black / white, Twenty-like) or accent.
export const BUTTON_STYLES = ["neutral", "accent"] as const;
export type ButtonStyle = (typeof BUTTON_STYLES)[number];

export interface Appearance {
  // Preset the values came from ("default", "ocean"… or "custom").
  preset: string;
  // Accent color, "#rrggbb" (the 500 step of the generated scale).
  accent: string;
  neutral: NeutralName;
  radius: RadiusName;
  density: DensityName;
  // Font id (src/appearance/fonts.ts).
  font: string;
  sidebar: SidebarStyle;
  // Light / dark default for users who never toggled it.
  defaultMode: ColorMode;
  contrast: ContrastName;
  buttons: ButtonStyle;
  // Small image data URLs (≤ 200 KB).
  logo?: string;
  favicon?: string;
  // Extra CSS appended after everything (≤ 50 KB).
  customCss?: string;
  // Selected external theme (extension of kind "theme").
  themeId?: string;
}

// What is stored: only explicit values (resolved over the defaults and
// the selected external theme).
export interface AppearanceDoc extends Partial<Appearance> {
  id: "appearance";
  updatedAt?: number;
  updatedBy?: string;
}

export type AppearancePatch = { [K in keyof Appearance]?: Appearance[K] | null };

export interface AppearancePreset {
  id: string;
  name: string;
  description: string;
  values: Partial<Appearance>;
}

// Theme package (extension of kind "theme", `defineTheme`).
export interface ThemeDefinition {
  id: string;
  apiVersion: string;
  name: string;
  description?: string;
  appearance: Partial<Appearance>;
  // Extra CSS injected while the theme is selected.
  css?: string;
}

export const APPEARANCE_DOC_ID = "appearance";
export const MAX_IMAGE_BYTES = 200 * 1024;
export const MAX_CUSTOM_CSS = 50 * 1024;
export const DEFAULT_ACCENT = "#3366ff";
