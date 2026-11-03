// Settings → Modules: built-in modules + extension modules grouped by
// category (toggle with dependency checks), the "Installed extensions"
// tab, and the settings page of one module (/settings/modules/<id>).

import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, BookOpen, Settings2 } from "lucide-react";
import { Badge, Card, EmptyState, IconButton, Switch, Tabs, confirmDialog } from "../../components/ui";
import { useCan, useOps } from "../../app/CrmDataContext";
import { getAllFeatures, useFeatureRegistryVersion, useModuleStates } from "../../app/featureRegistry";
import { paths } from "../../app/paths";
import { MODULE_CATEGORIES } from "../../core/modules";
import { OpsError } from "../../ops/context";
import { setModuleEnabled, type ModuleInfo } from "../../ops/modules";
import { toast } from "../../shared/lib/toast";
import { cn } from "../../shared/lib/utils";
import { ExtensionsPanel } from "./ExtensionsPanel";
import { ReadOnlyNotice, SectionHeader } from "./common";
import { moduleIcon } from "./icons";

export const EXTENSIONS_DOCS_URL = "https://github.com/fleox/agentcrm/blob/master/docs/extensions.md";

export function useModuleName(): (m: Pick<ModuleInfo, "name" | "nameKey">) => string {
  const { t } = useTranslation();
  return (m) => (m.nameKey ? t(m.nameKey) : m.name);
}

export function ModulesSection() {
  const { sub } = useParams();
  const { t } = useTranslation("customize");
  const [tab, setTab] = useState<"modules" | "extensions">(sub === "extensions" ? "extensions" : "modules");
  if (sub && sub !== "extensions") return <ModuleSettingsPage moduleId={sub} />;
  return (
    <div className="max-w-4xl space-y-5">
      <SectionHeader title={t("modules.title")} description={t("modules.description")} />
      <Tabs
        tabs={[
          { id: "modules", label: t("modules.tabs.modules") },
          { id: "extensions", label: t("modules.tabs.extensions") },
        ]}
        value={tab}
        onChange={(id) => setTab(id as "modules" | "extensions")}
      />
      {tab === "modules" ? <ModulesList /> : <ExtensionsPanel />}
      <a href={EXTENSIONS_DOCS_URL} target="_blank" rel="noreferrer" className="flex items-start gap-3 rounded-lg border border-dashed border-surface-300 p-3 text-sm hover:border-surface-400 dark:border-surface-700">
        <span className="mt-0.5 text-surface-500 [&>svg]:h-4 [&>svg]:w-4">
          <BookOpen />
        </span>
        <span>
          <span className="font-medium text-surface-900 dark:text-white">{t("modules.docs")}</span>
          <span className="block text-xs text-surface-500">{t("modules.docsHint")}</span>
        </span>
      </a>
    </div>
  );
}

function ModulesList() {
  const { t } = useTranslation("customize");
  const modules = useModuleStates();
  const canEdit = useCan("modules.write");
  const groups = useMemo(() => MODULE_CATEGORIES.map((c) => ({ id: c, items: modules.filter((m) => m.category === c) })).filter((g) => g.items.length), [modules]);
  return (
    <div className="space-y-5" data-testid="modules-list">
      {!canEdit && <ReadOnlyNotice />}
      {groups.map((g) => (
        <section key={g.id}>
          <h3 className="mb-2 text-2xs font-medium uppercase tracking-wide text-surface-400">{t(`modules.categories.${g.id}`)}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {g.items.map((m) => (
              <ModuleCard key={m.id} module={m} modules={modules} canEdit={canEdit} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ModuleCard({ module: m, modules, canEdit }: { module: ModuleInfo; modules: ModuleInfo[]; canEdit: boolean }) {
  const { t } = useTranslation("customize");
  const ops = useOps();
  const navigate = useNavigate();
  const nameOf = useModuleName();
  const [busy, setBusy] = useState(false);
  useFeatureRegistryVersion();
  const Icon = moduleIcon(m.icon);
  const byId = new Map(modules.map((x) => [x.id, x]));
  const names = (ids: string[]) => ids.map((id) => (byId.get(id) ? nameOf(byId.get(id)!) : id)).join(", ");
  const name = nameOf(m);
  const description = m.descriptionKey ? t(m.descriptionKey) : m.description;
  const settingsTo = m.settingsSection ? paths.settings(m.settingsSection) : getAllFeatures().find((f) => f.id === m.id)?.settingsPage ? paths.settings(`modules/${m.id}`) : null;

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      try {
        await setModuleEnabled(ops, m.id, enabled);
      } catch (err) {
        if (!(err instanceof OpsError) || err.code !== "conflict") throw err;
        const blockers = ((err.details as { blockers?: string[] } | undefined)?.blockers ?? []) as string[];
        const ok = await confirmDialog({
          title: enabled ? t("modules.cascadeEnableTitle") : t("modules.cascadeDisableTitle"),
          description: enabled ? t("modules.cascadeEnableBody", { name, list: names(blockers) }) : t("modules.cascadeDisableBody", { name, list: names(blockers) }),
          confirmLabel: t("modules.cascadeConfirm"),
          danger: !enabled,
        });
        if (!ok) return;
        await setModuleEnabled(ops, m.id, enabled, { cascade: true });
      }
      toast.success(enabled ? t("modules.enabled", { name }) : t("modules.disabled", { name }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padded={false} className={cn("flex flex-col", !m.enabled && "bg-surface-50/70 dark:bg-surface-900/60")} data-module={m.id}>
      <div className="flex items-start gap-3 p-card">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg [&>svg]:h-4.5 [&>svg]:w-4.5", m.enabled ? "bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-300" : "bg-surface-100 text-surface-400 dark:bg-surface-800")}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("truncate text-sm font-semibold", m.enabled ? "text-surface-900 dark:text-white" : "text-surface-500")}>{name}</span>
            {m.required && <Badge color="gray">{t("modules.required")}</Badge>}
            {m.source === "extension" && <Badge color="purple">{m.version ? `${t("modules.extension")} · v${m.version}` : t("modules.extension")}</Badge>}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-surface-500">{description}</p>
          {m.dependsOn.length > 0 && <p className="mt-1.5 text-2xs text-surface-500">{t("modules.requires", { list: names(m.dependsOn) })}</p>}
          {m.dependents.length > 0 && <p className="mt-0.5 text-2xs text-surface-500">{t("modules.usedBy", { list: names(m.dependents) })}</p>}
          {!m.enabled && m.missingDependencies.length > 0 && <p className="mt-1.5 text-2xs font-medium text-amber-700 dark:text-amber-400">{t("modules.missing", { list: names(m.missingDependencies) })}</p>}
          {m.incompatible && <p className="mt-1.5 text-2xs font-medium text-red-600 dark:text-red-400">{t("modules.incompatible")}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {settingsTo && m.enabled && <IconButton size="sm" label={t("modules.settings")} icon={<Settings2 />} onClick={() => navigate(settingsTo)} />}
          <Switch checked={m.enabled} disabled={!canEdit || m.required || busy || (!m.enabled && !!m.incompatible)} label={<span className="sr-only">{m.enabled ? t("modules.disable", { name }) : t("modules.enable", { name })}</span>} onChange={(v) => void toggle(v)} />
        </div>
      </div>
    </Card>
  );
}

function ModuleSettingsPage({ moduleId }: { moduleId: string }) {
  const { t } = useTranslation("customize");
  const navigate = useNavigate();
  const nameOf = useModuleName();
  useFeatureRegistryVersion();
  const modules = useModuleStates();
  const m = modules.find((x) => x.id === moduleId);
  const feature = getAllFeatures().find((f) => f.id === moduleId);
  const Page = feature?.settingsPage;
  return (
    <div className="max-w-4xl space-y-4">
      <button type="button" onClick={() => navigate(paths.settings("modules"))} className="inline-flex items-center gap-1 text-xs text-surface-500 hover:text-surface-900 dark:hover:text-white">
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("modules.back")}
      </button>
      <SectionHeader title={m ? nameOf(m) : moduleId} description={m ? (m.descriptionKey ? t(m.descriptionKey) : m.description) : undefined} />
      {Page && m?.enabled ? <Page /> : <EmptyState className="py-16" icon={<Settings2 />} title={m?.enabled === false || !feature ? t("modules.notLoaded") : t("modules.noSettings")} />}
    </div>
  );
}
