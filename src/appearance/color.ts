// Color math for the appearance engine: hex ↔ sRGB ↔ OKLCH and the
// generation of a Tailwind-like 50…950 scale from one accent color.
// Pure functions (no DOM).

export type Rgb = [number, number, number]; // 0–255
export type Oklch = { l: number; c: number; h: number };

export const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type ScaleStep = (typeof SCALE_STEPS)[number];
export type ColorScale = Record<ScaleStep, string>; // "#rrggbb"

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value.trim());
}

export function normalizeHex(value: string): string {
  const m = HEX_RE.exec(value.trim());
  if (!m) throw new Error(`"${value}" is not a hex color (#rrggbb).`);
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h}`;
}

export function hexToRgb(hex: string): Rgb {
  const h = normalizeHex(hex).slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

// "r g b" — the format of the CSS variables (rgb(var(--x) / <alpha>)).
export function rgbTriplet(hex: string): string {
  return hexToRgb(hex).join(" ");
}

const toLinear = (v: number) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255;

function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const [L, A, B] = linearToOklab(r, g, b);
  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  return oklabToLinear(l, c * Math.cos(rad), c * Math.sin(rad));
}

function inGamut(lin: [number, number, number]): boolean {
  return lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
}

// Converts to sRGB, reducing chroma until the color fits the gamut.
export function oklchToHex(color: Oklch): string {
  let lin = oklchToLinear(color);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = color.c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...color, c: mid }))) lo = mid;
      else hi = mid;
    }
    lin = oklchToLinear({ ...color, c: lo });
  }
  return rgbToHex(lin.map((v) => fromLinear(Math.min(1, Math.max(0, v)))) as Rgb);
}

// Lighter steps move toward L_MAX, darker ones toward L_MIN (fraction of
// the distance from the 500 step); chroma follows a bell curve.
const L_MAX = 0.975;
const L_MIN = 0.2;
const LIGHTER: Partial<Record<ScaleStep, number>> = { 50: 0.95, 100: 0.88, 200: 0.75, 300: 0.55, 400: 0.3 };
const DARKER: Partial<Record<ScaleStep, number>> = { 600: 0.17, 700: 0.34, 800: 0.5, 900: 0.64, 950: 0.8 };
const CHROMA: Record<ScaleStep, number> = { 50: 0.12, 100: 0.25, 200: 0.45, 300: 0.7, 400: 0.9, 500: 1, 600: 1, 700: 0.92, 800: 0.8, 900: 0.68, 950: 0.55 };

// A 50…950 scale whose 500 step is exactly `hex`.
export function generateScale(hex: string): ColorScale {
  const base = normalizeHex(hex);
  const { l, c, h } = hexToOklch(base);
  const out = {} as ColorScale;
  for (const step of SCALE_STEPS) {
    if (step === 500) {
      out[step] = base;
      continue;
    }
    const up = LIGHTER[step];
    const down = DARKER[step];
    const L = up !== undefined ? l + (Math.max(L_MAX, l) - l) * up : l - (l - Math.min(L_MIN, l)) * (down ?? 0);
    out[step] = oklchToHex({ l: L, c: c * CHROMA[step], h });
  }
  return out;
}

// WCAG relative luminance (0–1).
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// Readable text color on top of `bg` (white unless it's too light).
export function foregroundOn(bg: string, dark = "#18181b"): string {
  return contrastRatio(bg, "#ffffff") >= 3 ? "#ffffff" : dark;
}

export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as Rgb);
}
