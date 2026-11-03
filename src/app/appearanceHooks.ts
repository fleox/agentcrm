// React bindings of the appearance engine (src/appearance/).

import { useSyncExternalStore } from "react";
import { getAppliedAppearance, rowHeightPx, subscribeAppliedAppearance } from "../appearance/apply";
import type { Appearance } from "../appearance/types";

// The appearance currently applied to the page (live).
export function useAppliedAppearance(): Appearance {
  return useSyncExternalStore(subscribeAppliedAppearance, getAppliedAppearance, getAppliedAppearance);
}

// Pixel height of a data-grid row for the current density (+ border).
export function useRowHeight(): number {
  useAppliedAppearance();
  return rowHeightPx();
}
