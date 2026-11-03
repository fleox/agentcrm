// recharts-based charts, loaded lazily by charts.tsx (React.lazy) so the
// rest of the dashboard keeps working when recharts (or its react-is peer
// dependency) cannot be loaded. Only this module imports recharts.

import { type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartColor } from "../../components/ui";
import { ACTIVITY_TYPES } from "../../core/types";
import type { ActivityByUserRow, PipelineByStageRow, WonLostRow } from "../../ops/reports";
import type { Forecast } from "../../ops/pipelines";
import { ACTIVITY_COLORS, formatNumber, monthLabel, type LeadSourceRow } from "./charts";

const TICK = { fill: "#a1a1aa", fontSize: 11 };
const GRID = { stroke: "#a1a1aa", strokeOpacity: 0.2, strokeDasharray: "3 3" };
const CURSOR = { fill: "#a1a1aa", fillOpacity: 0.12 };

// ─── Containers ─────────────────────────────────────────────────────────

export function ChartBox({ height = 220, children }: { height?: number; children: ReactNode }) {
  return (
    <div style={{ height }} className="w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        {children as ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

interface TooltipItem {
  name?: string | number;
  value?: number | string | ReadonlyArray<number | string>;
  color?: string;
  fill?: string;
  dataKey?: unknown;
}

// Themed tooltip; recharts clones it with active / payload / label.
export function ChartTooltip({ active, payload, label, format, labelFormat }: { active?: boolean; payload?: ReadonlyArray<TooltipItem>; label?: unknown; format?: (value: number, name: string) => string; labelFormat?: (label: string) => string }) {
  if (!active || !payload?.length) return null;
  const title = label === undefined || label === null ? "" : String(label);
  return (
    <div className="rounded-md border border-surface-200 bg-white px-2.5 py-1.5 text-xs shadow-lg dark:border-surface-700 dark:bg-surface-900">
      {title && <div className="mb-1 font-medium text-surface-900 dark:text-white">{labelFormat ? labelFormat(title) : title}</div>}
      {payload.map((p, i) => {
        const name = String(p.name ?? "");
        const v = typeof p.value === "number" ? p.value : Number(p.value);
        return (
          <div key={i} className="flex items-center gap-2 text-surface-600 dark:text-surface-300">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: p.color ?? p.fill }} />
            <span className="truncate">{name}</span>
            <span className="ml-auto pl-3 tabular-nums text-surface-900 dark:text-white">{format ? format(v, name) : formatNumber(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function PipelineStageChart({ stages, money, height }: { stages: PipelineByStageRow[]; money: (n: number) => string; height?: number }) {
  const { t } = useTranslation("dashboard");
  const data = stages.map((s) => ({ ...s, name: s.label }));
  return (
    <ChartBox height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} {...GRID} />
        <XAxis dataKey="name" tick={TICK} tickLine={false} axisLine={false} interval={0} />
        <YAxis tick={TICK} tickLine={false} axisLine={false} width={84} tickFormatter={(v: number) => money(v)} />
        <Tooltip cursor={CURSOR} content={<ChartTooltip format={(v) => money(v)} />} />
        <Bar dataKey="amount" name={t("amount")} radius={[4, 4, 0, 0]} maxBarSize={48}>
          {data.map((s) => (
            <Cell key={s.stageId} fill={chartColor(s.color)} />
          ))}
        </Bar>
      </BarChart>
    </ChartBox>
  );
}

export function WonLostChart({ months, money, height }: { months: WonLostRow[]; money: (n: number) => string; height?: number }) {
  const { t } = useTranslation("dashboard");
  const data = months.map((m) => ({ ...m, name: monthLabel(m.month) }));
  const won = t("won");
  const lost = t("lost");
  const rate = t("winRate");
  return (
    <ChartBox height={height}>
      <ComposedChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} {...GRID} />
        <XAxis dataKey="name" tick={TICK} tickLine={false} axisLine={false} />
        <YAxis yAxisId="amount" tick={TICK} tickLine={false} axisLine={false} width={84} tickFormatter={(v: number) => money(v)} />
        <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tick={TICK} tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => `${v}%`} />
        <Tooltip cursor={CURSOR} content={<ChartTooltip format={(v, name) => (name === rate ? `${v}%` : money(v))} />} />
        <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Bar yAxisId="amount" dataKey="wonAmount" name={won} fill={chartColor("green")} radius={[3, 3, 0, 0]} maxBarSize={22} />
        <Bar yAxisId="amount" dataKey="lostAmount" name={lost} fill={chartColor("red")} radius={[3, 3, 0, 0]} maxBarSize={22} />
        <Line yAxisId="rate" dataKey="winRate" name={rate} stroke={chartColor("indigo")} strokeWidth={2} dot={{ r: 2 }} connectNulls type="monotone" />
      </ComposedChart>
    </ChartBox>
  );
}

export function LeadSourcesChart({ sources, height }: { sources: LeadSourceRow[]; height?: number }) {
  const { t } = useTranslation("dashboard");
  const h = height ?? Math.max(120, sources.length * 28 + 24);
  return (
    <ChartBox height={h}>
      <BarChart data={sources} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid horizontal={false} {...GRID} />
        <XAxis type="number" tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="label" tick={TICK} tickLine={false} axisLine={false} width={124} />
        <Tooltip cursor={CURSOR} content={<ChartTooltip />} />
        <Bar dataKey="count" name={t("people")} radius={[0, 4, 4, 0]} maxBarSize={18}>
          {sources.map((s) => (
            <Cell key={s.id ?? "none"} fill={chartColor(s.color ?? "blue")} />
          ))}
        </Bar>
        <Bar dataKey="customers" name={t("customers")} fill={chartColor("gray")} radius={[0, 4, 4, 0]} maxBarSize={18} />
      </BarChart>
    </ChartBox>
  );
}

export function ActivityByUserChart({ users, height }: { users: ActivityByUserRow[]; height?: number }) {
  const { t } = useTranslation("dashboard");
  const data = users.map((u) => ({ name: u.userId ? u.name : t("unassigned"), ...u.byType }));
  return (
    <ChartBox height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} {...GRID} />
        <XAxis dataKey="name" tick={TICK} tickLine={false} axisLine={false} interval={0} />
        <YAxis tick={TICK} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
        <Tooltip cursor={CURSOR} content={<ChartTooltip />} />
        <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        {ACTIVITY_TYPES.map((type, i) => (
          <Bar key={type} dataKey={type} name={t(`activityTypes.${type}`)} stackId="a" fill={ACTIVITY_COLORS[type]} maxBarSize={40} radius={i === ACTIVITY_TYPES.length - 1 ? [3, 3, 0, 0] : undefined} />
        ))}
      </BarChart>
    </ChartBox>
  );
}

export function ForecastMonthChart({ months, money, height }: { months: Forecast["byMonth"]; money: (n: number) => string; height?: number }) {
  const { t } = useTranslation("dashboard");
  const data = months.map((m) => ({ ...m, name: m.month === "none" ? t("noCloseDate") : monthLabel(m.month) }));
  return (
    <ChartBox height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} {...GRID} />
        <XAxis dataKey="name" tick={TICK} tickLine={false} axisLine={false} />
        <YAxis tick={TICK} tickLine={false} axisLine={false} width={84} tickFormatter={(v: number) => money(v)} />
        <Tooltip cursor={CURSOR} content={<ChartTooltip format={(v) => money(v)} />} />
        <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="amount" name={t("amount")} fill={chartColor("gray")} radius={[3, 3, 0, 0]} maxBarSize={28} />
        <Bar dataKey="weighted" name={t("weighted")} fill={chartColor("blue")} radius={[3, 3, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ChartBox>
  );
}
