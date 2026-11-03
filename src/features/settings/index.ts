// Settings (owned by the admin UI agent; the backend agent contributes the
// data backend / hosting / users & roles sections). PLACEHOLDER page that
// already renders the `settingsSections` slot of every feature.
import { createElement } from "react";
import { Settings } from "lucide-react";
import type { Feature } from "../types";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";
import { SettingsPage } from "./SettingsPage";

const feature: Feature = {
  id: "settings",
  routes: [
    { path: "/settings", element: createElement(SettingsPage) },
    { path: "/settings/:section", element: createElement(SettingsPage) },
  ],
  navItems: [{ id: "settings", label: "settings:nav.title", icon: Settings, to: "/settings", section: "bottom", order: 100 }],
  i18n: { en, fr },
};

export default feature;
