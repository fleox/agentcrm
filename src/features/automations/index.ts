// Automations feature (owned by the automations / forms / integrations agent).
// PLACEHOLDER page — replace freely inside this folder. Engine contract:
// src/ops/automations.ts.
import { createElement } from "react";
import { Zap } from "lucide-react";
import type { Feature } from "../types";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";
import { AutomationsPage } from "./AutomationsPage";

const feature: Feature = {
  id: "automations",
  routes: [{ path: "/automations", element: createElement(AutomationsPage) }],
  navItems: [{ id: "automations", label: "automations:nav.title", icon: Zap, to: "/automations", section: "workspace", order: 10, roles: ["admin", "member"] }],
  i18n: { en, fr },
};

export default feature;
