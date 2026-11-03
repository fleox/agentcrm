// Customisation (v0.2): Settings → Modules (built-in modules + installed
// extensions, install from ZIP, per-module settings pages) and Settings →
// Appearance (presets, accent, neutral, radius, density, font, sidebar,
// default mode, logo / favicon, custom CSS, external themes). Engines:
// src/ops/{modules,extensions,appearance}.ts, src/extensions/,
// src/appearance/. Admins edit; everyone else sees read-only.
import { Blocks, Palette } from "lucide-react";
import type { Feature } from "../types";
import { moduleMeta } from "../../core/modules";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";
import { ModulesSection } from "./ModulesSection";
import { AppearanceSection } from "./AppearanceSection";

const feature: Feature = {
  id: "customize",
  module: moduleMeta("customize"),
  routes: [],
  i18n: { en, fr },
  slots: {
    settingsSections: [
      { id: "modules", label: "customize:sections.modules", icon: Blocks, order: 20, group: "workspace", component: ModulesSection },
      { id: "appearance", label: "customize:sections.appearance", icon: Palette, order: 21, group: "workspace", component: AppearanceSection },
    ],
  },
};

export default feature;
