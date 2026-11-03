// Dashboard (home page). The reports page code lives here too
// (./ReportsPage, shared charts) but its route / nav belong to the
// `reports` module (features/reports).
import { createElement } from "react";
import { LayoutDashboard } from "lucide-react";
import type { Feature } from "../types";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";
import { DashboardPage } from "./DashboardPage";
import { moduleMeta } from "../../core/modules";

const feature: Feature = {
  id: "dashboard",
  module: moduleMeta("dashboard"),
  routes: [{ path: "/", element: createElement(DashboardPage) }],
  navItems: [{ id: "dashboard", label: "dashboard:nav.dashboard", icon: LayoutDashboard, to: "/", section: "main", order: 0 }],
  i18n: { en, fr },
};

export default feature;
