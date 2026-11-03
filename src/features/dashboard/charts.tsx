// Chart building blocks shared by the home dashboard and the reports page.
// Pure presentation: every component receives the JSON result of an
// src/ops/reports.ts call. recharts lives in chartsImpl.tsx, loaded lazily
// behind Suspense + an error boundary: if it cannot load, cards still show
// their tables / legends and a muted "Chart unavailable".

import { Component, Suspense, lazy, type ComponentProps, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Avatar, chartColor } from "../../components/ui";
import { formatCurrency } from "../../core/fields";
import type { ActivityType, CrmUser } from "../../core/types";
import { intlLocale } from "../../i18n";
import type { PipelineByStageRow, StaleDeal } from "../../ops/reports";
import { cn } from "../../shared/lib/utils";
import { paths } from "../../app/paths";

// ─── Helpers ────────────────────────────────────────────────────────────

export const DAY = 86_400_000;

// Runs a report op; null when it throws (e.g. "No pipeline." on an empty CRM).
export function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export function moneyFormatter(currency: string, compact = true): (n: number) => string {
  const locale = intlLocale();
  return (n: number) => formatCurrency(n, currency, locale, compact);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(intlLocale()).format(n);
}

export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// "2024-06" → "Jun 24" (locale aware). Other keys are returned as-is.
export function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  return new Intl.DateTimeFormat(intlLocale(), { month: "short", year: "2-digit" }).format(new Date(Number(m[1]), Number(m[2]) - 1, 1));
}

export const ACTIVITY_COLORS: Record<ActivityType, string> = {
  note: chartColor("yellow"),
  task: chartColor("blue"),
  call: chartColor("green"),
  email: chartColor("purple"),
  meeting: chartColor("orange"),
};


export function ChartEmpty({ children }: { children: ReactNode }) {
  return <div className="flex h-32 items-center justify-center text-[13px] text-surface-400">{children}</div>;
}

// Compact table under each report chart.
export function ReportTable({ head, rows, align, foot }: { head: ReactNode[]; rows: ReactNode[][]; align?: ("left" | "right")[]; foot?: ReactNode[] }) {
  const cls = (i: number) => (align?.[i] === "right" ? "text-right tabular-nums" : "text-left");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-surface-100 text-xs text-surface-500 dark:border-surface-800">
            {head.map((h, i) => (
              <th key={i} className={cn("whitespace-nowrap px-2 py-1.5 font-medium", cls(i))}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-surface-100 last:border-0 dark:border-surface-800">
              {r.map((c, i) => (
                <td key={i} className={cn("whitespace-nowrap px-2 py-1.5 text-surface-700 dark:text-surface-200", cls(i))}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr className="border-t border-surface-200 font-medium text-surface-900 dark:border-surface-700 dark:text-white">
              {foot.map((c, i) => (
                <td key={i} className={cn("whitespace-nowrap px-2 py-1.5", cls(i))}>
                  {c}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// ─── Charts ─────────────────────────────────────────────────────────────


// Stage legend with count + amount (readable without the chart, too).
export function StageLegend({ stages, money }: { stages: PipelineByStageRow[]; money: (n: number) => string }) {
  return (
    <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
      {stages.map((s) => (
        <li key={s.stageId} className="flex min-w-0 items-center gap-1.5 text-xs" data-stage={s.stageId}>
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: chartColor(s.color) }} />
          <span className="truncate text-surface-600 dark:text-surface-300">{s.label}</span>
          <span className="ml-auto shrink-0 tabular-nums text-surface-500">
            {s.count} · {money(s.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}


export interface LeadSourceRow {
  id: string | null;
  label: string;
  count: number;
  customers: number;
  color?: string;
}




export interface FunnelStage {
  id: string;
  label: string;
  count: number;
  reached: number;
  conversionFromPrevious: number | null;
}

// Horizontal funnel made of plain divs (scales without a measured container).
export function ConversionFunnel({ stages, colors }: { stages: FunnelStage[]; colors?: Record<string, string | undefined> }) {
  const max = Math.max(1, ...stages.map((s) => s.reached));
  return (
    <div className="space-y-1.5">
      {stages.map((s) => (
        <div key={s.id} className="flex items-center gap-3 text-[13px]" data-funnel-stage={s.id}>
          <span className="w-28 shrink-0 truncate text-surface-600 dark:text-surface-300">{s.label}</span>
          <div className="h-5 flex-1 rounded bg-surface-100 dark:bg-surface-800">
            <div className="h-5 rounded" style={{ width: `${(s.reached / max) * 100}%`, background: chartColor(colors?.[s.id] ?? "blue") }} />
          </div>
          <span className="w-12 shrink-0 text-right tabular-nums text-surface-700 dark:text-surface-200">{formatNumber(s.reached)}</span>
          <span className="w-14 shrink-0 text-right tabular-nums text-xs text-surface-500">{s.conversionFromPrevious === null ? "—" : `${s.conversionFromPrevious}%`}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Lazy recharts charts ───────────────────────────────────────────────

const loadImpl = () => import("./chartsImpl");

class ChartBoundary extends Component<{ height: number; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn("Chart unavailable:", error.message, info.componentStack ?? "");
  }
  override render() {
    return this.state.failed ? <ChartUnavailable height={this.props.height} /> : this.props.children;
  }
}

function ChartUnavailable({ height }: { height: number }) {
  const { t } = useTranslation("dashboard");
  return (
    <div style={{ height: Math.min(height, 96) }} className="flex items-center justify-center rounded-md border border-dashed border-surface-200 text-xs text-surface-400 dark:border-surface-800" data-chart-unavailable="">
      {t("chartUnavailable")}
    </div>
  );
}

function ChartSkeleton({ height }: { height: number }) {
  return <div style={{ height }} className="w-full animate-pulse rounded-md bg-surface-100 dark:bg-surface-800/60" aria-hidden="true" />;
}

function lazyChart<K extends "PipelineStageChart" | "WonLostChart" | "LeadSourcesChart" | "ActivityByUserChart" | "ForecastMonthChart">(name: K, defaultHeight = 220) {
  type Impl = Awaited<ReturnType<typeof loadImpl>>[K];
  type Props = ComponentProps<Impl>;
  const Lazy = lazy(async () => ({ default: (await loadImpl())[name] as unknown as ComponentType<Record<string, unknown>> }));
  function LazyChart(props: Props) {
    const height = (props as { height?: number }).height ?? defaultHeight;
    return (
      <ChartBoundary height={height}>
        <Suspense fallback={<ChartSkeleton height={height} />}>
          <Lazy {...(props as unknown as Record<string, unknown>)} />
        </Suspense>
      </ChartBoundary>
    );
  }
  LazyChart.displayName = name;
  return LazyChart;
}

export const PipelineStageChart = lazyChart("PipelineStageChart");
export const WonLostChart = lazyChart("WonLostChart");
export const LeadSourcesChart = lazyChart("LeadSourcesChart", 160);
export const ActivityByUserChart = lazyChart("ActivityByUserChart");
export const ForecastMonthChart = lazyChart("ForecastMonthChart");

// ─── Lists ──────────────────────────────────────────────────────────────

export function StaleDealsList({ deals, users, objectOf, money }: { deals: StaleDeal[]; users: Map<string, CrmUser>; objectOf: (id: string) => string; money: (n: number) => string }) {
  const { t } = useTranslation("dashboard");
  return (
    <ul className="divide-y divide-surface-100 dark:divide-surface-800">
      {deals.map((d) => {
        const owner = d.ownerId ? users.get(d.ownerId) : undefined;
        return (
          <li key={d.id} data-stale-deal={d.id}>
            <Link to={paths.record(objectOf(d.id), d.id)} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 text-[13px] hover:bg-surface-50 dark:hover:bg-surface-800/60">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-surface-900 dark:text-white">{d.label}</span>
                <span className="block truncate text-xs text-surface-500">{d.stage}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-amber-600 dark:text-amber-400">{t("idleDays", { count: d.idleDays })}</span>
              <span className="w-16 shrink-0 text-right tabular-nums text-surface-700 dark:text-surface-200">{money(d.amount)}</span>
              <span className="w-5 shrink-0" title={owner?.name}>
                {owner && <Avatar name={owner.name} src={owner.avatarUrl} size="sm" />}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
