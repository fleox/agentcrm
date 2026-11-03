// Tasks (owned by the admin UI agent). PLACEHOLDER page.
import { createElement } from "react";
import { CheckSquare } from "lucide-react";
import type { Feature } from "../types";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";
import { TasksPage, useOpenTaskCount } from "./TasksPage";

const feature: Feature = {
  id: "tasks",
  routes: [{ path: "/tasks", element: createElement(TasksPage) }],
  navItems: [{ id: "tasks", label: "tasks:nav.title", icon: CheckSquare, to: "/tasks", section: "main", order: 10, useBadge: useOpenTaskCount }],
  i18n: { en, fr },
};

export default feature;
