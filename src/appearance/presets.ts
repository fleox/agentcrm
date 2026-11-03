// Built-in appearance presets. A preset is a full set of values (applying
// one replaces the workspace's colors / shape; logo, favicon and custom
// CSS are kept).

import type { AppearancePreset } from "./types";
import { DEFAULT_ACCENT } from "./types";

export const PRESETS: readonly AppearancePreset[] = [
  {
    id: "default",
    name: "Default",
    description: "Neutral grays, blue accent, near-black buttons.",
    values: { accent: DEFAULT_ACCENT, neutral: "zinc", radius: "md", density: "comfortable", font: "system", sidebar: "default", contrast: "normal", buttons: "neutral" },
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Cool slate grays with a teal-blue accent.",
    values: { accent: "#0891b2", neutral: "slate", radius: "lg", density: "comfortable", font: "system", sidebar: "default", contrast: "normal", buttons: "accent" },
  },
  {
    id: "forest",
    name: "Forest",
    description: "Warm stone grays with a deep green accent and a dark sidebar.",
    values: { accent: "#16a34a", neutral: "stone", radius: "md", density: "comfortable", font: "system", sidebar: "dark", contrast: "normal", buttons: "accent" },
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "Orange accent, soft rounded corners.",
    values: { accent: "#ea580c", neutral: "stone", radius: "xl", density: "comfortable", font: "system", sidebar: "default", contrast: "normal", buttons: "accent" },
  },
  {
    id: "graphite",
    name: "Graphite",
    description: "Monochrome, compact, dark sidebar — dense data work.",
    values: { accent: "#52525b", neutral: "neutral", radius: "sm", density: "compact", font: "system", sidebar: "dark", contrast: "normal", buttons: "neutral" },
  },
  {
    id: "rose",
    name: "Rose",
    description: "Rose accent with a colored sidebar.",
    values: { accent: "#e11d48", neutral: "zinc", radius: "lg", density: "comfortable", font: "system", sidebar: "accent", contrast: "normal", buttons: "accent" },
  },
  {
    id: "high-contrast",
    name: "High contrast",
    description: "Stronger borders and text, square corners — accessibility first.",
    values: { accent: "#1d4ed8", neutral: "gray", radius: "sm", density: "comfortable", font: "system", sidebar: "default", contrast: "high", buttons: "neutral" },
  },
];

export function findPreset(id: string): AppearancePreset | undefined {
  return PRESETS.find((p) => p.id === id);
}
