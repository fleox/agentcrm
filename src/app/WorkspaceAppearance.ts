// Applies the workspace appearance (config/appearance + the selected
// external theme) to the page, live: every user sees an admin's change
// as soon as the store syncs.

import { useEffect, useSyncExternalStore } from "react";
import { applyAppearance, externalThemesVersion, getExternalTheme, resolveAppearance, subscribeExternalThemes, type AppearanceDoc } from "../appearance";
import type { ExtensionDoc } from "../extensions/types";
import { useCollection, useConfigDoc } from "./CrmDataContext";

export function useWorkspaceAppearance(): void {
  const doc = useConfigDoc<AppearanceDoc>("appearance");
  const extensions = useCollection<ExtensionDoc>("extensions");
  const themes = useSyncExternalStore(subscribeExternalThemes, externalThemesVersion, externalThemesVersion);
  useEffect(() => {
    const themeId = doc?.themeId;
    const enabled = !!themeId && extensions.some((e) => e.id === themeId && e.kind === "theme" && e.enabled);
    const theme = enabled ? getExternalTheme(themeId) ?? null : null;
    applyAppearance(resolveAppearance(doc, theme), { theme });
  }, [doc, extensions, themes]);
}
