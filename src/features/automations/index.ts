// Automations feature: list (enable toggle, last run), editor (trigger,
// conditions, actions, dry run on a record), run log, templates gallery,
// dashboard widget. Engine: src/ops/automations.ts.
//
// Runtime: onStart installs the event engine on the process-wide plugin
// registry (record.created / record.updated / stage.changed emitted by
// src/ops/), and AutomationsRuntime (global overlay) runs the scheduled
// triggers every 5 minutes in one leader tab while the admin is open.
import { createElement } from "react";
import { Zap } from "lucide-react";
import type { Feature } from "../types";
import en from "./i18n/en.json";
import fr from "./i18n/fr.json";
import { installAutomations } from "../../ops/automations";
import { AutomationsPage } from "./AutomationsPage";
import { AutomationEditorPage } from "./AutomationEditor";
import { RunLogPage } from "./RunLogPage";
import { TemplatesPage } from "./TemplatesPage";
import { RecentRunsWidget } from "./RecentRunsWidget";
import { AutomationsRuntime } from "./AutomationsRuntime";

const roles: ("admin" | "member")[] = ["admin", "member"];

const feature: Feature = {
  id: "automations",
  routes: [
    { path: "/automations", element: createElement(AutomationsPage), roles },
    { path: "/automations/runs", element: createElement(RunLogPage), roles },
    { path: "/automations/templates", element: createElement(TemplatesPage), roles },
    { path: "/automations/:automationId", element: createElement(AutomationEditorPage), roles },
  ],
  navItems: [{ id: "automations", label: "automations:nav.title", icon: Zap, to: "/automations", section: "workspace", order: 10, roles }],
  i18n: { en, fr },
  slots: {
    globalOverlays: [AutomationsRuntime],
    dashboardWidgets: [{ id: "automation-runs", order: 60, span: 6, component: RecentRunsWidget }],
  },
  onStart: () => installAutomations(),
};

export default feature;
