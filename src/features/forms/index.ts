// Forms feature (owned by the automations / forms / integrations agent).
// PLACEHOLDER page — replace freely inside this folder. Engine contract:
// src/ops/forms.ts.
import { createElement } from "react";
import { FileInput } from "lucide-react";
import type { Feature } from "../types";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";
import { FormsPage } from "./FormsPage";

const feature: Feature = {
  id: "forms",
  routes: [{ path: "/forms", element: createElement(FormsPage) }],
  navItems: [{ id: "forms", label: "forms:nav.title", icon: FileInput, to: "/forms", section: "workspace", order: 20, roles: ["admin", "member"] }],
  i18n: { en, fr },
};

export default feature;
