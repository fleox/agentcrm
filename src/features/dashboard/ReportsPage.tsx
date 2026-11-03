// Reports page: one card per report of src/ops/reports.ts (+ forecast),
// each with a chart, a compact table and a CSV export, under shared
// filters (date range + pipeline).

import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, Download } from "lucide-react";
import { Button, Card, EmptyState, Input, PageHeader, Select, downloadCsv, fileStamp, toCsv } from "../../components/ui";
import { ACTIVITY_TYPES, type CrmRecord, type ObjectDef } from "../../core/types";
import { useActivities, useCan, useCollection, useOps, usePipelines, useSettings, useUsers } from "../../app/CrmDataContext";
import { useModuleEnabled } from "../../app/featureRegistry";
import { forecast } from "../../ops/pipelines";
import { activityByUser, conversion, leadSources, pipelineByStage, staleDeals, wonLost } from "../../ops/reports";
import {
  ActivityByUserChart,
  ChartEmpty,
  ConversionFunnel,
  DAY,
  ForecastMonthChart,
  LeadSourcesChart,
  PipelineStageChart,
  ReportTable,
  StaleDealsList,
  WonLostChart,
  formatNumber,
  monthKey,
  monthLabel,
  moneyFormatter,
  safe,
} from "./charts";

export type RangePreset = "30d" | "90d" | "ytd" | "12m" | "custom";

export interface DateRange {
  since: number;
  // Upper bound (custom range only); null = up to now.
  until: number | null;
}

function isoDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDay(s: string, endOfDay = false): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (endOfDay ? 1 : 0));
  return d.getTime() - (endOfDay ? 1 : 0);
}

export function resolveRange(preset: RangePreset, now: number, from: string, to: string): DateRange {
  const d = new Date(now);
  switch (preset) {
    case "30d":
      return { since: now - 30 * DAY, until: null };
    case "90d":
      return { since: now - 90 * DAY, until: null };
    case "ytd":
      return { since: new Date(d.getFullYear(), 0, 1).getTime(), until: null };
    case "12m":
      return { since: new Date(d.getFullYear(), d.getMonth() - 11, 1).getTime(), until: null };
    case "custom": {
      const since = parseDay(from) ?? now - 90 * DAY;
      const until = parseDay(to, true);
      return { since, until: until !== null && until < now ? until : null };
    }
  }
}

function monthsSpan(since: number, now: number): number {
  const a = new Date(since);
  const b = new Date(now);
  return Math.max(1, Math.min(36, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1));
}

function exportReport(name: string, rows: unknown[][]): void {
  downloadCsv(`agentcrm-${name}-${fileStamp()}.csv`, toCsv(rows));
}

function ReportCard({ id, title, subtitle, onExport, children, className }: { id: string; title: ReactNode; subtitle?: ReactNode; onExport?: () => void; children: ReactNode; className?: string }) {
  const { t } = useTranslation("dashboard");
  return (
    <Card
      data-report={id}
      className={className}
      title={title}
      actions={
        <>
          {subtitle && <span className="mr-2 hidden text-xs text-surface-500 sm:inline">{subtitle}</span>}
          {onExport && (
            <Button size="xs" variant="ghost" icon={<Download />} onClick={onExport} data-export={id}>
              {t("exportCsv")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

export function ReportsPage() {
  const { t } = useTranslation("dashboard");
  const ops = useOps();
  const canRead = useCan("reports.read");
  const settings = useSettings();
  const records = useCollection<CrmRecord>("records");
  const activities = useActivities();
  // Deals & pipelines module off → no pipeline reports.
  const dealsOn = useModuleEnabled("deals");
  const allPipelines = usePipelines();
  const pipelines = useMemo(() => (dealsOn ? allPipelines : []), [dealsOn, allPipelines]);
  const users = useUsers({ includeDisabled: true });
  const objects = useCollection<ObjectDef>("objects");
  const money = useMemo(() => moneyFormatter(settings.defaultCurrency), [settings.defaultCurrency]);
  const fullMoney = useMemo(() => moneyFormatter(settings.defaultCurrency, false), [settings.defaultCurrency]);

  const [preset, setPreset] = useState<RangePreset>("90d");
  const [from, setFrom] = useState(() => isoDay(ops.now() - 90 * DAY));
  const [to, setTo] = useState(() => isoDay(ops.now()));
  const [pipelineChoice, setPipelineChoice] = useState("");
  const defaultPipeline = pipelines.find((p) => p.object === "deals") ?? pipelines[0];
  const pipeline = pipelines.find((p) => p.id === pipelineChoice) ?? defaultPipeline;
  const pipelineId = pipeline?.id;

  const data = useMemo(() => {
    if (!canRead) return null;
    const now = ops.now();
    const range = resolveRange(preset, now, from, to);
    const sinceMonth = monthKey(range.since);
    const untilMonth = monthKey(range.until ?? now);
    const byStage = pipelineId ? safe(() => pipelineByStage(ops, { pipelineId })) : null;
    const fc = pipelineId ? safe(() => forecast(ops, { pipelineId, from: range.since, ...(range.until !== null ? { to: range.until } : {}) })) : null;
    const wlRaw = pipelineId ? safe(() => wonLost(ops, { pipelineId, months: monthsSpan(range.since, now) })) : null;
    const wlMonths = wlRaw?.months.filter((m) => m.month >= sinceMonth && m.month <= untilMonth) ?? [];
    const wlTotals = wlMonths.reduce((a, m) => ({ wonCount: a.wonCount + m.wonCount, wonAmount: a.wonAmount + m.wonAmount, lostCount: a.lostCount + m.lostCount, lostAmount: a.lostAmount + m.lostAmount }), { wonCount: 0, wonAmount: 0, lostCount: 0, lostAmount: 0 });
    const winRate = wlTotals.wonCount + wlTotals.lostCount ? Math.round((wlTotals.wonCount / (wlTotals.wonCount + wlTotals.lostCount)) * 1000) / 10 : null;
    const days = Math.max(1, Math.ceil((now - range.since) / DAY));
    const activity = safe(() => activityByUser(ops, { days }));
    const peopleObject = objects.find((o) => o.id === "people");
    const leadField = peopleObject?.fields.find((f) => f.id === "leadSource");
    const lifecycleField = peopleObject?.fields.find((f) => f.id === "lifecycleStage");
    const sources = (safe(() => leadSources(ops, { since: range.since }))?.sources ?? []).map((s) => ({ ...s, label: s.id ? s.label : t("unknown"), color: leadField?.options?.find((o) => o.id === s.id)?.color }));
    const funnel = safe(() => conversion(ops, { since: range.since }))?.stages ?? [];
    const lifecycleColors = Object.fromEntries((lifecycleField?.options ?? []).map((o) => [o.id, o.color]));
    const stale = dealsOn ? safe(() => staleDeals(ops, pipelineId ? { pipelineId } : {})) : null;
    return { range, byStage, fc, wlMonths, wlTotals, winRate, activity, days, sources, funnel, lifecycleColors, stale };
    // Collections are the recompute keys: ops reads the same store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ops, canRead, preset, from, to, pipelineId, records, activities, pipelines, users, objects, settings, t, dealsOn]);

  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const objectOfRecord = useMemo(() => {
    const m = new Map(records.map((r) => [r.id, r.object]));
    return (id: string) => m.get(id) ?? "deals";
  }, [records]);

  if (!data) {
    return (
      <div>
        <PageHeader title={t("reportsTitle")} icon={<BarChart3 />} />
        <EmptyState className="py-24" icon={<BarChart3 />} title={t("noAccess")} />
      </div>
    );
  }

  const { byStage, fc, wlMonths, wlTotals, winRate, activity, sources, funnel, stale } = data;
  const activityUsers = activity?.users.filter((u) => u.total > 0 || u.tasksOpen > 0) ?? [];
  const presets: { value: RangePreset; label: string }[] = [
    { value: "30d", label: t("range.30d") },
    { value: "90d", label: t("range.90d") },
    { value: "ytd", label: t("range.ytd") },
    { value: "12m", label: t("range.12m") },
    { value: "custom", label: t("range.custom") },
  ];
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
  const userName = (id: string | null, name: string) => (id ? name : t("unassigned"));
  const ownerName = (id: string | undefined) => (id ? userMap.get(id)?.name ?? id : "");
  const forecastMonth = (m: string) => (m === "none" ? t("noCloseDate") : monthLabel(m));

  return (
    <div>
      <PageHeader title={t("reportsTitle")} icon={<BarChart3 />}>
        <div className="mt-3 flex flex-wrap items-end gap-2" data-testid="report-filters">
          <label className="flex flex-col gap-1 text-xs text-surface-500">
            {t("filters.period")}
            <Select className="w-44" value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)} options={presets} aria-label={t("filters.period")} />
          </label>
          {preset === "custom" && (
            <>
              <label className="flex flex-col gap-1 text-xs text-surface-500">
                {t("filters.from")}
                <Input type="date" className="w-40" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label={t("filters.from")} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-surface-500">
                {t("filters.to")}
                <Input type="date" className="w-40" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label={t("filters.to")} />
              </label>
            </>
          )}
          {pipelines.length > 0 && (
            <label className="flex flex-col gap-1 text-xs text-surface-500">
              {t("filters.pipeline")}
              <Select className="w-48" value={pipelineId ?? ""} onChange={(e) => setPipelineChoice(e.target.value)} options={pipelines.map((p) => ({ value: p.id, label: p.name }))} aria-label={t("filters.pipeline")} />
            </label>
          )}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 p-4 sm:p-6 lg:grid-cols-2">
        {!pipeline && dealsOn && (
          <Card className="lg:col-span-2">
            <EmptyState icon={<BarChart3 />} title={t("noPipeline")} description={t("noPipelineHint")} />
          </Card>
        )}

        {byStage && (
          <ReportCard
            id="pipelineByStage"
            title={t("byStage")}
            subtitle={pipeline?.name}
            onExport={() => exportReport("pipeline-by-stage", [[t("col.stage"), t("col.kind"), t("col.count"), t("col.amount"), t("col.weighted")], ...byStage.stages.map((s) => [s.label, s.kind, s.count, s.amount, s.weighted])])}
          >
            <PipelineStageChart stages={byStage.stages} money={money} />
            <ReportTable
              head={[t("col.stage"), t("col.count"), t("col.amount"), t("col.weighted")]}
              align={["left", "right", "right", "right"]}
              rows={byStage.stages.map((s) => [s.label, formatNumber(s.count), fullMoney(s.amount), fullMoney(s.weighted)])}
              foot={[t("col.total"), formatNumber(byStage.stages.reduce((a, s) => a + s.count, 0)), fullMoney(byStage.stages.reduce((a, s) => a + s.amount, 0)), fullMoney(byStage.stages.reduce((a, s) => a + s.weighted, 0))]}
            />
          </ReportCard>
        )}

        {fc && (
          <ReportCard
            id="forecast"
            title={t("forecastByMonth")}
            subtitle={t("forecastHint")}
            onExport={() => exportReport("forecast", [[t("col.month"), t("col.count"), t("col.amount"), t("col.weighted")], ...fc.byMonth.map((m) => [m.month, m.count, m.amount, m.weighted])])}
          >
            {fc.byMonth.length ? <ForecastMonthChart months={fc.byMonth} money={money} /> : <ChartEmpty>{t("noData")}</ChartEmpty>}
            <ReportTable
              head={[t("col.month"), t("col.count"), t("col.amount"), t("col.weighted")]}
              align={["left", "right", "right", "right"]}
              rows={fc.byMonth.map((m) => [forecastMonth(m.month), formatNumber(m.count), fullMoney(m.amount), fullMoney(m.weighted)])}
              foot={[t("col.total"), formatNumber(fc.byMonth.reduce((a, m) => a + m.count, 0)), fullMoney(fc.byMonth.reduce((a, m) => a + m.amount, 0)), fullMoney(fc.byMonth.reduce((a, m) => a + m.weighted, 0))]}
            />
          </ReportCard>
        )}

        {pipeline && (
          <ReportCard
            id="wonLost"
            title={t("wonLost")}
            subtitle={winRate === null ? undefined : t("winRateValue", { pct: winRate })}
            onExport={() => exportReport("won-lost", [[t("col.month"), t("col.wonCount"), t("col.wonAmount"), t("col.lostCount"), t("col.lostAmount"), t("col.winRate")], ...wlMonths.map((m) => [m.month, m.wonCount, m.wonAmount, m.lostCount, m.lostAmount, m.winRate ?? ""])])}
          >
            <WonLostChart months={wlMonths} money={money} />
            <ReportTable
              head={[t("col.month"), t("col.wonCount"), t("col.wonAmount"), t("col.lostCount"), t("col.lostAmount"), t("col.winRate")]}
              align={["left", "right", "right", "right", "right", "right"]}
              rows={wlMonths.map((m) => [monthLabel(m.month), formatNumber(m.wonCount), fullMoney(m.wonAmount), formatNumber(m.lostCount), fullMoney(m.lostAmount), pct(m.winRate)])}
              foot={[t("col.total"), formatNumber(wlTotals.wonCount), fullMoney(wlTotals.wonAmount), formatNumber(wlTotals.lostCount), fullMoney(wlTotals.lostAmount), pct(winRate)]}
            />
          </ReportCard>
        )}

        <ReportCard
          id="activityByUser"
          title={t("activityByUser")}
          subtitle={t("lastDays", { count: data.days })}
          onExport={() =>
            exportReport("activity-by-user", [
              [t("col.user"), ...ACTIVITY_TYPES.map((type) => t(`activityTypes.${type}`)), t("col.total"), t("col.tasksDone"), t("col.tasksOpen")],
              ...activityUsers.map((u) => [userName(u.userId, u.name), ...ACTIVITY_TYPES.map((type) => u.byType[type]), u.total, u.tasksDone, u.tasksOpen]),
            ])
          }
        >
          {activityUsers.length ? <ActivityByUserChart users={activityUsers} /> : <ChartEmpty>{t("noData")}</ChartEmpty>}
          <ReportTable
            head={[t("col.user"), ...ACTIVITY_TYPES.map((type) => t(`activityTypes.${type}`)), t("col.total"), t("col.tasksDone"), t("col.tasksOpen")]}
            align={["left", ...ACTIVITY_TYPES.map(() => "right" as const), "right", "right", "right"]}
            rows={activityUsers.map((u) => [userName(u.userId, u.name), ...ACTIVITY_TYPES.map((type) => formatNumber(u.byType[type])), formatNumber(u.total), formatNumber(u.tasksDone), formatNumber(u.tasksOpen)])}
          />
        </ReportCard>

        <ReportCard
          id="leadSources"
          title={t("leadSources")}
          onExport={() => exportReport("lead-sources", [[t("col.source"), t("col.people"), t("col.customers"), t("col.customerRate")], ...sources.map((s) => [s.label, s.count, s.customers, s.count ? Math.round((s.customers / s.count) * 1000) / 10 : ""])])}
        >
          {sources.length ? <LeadSourcesChart sources={sources} /> : <ChartEmpty>{t("noData")}</ChartEmpty>}
          <ReportTable
            head={[t("col.source"), t("col.people"), t("col.customers"), t("col.customerRate")]}
            align={["left", "right", "right", "right"]}
            rows={sources.map((s) => [s.label, formatNumber(s.count), formatNumber(s.customers), pct(s.count ? Math.round((s.customers / s.count) * 1000) / 10 : null)])}
          />
        </ReportCard>

        <ReportCard
          id="conversion"
          title={t("conversion")}
          onExport={() => exportReport("conversion", [[t("col.stage"), t("col.count"), t("col.reached"), t("col.conversion")], ...funnel.map((s) => [s.label, s.count, s.reached, s.conversionFromPrevious ?? ""])])}
        >
          {funnel.some((s) => s.reached > 0) ? <ConversionFunnel stages={funnel} colors={data.lifecycleColors} /> : <ChartEmpty>{t("noData")}</ChartEmpty>}
          <ReportTable
            head={[t("col.stage"), t("col.count"), t("col.reached"), t("col.conversion")]}
            align={["left", "right", "right", "right"]}
            rows={funnel.map((s) => [s.label, formatNumber(s.count), formatNumber(s.reached), pct(s.conversionFromPrevious)])}
          />
        </ReportCard>

        {stale && (
          <ReportCard
            id="staleDeals"
            title={t("staleDeals")}
            subtitle={t("idleFor", { count: stale.days })}
            onExport={() => exportReport("stale-deals", [[t("col.deal"), t("col.stage"), t("col.amount"), t("col.owner"), t("col.idleDays"), t("col.lastActivity")], ...stale.deals.map((d) => [d.label, d.stage, d.amount, ownerName(d.ownerId), d.idleDays, d.lastActivityAt ? new Date(d.lastActivityAt).toISOString() : ""])])}
          >
            {stale.deals.length ? <StaleDealsList deals={stale.deals.slice(0, 50)} users={userMap} objectOf={objectOfRecord} money={money} /> : <ChartEmpty>{t("noStaleDeals")}</ChartEmpty>}
            {stale.deals.length > 50 && <div className="text-xs text-surface-500">{t("moreRows", { count: stale.deals.length - 50 })}</div>}
          </ReportCard>
        )}
      </div>
    </div>
  );
}
