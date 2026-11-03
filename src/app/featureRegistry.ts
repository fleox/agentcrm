// Holds the features of this build (registered once by main.tsx from
// src/features/index.ts) and aggregates their routes, nav items and
// slots. Kept separate from src/features/index.ts so feature code can
// read slots without an import cycle.

import { registerI18nNamespace } from "../i18n";
import type { Feature, FeatureSlots, SlotName } from "../features/types";

let features: Feature[] = [];

export function registerFeatures(list: Feature[]): void {
  features = list;
  for (const f of list) registerI18nNamespace(f.id, f.i18n);
}

export function getFeatures(): Feature[] {
  return features;
}

export function getFeature(id: string): Feature | undefined {
  return features.find((f) => f.id === id);
}

type SlotItem<K extends SlotName> = NonNullable<FeatureSlots[K]> extends Array<infer T> ? T : NonNullable<FeatureSlots[K]>;

// Every feature's contributions to a slot, ordered by `order` when present.
export function getSlot<K extends SlotName>(name: K): SlotItem<K>[] {
  const out: SlotItem<K>[] = [];
  for (const f of features) {
    const v = f.slots?.[name];
    if (v === undefined) continue;
    if (Array.isArray(v)) out.push(...(v as SlotItem<K>[]));
    else out.push(v as SlotItem<K>);
  }
  return out.sort((a, b) => ((a as { order?: number }).order ?? 100) - ((b as { order?: number }).order ?? 100));
}

// React-friendly alias (the registry is static after boot).
export const useSlot = getSlot;
