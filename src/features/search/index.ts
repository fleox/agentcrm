// Search / command palette (owned by the admin UI agent). PLACEHOLDER: a
// basic Cmd+K palette over records + navigation, mounted as a global
// overlay and opened by the "search.open" shell event.
import type { Feature } from "../types";
import { moduleMeta } from "../../core/modules";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";
import { CommandPalette } from "./CommandPalette";

const feature: Feature = {
  id: "search",
  module: moduleMeta("search"),
  routes: [],
  i18n: { en, fr },
  slots: { globalOverlays: [CommandPalette] },
};

export default feature;
