// Settings shell: vertical section nav (lg) / top tabs (smaller screens)
// + content. Built-in sections live in ./sections; other features add
// theirs through the `settingsSections` slot (routed to /settings/<id>).

import type { ComponentType } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Database, Download, GitBranch, Settings, SlidersHorizontal, Upload, Users, type LucideIcon } from "lucide-react";
import { PageHeader, Tabs } from "../../components/ui";
import { useAuth } from "../../app/AuthContext";
import { useModuleEnabled, useSlot } from "../../app/featureRegistry";
import { paths } from "../../app/paths";
import type { UserRole } from "../../core/types";
import { cn } from "../../shared/lib/utils";
import { GeneralSection } from "./sections/GeneralSection";
import { DataModelSection } from "./sections/DataModelSection";
import { PipelinesSection } from "./sections/PipelinesSection";
import { UsersSection } from "./sections/UsersSection";
import { ImportSection } from "./sections/ImportSection";
import { ExportSection } from "./sections/ExportSection";
import { DangerZoneSection } from "./sections/DangerZoneSection";

interface NavEntry {
  id: string;
  label: string;
  icon?: LucideIcon;
  component: ComponentType;
  group: "workspace" | "data" | "extra" | "danger";
}

const BUILT_IN: (Omit<NavEntry, "label"> & { labelKey: string; roles?: UserRole[]; module?: string })[] = [
  { id: "general", labelKey: "nav.general", icon: SlidersHorizontal, component: GeneralSection, group: "workspace" },
  { id: "users", labelKey: "nav.users", icon: Users, component: UsersSection, group: "workspace" },
  { id: "data-model", labelKey: "nav.dataModel", icon: Database, component: DataModelSection, group: "data" },
  { id: "pipelines", labelKey: "nav.pipelines", icon: GitBranch, component: PipelinesSection, group: "data", module: "deals" },
  { id: "import", labelKey: "nav.import", icon: Upload, component: ImportSection, group: "data" },
  { id: "export", labelKey: "nav.export", icon: Download, component: ExportSection, group: "data" },
  { id: "danger", labelKey: "nav.danger", icon: AlertTriangle, component: DangerZoneSection, group: "danger", roles: ["admin"] },
];

export function SettingsPage() {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation();
  const { section = "general" } = useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const dealsOn = useModuleEnabled("deals");

  const builtIn: NavEntry[] = BUILT_IN.filter((s) => (!s.roles || s.roles.includes(role)) && (s.module !== "deals" || dealsOn)).map((s) => ({ id: s.id, label: t(s.labelKey), icon: s.icon, component: s.component, group: s.group }));
  const extra: NavEntry[] = useSlot("settingsSections")
    .filter((s) => !s.roles || s.roles.includes(role))
    .filter((s) => !builtIn.some((b) => b.id === s.id))
    .map((s) => ({ id: s.id, label: tc(s.label), icon: s.icon, component: s.component, group: s.group ?? ("extra" as const) }));
  const entries = [...builtIn.filter((e) => e.group !== "danger"), ...extra, ...builtIn.filter((e) => e.group === "danger")];
  // Keep the group order (workspace, data, more, danger) for the top tabs too.
  const active = entries.find((e) => e.id === section) ?? entries[0];
  const Active = active.component;
  const go = (id: string) => navigate(paths.settings(id === "general" ? undefined : id));

  const groups: { id: NavEntry["group"]; label: string }[] = [
    { id: "workspace", label: t("nav.groupWorkspace") },
    { id: "data", label: t("nav.groupData") },
    { id: "extra", label: t("nav.groupMore") },
    { id: "danger", label: "" },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader title={t("title")} icon={<Settings />} description={active.label}>
        <Tabs
          className="-mb-3 mt-2 border-b-0 lg:hidden"
          tabs={entries.map((e) => ({ id: e.id, label: e.label, icon: e.icon ? <e.icon /> : undefined }))}
          value={active.id}
          onChange={go}
        />
      </PageHeader>
      <div className="flex min-h-0 flex-1">
        <nav aria-label={t("title")} className="hidden w-56 shrink-0 border-r border-surface-200 bg-surface-50/60 px-2 py-4 lg:block dark:border-surface-800 dark:bg-surface-950">
          {groups.map((g) => {
            const items = entries.filter((e) => e.group === g.id);
            if (!items.length) return null;
            return (
              <div key={g.id} className="mb-4">
                {g.label && <div className="mb-1 px-2 text-2xs font-medium uppercase tracking-wide text-surface-400">{g.label}</div>}
                <ul className="space-y-0.5">
                  {items.map((e) => {
                    const Icon = e.icon;
                    const isActive = e.id === active.id;
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => go(e.id)}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60",
                            isActive ? "bg-white font-medium text-surface-900 shadow-sm dark:bg-surface-800 dark:text-white" : "text-surface-600 hover:bg-surface-100 hover:text-surface-900 dark:text-surface-300 dark:hover:bg-surface-800/60",
                            e.group === "danger" && !isActive && "text-red-600 dark:text-red-400",
                          )}
                        >
                          {Icon && <Icon className="h-4 w-4 shrink-0 opacity-80" />}
                          <span className="truncate">{e.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
        <main className="min-w-0 flex-1 p-4 sm:p-6" data-testid={`settings-section-${active.id}`}>
          <Active />
        </main>
      </div>
    </div>
  );
}
