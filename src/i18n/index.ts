// i18n setup. Pure i18next (no React here — the app wraps the tree in
// <I18nextProvider>, so src/shared/ connectors, src/ops/ and the CLI can
// import translations without pulling React in).
//
// Core strings live in the default namespace ("translation", en.json /
// fr.json). Each feature ships its own namespace (features/<id>/i18n/)
// registered at runtime by registerI18nNamespace() — `t("records:…")`.
// English is the source of truth.

import i18n from "i18next";
import en from "./en.json";
import fr from "./fr.json";

export const SUPPORTED_LOCALES = ["en", "fr"] as const;
export type AdminLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AdminLocale = "en";
const STORAGE_KEY = "agentcrm.locale";

export const LOCALE_LABELS: Record<AdminLocale, string> = {
  en: "English",
  fr: "Français",
};

export function isSupportedLocale(value: unknown): value is AdminLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function resolveInitialLocale(preferred?: string | null): AdminLocale {
  if (isSupportedLocale(preferred)) return preferred;
  try {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (isSupportedLocale(stored)) return stored;
  } catch {
    // Storage blocked.
  }
  if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
    const prefix = navigator.language.split("-")[0]?.toLowerCase();
    if (isSupportedLocale(prefix)) return prefix;
  }
  return DEFAULT_LOCALE;
}

void i18n.init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: resolveInitialLocale(),
  fallbackLng: DEFAULT_LOCALE,
  defaultNS: "translation",
  interpolation: { escapeValue: false },
  returnNull: false,
  initImmediate: false,
  react: { useSuspense: false },
});

export type NamespaceBundles = { en: Record<string, unknown>; fr?: Record<string, unknown> };

// Registers a feature namespace (deep-merged, so calling it twice is safe).
export function registerI18nNamespace(ns: string, bundles: NamespaceBundles): void {
  i18n.addResourceBundle("en", ns, bundles.en, true, true);
  if (bundles.fr) i18n.addResourceBundle("fr", ns, bundles.fr, true, true);
}

export async function setActiveLocale(locale: AdminLocale): Promise<void> {
  if (!isSupportedLocale(locale)) return;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Won't survive a reload.
  }
  await i18n.changeLanguage(locale);
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

export function activeLocale(): AdminLocale {
  return isSupportedLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
}

// BCP-47 tag for Intl formatting of the active locale.
export function intlLocale(): string {
  return activeLocale() === "fr" ? "fr-FR" : "en-US";
}

export default i18n;
