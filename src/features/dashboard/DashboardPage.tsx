// Home dashboard: KPI tiles, the main report charts, stale deals, my tasks
// of the day, then widgets contributed by other features (dashboardWidgets
// slot). Everything is computed by src/ops/ and recomputed live whenever
// the underlying collections change.

import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AlertTriangle, LayoutDashboard, Target, TrendingUp, Trophy, UserPlus } from "lucide-react";
import { Card, Checkbox, EmptyState, PageHeader } from "../../components/ui";
import type { Activity, CrmRecord, ObjectDef } from "../../core/types";
import { useActivities, useCan, useCollection, useCurrentUser, useOps, usePipelines, useRecordLabel, useSettings, useUsers } from "../../app/CrmDataContext";
import { getSlot } from "../../app/featureRegistry";
import { paths } from "../../app/paths";
import { completeTask, listTasks } from "../../ops/activities";
import { forecast } from "../../ops/pipelines";
import { activityByUser, leadSources, pipelineByStage, staleDeals, wonLost } from "../../ops/reports";
import { getStats } from "../../ops/stats";
import { toast } from "../../shared/lib/toast";
import { cn, formatDate } from "../../shared/lib/utils";
import { intlLocale } from "../../i18n";
import { ActivityByUserChart, ChartEmpty, LeadSourcesChart, PipelineStageChart, StageLegend, StaleDealsList, WonLostChart, formatNumber, moneyFormatter, safe } from "./charts";

const WIDGET_SPAN: Record<number, string> = {
  4: "col-span-12 md:col-span-6 lg:col-span-4",
  6: "col-span-12 md:col-span-6",
  8: "col-span-12 lg:col-span-8",
  12: "col-span-12",
};

function startOfMonth(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function endOfDay(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1;
}

export function KpiTile({ label, value, sub, icon, to, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: ReactNode; to?: string; tone?: "danger" }) {
  const body = (
    <div className={cn("h-full rounded-lg border border-surface-200 bg-white px-4 py-3 shadow-card dark:border-surface-800 dark:bg-surface-900", to && "transition-colors hover:border-surface-300 dark:hover:border-surface-700")}>
      <div className="flex items-center gap-1.5 text-xs text-surface-500">
        {icon && <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("mt-1 truncate text-xl font-semibold tabular-nums text-surface-900 dark:text-white", tone === "danger" && "text-red-600 dark:text-red-400")}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-surface-500">{sub}</div>}
    </div>
  );
  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function DashboardPage() {
  const { t } = useTranslation("dashboard");
  const ops = useOps();
  const me = useCurrentUser();
  const settings = useSettings();
  const records = useCollection<CrmRecord>("records");
  const activities = useActivities();
  const pipelines = usePipelines();
  const users = useUsers({ includeDisabled: true });
  const objects = useCollection<ObjectDef>("objects");
  const canRead = useCan("reports.read");
  const money = useMemo(() => moneyFormatter(settings.defaultCurrency), [settings.defaultCurrency]);

  const data = useMemo(() => {
    if (!canRead) return null;
    const now = ops.now();
    const monthStart = startOfMonth(now);
    const stats = safe(() => getStats(ops));
    const fc = safe(() => forecast(ops));
    const byStage = safe(() => pipelineByStage(ops));
    const wl = safe(() => wonLost(ops, { months: 6 }));
    const thisMonth = safe(() => wonLost(ops, { months: 1 }))?.months[0] ?? null;
    const people = records.filter((r) => r.object === "people" && !r.deletedAt);
    const newPeople = people.filter((r) => r.createdAt >= monthStart);
    const newLeads = newPeople.filter((r) => r.fields.lifecycleStage === "lead").length;
    const leadField = objects.find((o) => o.id === "people")?.fields.find((f) => f.id === "leadSource");
    const sources = (safe(() => leadSources(ops))?.sources ?? []).map((s) => ({ ...s, label: s.id ? s.label : t("unknown"), color: leadField?.options?.find((o) => o.id === s.id)?.color }));
    const activity = safe(() => activityByUser(ops, { days: 30 }));
    const stale = safe(() => staleDeals(ops, { limit: 6 }));
    const eod = endOfDay(now);
    const myTasks = safe(() => listTasks(ops, { assigneeId: me.id, status: "open" }).items.filter((a) => a.dueAt !== undefined && a.dueAt <= eod)) ?? [];
    return { now, stats, fc, byStage, wl, thisMonth, newPeople: newPeople.length, newLeads, sources, activity, stale, myTasks };
    // The collections are the recompute keys: ops reads the same store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops, canRead, records, activities, pipelines, users, objects, settings, me.id, t]);

  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const objectOfRecord = useMemo(() => {
    const m = new Map(records.map((r) => [r.id, r.object]));
    return (id: string) => m.get(id) ?? "deals";
  }, [records]);
  const widgets = getSlot("dashboardWidgets");

  if (!data) {
    return (
      <div>
        <PageHeader title={t("title")} icon={<LayoutDashboard />} />
        <EmptyState className="py-24" icon={<LayoutDashboard />} title={t("noAccess")} />
      </div>
    );
  }

  const { stats, fc, byStage, wl, thisMonth, sources, activity, stale, myTasks } = data;
  const hasPipeline = !!fc;
  const activityUsers = activity?.users.filter((u) => u.total > 0) ?? [];

  return (
    <div>
      <PageHeader title={t("title")} icon={<LayoutDashboard />} description={t("greeting", { name: me.name.split(" ")[0] })} />
      <div className="space-y-4 p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="kpis">
          <KpiTile icon={<TrendingUp />} label={t("openPipeline")} value={fc ? money(fc.openAmount) : "—"} sub={fc ? t("openDeals", { count: fc.openCount }) : t("noPipeline")} />
          <KpiTile icon={<Target />} label={t("weighted")} value={fc ? money(fc.weightedAmount) : "—"} sub={fc && fc.openAmount ? t("ofPipeline", { pct: Math.round((fc.weightedAmount / fc.openAmount) * 100) }) : undefined} />
          <KpiTile icon={<Trophy />} label={t("wonThisMonth")} value={thisMonth ? money(thisMonth.wonAmount) : "—"} sub={thisMonth ? t("dealsCount", { count: thisMonth.wonCount }) : undefined} />
          <KpiTile icon={<UserPlus />} label={t("newPeopleThisMonth")} value={formatNumber(data.newPeople)} sub={t("leadsCount", { count: data.newLeads })} />
          <KpiTile
            icon={<AlertTriangle />}
            label={t("overdueTasks")}
            value={formatNumber(stats?.overdueTasks ?? 0)}
            sub={t("openTasksCount", { count: stats?.openTasks ?? 0 })}
            to={paths.tasks()}
            tone={stats?.overdueTasks ? "danger" : undefined}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12">
          {hasPipeline && byStage && (
            <Card className="md:col-span-2 lg:col-span-7" title={t("byStage")} actions={<Link to={paths.reports()} className="text-xs text-surface-500 hover:text-surface-900 dark:hover:text-white">{t("viewReports")}</Link>}>
              <PipelineStageChart stages={byStage.stages} money={money} />
              <StageLegend stages={byStage.stages} money={money} />
            </Card>
          )}
          {hasPipeline && wl && (
            <Card className="lg:col-span-5" title={t("wonLost")} actions={<span className="text-xs text-surface-500">{wl.totals.winRate === null ? "" : t("winRateValue", { pct: wl.totals.winRate })}</span>}>
              <WonLostChart months={wl.months} money={money} />
            </Card>
          )}
          <Card className="lg:col-span-5" title={t("leadSources")}>
            {sources.length ? <LeadSourcesChart sources={sources} /> : <ChartEmpty>{t("noData")}</ChartEmpty>}
          </Card>
          <Card className="lg:col-span-7" title={t("activityByUser")} actions={<span className="text-xs text-surface-500">{t("lastDays", { count: 30 })}</span>}>
            {activityUsers.length ? <ActivityByUserChart users={activityUsers} /> : <ChartEmpty>{t("noData")}</ChartEmpty>}
          </Card>
          {hasPipeline && stale && (
            <Card className="lg:col-span-6" title={t("staleDeals")} actions={<span className="text-xs text-surface-500">{t("idleFor", { count: stale.days })}</span>}>
              {stale.deals.length ? <StaleDealsList deals={stale.deals} users={userMap} objectOf={objectOfRecord} money={money} /> : <ChartEmpty>{t("noStaleDeals")}</ChartEmpty>}
            </Card>
          )}
          <Card className={cn(hasPipeline ? "lg:col-span-6" : "md:col-span-2 lg:col-span-12")} title={t("myTasksToday")} actions={<Link to={paths.tasks()} className="text-xs text-surface-500 hover:text-surface-900 dark:hover:text-white">{t("allTasks")}</Link>}>
            <MyTasks tasks={myTasks} now={data.now} />
          </Card>
        </div>

        {widgets.length > 0 && (
          <div className="grid grid-cols-12 gap-4">
            {widgets.map((w) => (
              <div key={w.id} className={WIDGET_SPAN[w.span ?? 12] ?? "col-span-12"}>
                <w.component />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MyTasks({ tasks, now }: { tasks: Activity[]; now: number }) {
  const { t } = useTranslation("dashboard");
  const ops = useOps();
  const canWrite = useCan("activities.write");
  const labelOf = useRecordLabel();
  const [busy, setBusy] = useState<string | null>(null);
  if (!tasks.length) return <ChartEmpty>{t("noTasksToday")}</ChartEmpty>;
  const toggle = async (id: string) => {
    setBusy(id);
    try {
      await completeTask(ops, id);
      toast.success(t("taskDone"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  const today = new Date(now).toDateString();
  return (
    <ul className="divide-y divide-surface-100 dark:divide-surface-800">
      {tasks.map((task) => {
        const overdue = task.dueAt !== undefined && task.dueAt < now && new Date(task.dueAt).toDateString() !== today;
        return (
          <li key={task.id} className="flex items-start gap-2.5 py-1.5 text-[13px]" data-task={task.id}>
            <Checkbox className="mt-0.5" checked={false} disabled={!canWrite || busy === task.id} aria-label={t("markDone")} onChange={() => void toggle(task.id)} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-surface-900 dark:text-white">{task.title}</div>
              {task.targets.length > 0 && (
                <div className="flex flex-wrap gap-x-2 text-xs">
                  {task.targets.map((tg) => (
                    <Link key={tg.id} to={paths.record(tg.object, tg.id)} className="truncate text-surface-500 hover:text-accent-600 hover:underline">
                      {labelOf(tg.id) ?? tg.id}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <span className={cn("shrink-0 text-xs tabular-nums", overdue ? "text-red-600 dark:text-red-400" : "text-surface-500")}>
              {overdue ? t("overdueSince", { date: formatDate(task.dueAt!, intlLocale()) }) : t("today")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
