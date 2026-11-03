// Color tokens (core/fields.ts OPTION_COLORS) → Tailwind classes. Classes
// are spelled out in full so Tailwind's scanner keeps them.
import type { OptionColor } from "../../core/fields";

export const CHIP_CLASSES: Record<OptionColor, string> = {
  gray: "bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-200",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
  yellow: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200",
  red: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200",
  purple: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200",
  pink: "bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-200",
  teal: "bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-200",
  indigo: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200",
};

export const DOT_CLASSES: Record<OptionColor, string> = {
  gray: "bg-surface-400",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  purple: "bg-violet-500",
  pink: "bg-pink-500",
  teal: "bg-teal-500",
  indigo: "bg-indigo-500",
};

// Hex values for charts (recharts needs real colors).
export const CHART_COLORS: Record<OptionColor, string> = {
  gray: "#a1a1aa",
  blue: "#3b82f6",
  green: "#10b981",
  yellow: "#f59e0b",
  orange: "#f97316",
  red: "#ef4444",
  purple: "#8b5cf6",
  pink: "#ec4899",
  teal: "#14b8a6",
  indigo: "#6366f1",
};

export function chipClass(color: string | undefined): string {
  return CHIP_CLASSES[(color as OptionColor) in CHIP_CLASSES ? (color as OptionColor) : "gray"];
}

export function dotClass(color: string | undefined): string {
  return DOT_CLASSES[(color as OptionColor) in DOT_CLASSES ? (color as OptionColor) : "gray"];
}

export function chartColor(color: string | undefined): string {
  return CHART_COLORS[(color as OptionColor) in CHART_COLORS ? (color as OptionColor) : "gray"];
}
