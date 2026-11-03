// DOM side of the appearance engine: writes the computed stylesheet, the
// <html> attributes, the Google font <link>, the theme / custom CSS, the
// favicon, and the anti-FOUC cache read by the inline script of
// index.html (localStorage "agentcrm.appearance"). Safe to import in Node
// (every DOM access is guarded).

import { computeAppearanceCss } from "./css";
import { DEFAULT_APPEARANCE } from "./schema";
import { MAX_CUSTOM_CSS, type Appearance, type ColorMode, type ThemeDefinition } from "./types";

export const APPEARANCE_CACHE_KEY = "agentcrm.appearance";
export const THEME_KEY = "agentcrm.theme";
export const STYLE_IDS = { appearance: "agentcrm-appearance", theme: "agentcrm-theme-css", custom: "agentcrm-custom-css", font: "agentcrm-font" } as const;

// What the inline script of index.html applies before the first paint.
export interface AppearanceCache {
  v: 1;
  css: string;
  attrs: Record<string, string>;
  fontHref: string | null;
  themeCss?: string;
  customCss?: string;
  favicon?: string;
  defaultMode: ColorMode;
}

export function buildAppearanceCache(a: Appearance, theme?: ThemeDefinition | null): AppearanceCache {
  const { css, attrs, fontHref } = computeAppearanceCss(a);
  return {
    v: 1,
    css,
    attrs,
    fontHref,
    ...(theme?.css ? { themeCss: theme.css.slice(0, MAX_CUSTOM_CSS * 2) } : {}),
    ...(a.customCss ? { customCss: a.customCss.slice(0, MAX_CUSTOM_CSS) } : {}),
    ...(a.favicon ? { favicon: a.favicon } : {}),
    defaultMode: a.defaultMode,
  };
}

let applied: Appearance = DEFAULT_APPEARANCE;
const listeners = new Set<() => void>();

export function getAppliedAppearance(): Appearance {
  return applied;
}

export function subscribeAppliedAppearance(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function styleEl(doc: Document, id: string): HTMLStyleElement {
  let el = doc.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement("style");
    el.id = id;
    doc.head.appendChild(el);
  }
  return el;
}

function setStyle(doc: Document, id: string, css: string | undefined): void {
  if (!css) {
    doc.getElementById(id)?.remove();
    return;
  }
  const el = styleEl(doc, id);
  if (el.textContent !== css) el.textContent = css;
}

function setFont(doc: Document, href: string | null): void {
  const current = doc.getElementById(STYLE_IDS.font) as HTMLLinkElement | null;
  if (!href) {
    current?.remove();
    return;
  }
  if (current?.getAttribute("href") === href) return;
  const link = current ?? doc.createElement("link");
  link.id = STYLE_IDS.font;
  link.rel = "stylesheet";
  link.href = href;
  if (!current) doc.head.appendChild(link);
}

function setFavicon(doc: Document, href: string | undefined): void {
  const link = doc.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  if (!link) return;
  if (!link.dataset.defaultHref) link.dataset.defaultHref = link.getAttribute("href") ?? "";
  const next = href ?? link.dataset.defaultHref;
  if (link.getAttribute("href") !== next) {
    link.setAttribute("href", next);
    if (href) link.removeAttribute("type");
    else link.setAttribute("type", "image/svg+xml");
  }
}

function storedTheme(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

export function modeIsDark(mode: ColorMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

// Applies the default light / dark mode unless this browser chose one.
function applyDefaultMode(doc: Document, mode: ColorMode): void {
  const stored = storedTheme();
  if (stored === "dark" || stored === "light") return;
  doc.documentElement.classList.toggle("dark", modeIsDark(mode));
}

export function applyAppearanceCache(cache: AppearanceCache, doc: Document = document): void {
  setStyle(doc, STYLE_IDS.appearance, cache.css);
  for (const [k, v] of Object.entries(cache.attrs)) doc.documentElement.setAttribute(k, v);
  setFont(doc, cache.fontHref);
  setStyle(doc, STYLE_IDS.theme, cache.themeCss);
  setStyle(doc, STYLE_IDS.custom, cache.customCss);
  // Theme then custom CSS always come last (after the app stylesheet).
  for (const id of [STYLE_IDS.theme, STYLE_IDS.custom]) {
    const el = doc.getElementById(id);
    if (el) doc.head.appendChild(el);
  }
  setFavicon(doc, cache.favicon);
  applyDefaultMode(doc, cache.defaultMode);
}

export function applyAppearance(a: Appearance, opts: { theme?: ThemeDefinition | null; persist?: boolean } = {}): void {
  const cache = buildAppearanceCache(a, opts.theme);
  if (typeof document !== "undefined") applyAppearanceCache(cache);
  if (opts.persist !== false) {
    try {
      localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Not cached: next boot paints the default first.
    }
  }
  if (JSON.stringify(applied) !== JSON.stringify(a)) {
    applied = a;
    for (const l of [...listeners]) l();
  }
}

export function readAppearanceCache(): AppearanceCache | null {
  try {
    const raw = localStorage.getItem(APPEARANCE_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as AppearanceCache) : null;
    return parsed && parsed.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

// Current pixel height of a data-grid row (density), for virtualisation.
export function rowHeightPx(): number {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return 33;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--row-h").trim();
  const rem = /^([\d.]+)rem$/.exec(raw);
  const px = /^([\d.]+)px$/.exec(raw);
  const base = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const h = rem ? parseFloat(rem[1]) * base : px ? parseFloat(px[1]) : 32;
  // + 1px bottom border.
  return Math.round(h) + 1;
}
