// Dashboard + reports (owned by the admin UI agent).
import { createElement } from "react";
import { BarChart3, LayoutDashboard } from "lucide-react";
import type { Feature } from "../types";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";
import { DashboardPage } from "./DashboardPage";
import { ReportsPage } from "./ReportsPage";

const feature: Feature = {
  id: "dashboard",
  routes: [
    { path: "/", element: createElement(DashboardPage) },
    { path: "/reports", element: createElement(ReportsPage) },
  ],
  navItems: [
    { id: "dashboard", label: "dashboard:nav.dashboard", icon: LayoutDashboard, to: "/", section: "main", order: 0 },
    { id: "reports", label: "dashboard:nav.reports", icon: BarChart3, to: "/reports", section: "workspace", order: 30 },
  ],
  i18n: { en, fr },
};

export default feature;
