// In-memory registry of the external themes loaded by the extension
// loader (src/extensions/loader.ts). The appearance engine resolves the
// workspace's `themeId` against it.

import type { ThemeDefinition } from "./types";

const themes = new Map<string, ThemeDefinition>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version++;
  for (const l of [...listeners]) l();
}

export function registerExternalTheme(theme: ThemeDefinition): () => void {
  themes.set(theme.id, theme);
  notify();
  return () => {
    if (themes.get(theme.id) === theme) {
      themes.delete(theme.id);
      notify();
    }
  };
}

export function getExternalTheme(id: string | undefined): ThemeDefinition | undefined {
  return id ? themes.get(id) : undefined;
}

export function listExternalThemes(): ThemeDefinition[] {
  return [...themes.values()];
}

export function subscribeExternalThemes(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function externalThemesVersion(): number {
  return version;
}
