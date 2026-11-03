import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, LayoutDashboard } from "lucide-react";
import { formatCurrency } from "../../core/fields";
import { Card, EmptyState, PageHeader, dotClass } from "../../components/ui";
import { useActivities, useCollection, useOps, useSettings } from "../../app/CrmDataContext";
import { getSlot } from "../../app/featureRegistry";
import { getStats } from "../../ops/stats";
import { pipelineByStage } from "../../ops/reports";
import { intlLocale } from "../../i18n";
import { cn } from "../../shared/lib/utils";

export function DashboardPage() {
  const { t } = useTranslation("dashboard");
  const ops = useOps();
  const settings = useSettings();
  const records = useCollection("records");
  const activities = useActivities();
  const pipelines = useCollection("pipelines");
  const stats = useMemo(() => getStats(ops), [ops, records, activities]);
  const byStage = useMemo(() => (pipelines.length ? pipelineByStage(ops) : null), [ops, records, pipelines]);
  const money = (n: number) => formatCurrency(n, settings.defaultCurrency, intlLocale(), true);
  const max = Math.max(1, ...(byStage?.stages.map((s) => s.amount) ?? [1]));
  const widgets = getSlot("dashboardWidgets");
  return (
    <div>
      <PageHeader title={t("title")} icon={<LayoutDashboard />} />
      <div className="space-y-4 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.objects.map((o) => (
            <Card key={o.id}>
              <div className="text-xs text-surface-500">{o.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{o.count}</div>
            </Card>
          ))}
          <Card>
            <div className="text-xs text-surface-500">{t("openTasks")}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{stats.openTasks}</div>
            {stats.overdueTasks > 0 && <div className="text-xs text-red-600">{t("overdue", { count: stats.overdueTasks })}</div>}
          </Card>
        </div>
        {stats.pipeline && byStage && (
          <Card title={t("byStage")} actions={<span className="text-xs text-surface-500">{t("openPipeline")}: {money(stats.pipeline.openAmount)} · {t("weighted")}: {money(stats.pipeline.weightedAmount)}</span>}>
            <div className="space-y-2">
              {byStage.stages.map((s) => (
                <div key={s.stageId} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 truncate text-surface-600 dark:text-surface-300">{s.label}</span>
                  <div className="h-5 flex-1 rounded bg-surface-100 dark:bg-surface-800">
                    <div className={cn("h-5 rounded", dotClass(s.color))} style={{ width: `${(s.amount / max) * 100}%` }} />
                  </div>
                  <span className="w-28 shrink-0 text-right tabular-nums text-surface-600 dark:text-surface-300">
                    {s.count} · {money(s.amount)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
        {widgets.length > 0 && (
          <div className="grid grid-cols-12 gap-4">
            {widgets.map((w) => (
              <div key={w.id} className={cn("col-span-12", w.span === 4 && "lg:col-span-4", w.span === 6 && "lg:col-span-6", w.span === 8 && "lg:col-span-8")}>
                <w.component />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ReportsPage() {
  const { t } = useTranslation("dashboard");
  return (
    <div>
      <PageHeader title={t("reportsTitle")} icon={<BarChart3 />} />
      <EmptyState className="py-24" icon={<BarChart3 />} title={t("reportsTitle")} description={t("reportsSoon")} />
    </div>
  );
}
