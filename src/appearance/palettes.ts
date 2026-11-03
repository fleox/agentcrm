// Neutral ("surface") scales and the exact default accent scale. The
// `zinc` scale and DEFAULT_ACCENT_SCALE are the values the Tailwind config
// used before v0.2 (so the default appearance is pixel-identical); the
// others are Tailwind's palettes with an interpolated 850 and a slightly
// lifted 950 (the app background in dark mode).

import { DEFAULT_ACCENT, type NeutralName } from "./types";
import { mixHex, type ColorScale } from "./color";

export const SURFACE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 850, 900, 950] as const;
export type SurfaceStep = (typeof SURFACE_STEPS)[number];
export type SurfaceScale = Record<SurfaceStep, string>;

type Base = Omit<SurfaceScale, 850 | 950> & { 950: string };

function surface(base: Base, lift = 0.45): SurfaceScale {
  return { ...base, 850: mixHex(base[800], base[900], 0.5), 950: mixHex(base[950], base[900], lift) };
}

export const NEUTRAL_SCALES: Record<NeutralName, SurfaceScale> = {
  zinc: {
    50: "#fafafa",
    100: "#f4f4f5",
    200: "#e4e4e7",
    300: "#d4d4d8",
    400: "#a1a1aa",
    500: "#71717a",
    600: "#52525b",
    700: "#3f3f46",
    800: "#27272a",
    850: "#1f1f22",
    900: "#18181b",
    950: "#0f0f11",
  },
  slate: surface({ 50: "#f8fafc", 100: "#f1f5f9", 200: "#e2e8f0", 300: "#cbd5e1", 400: "#94a3b8", 500: "#64748b", 600: "#475569", 700: "#334155", 800: "#1e293b", 900: "#0f172a", 950: "#020617" }),
  stone: surface({ 50: "#fafaf9", 100: "#f5f5f4", 200: "#e7e5e4", 300: "#d6d3d1", 400: "#a8a29e", 500: "#78716c", 600: "#57534e", 700: "#44403c", 800: "#292524", 900: "#1c1917", 950: "#0c0a09" }),
  gray: surface({ 50: "#f9fafb", 100: "#f3f4f6", 200: "#e5e7eb", 300: "#d1d5db", 400: "#9ca3af", 500: "#6b7280", 600: "#4b5563", 700: "#374151", 800: "#1f2937", 900: "#111827", 950: "#030712" }),
  neutral: surface({ 50: "#fafafa", 100: "#f5f5f5", 200: "#e5e5e5", 300: "#d4d4d4", 400: "#a3a3a3", 500: "#737373", 600: "#525252", 700: "#404040", 800: "#262626", 900: "#171717", 950: "#0a0a0a" }),
};

// Hand-tuned scale of DEFAULT_ACCENT (950 added in v0.2).
export const DEFAULT_ACCENT_SCALE: ColorScale = {
  50: "#eef4ff",
  100: "#dae6ff",
  200: "#bcd2ff",
  300: "#8eb4ff",
  400: "#598bff",
  500: "#3366ff",
  600: "#1f4ef5",
  700: "#173ce1",
  800: "#1a33b6",
  900: "#1b318f",
  950: "#141f57",
};

export { DEFAULT_ACCENT };
