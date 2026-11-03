// Reports module: the /reports page (charts + tables + CSV exports). The
// page and its charts live in features/dashboard (shared code); this
// feature only owns the route and the nav entry so the module can be
// switched off on its own (Settings → Modules).
import { createElement } from "react";
import { BarChart3 } from "lucide-react";
import type { Feature } from "../types";
import { moduleMeta } from "../../core/modules";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";
import { ReportsPage } from "../dashboard/ReportsPage";

const feature: Feature = {
  id: "reports",
  module: moduleMeta("reports"),
  routes: [{ path: "/reports", element: createElement(ReportsPage) }],
  navItems: [{ id: "reports", label: "reports:nav.title", icon: BarChart3, to: "/reports", section: "workspace", order: 30 }],
  i18n: { en, fr },
};

export default feature;
