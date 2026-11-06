import type { CrmRecord } from "../../src/core/types";
import type { OpsContext } from "../../src/ops/context";
import { table } from "./util";

// Human (non --json) renderings of command results. They read the dataset
// through the session's context to show labels instead of ids; the --json
// output never goes through this file.

export interface HumanFormat {
  locale: string;
  currency: string;
  // Formatted value of one field of a record of `objectId` (relations by label).
  field(objectId: string, fieldId: string, value: unknown): string;
  // Label of a field ("" when unknown).
  fieldLabel(objectId: string, fieldId: string): string;
  money(n: number, currency?: string): string;
  userName(id: string | null | undefined): string;
}

export async function humanFormat(ctx: OpsContext): Promise<HumanFormat> {
  const { formatFieldValue, formatCurrency, recordLabel } = await import("../../src/core/fields");
  const { objectOf, recordOf, userOf } = await import("../../src/ops/store");
  const { getSettings } = await import("../../src/ops/settings");
  let locale = "en-US";
  let currency = "USD";
  try {
    const s = getSettings(ctx);
    locale = s.locale || locale;
    currency = s.defaultCurrency || currency;
  } catch {
    // Viewers without settings access keep the defaults.
  }
  const userName = (id: string | null | undefined) => (id ? userOf(ctx.store, id)?.name ?? id : "");
  const fileName = (id: string) => (ctx.store.get("files", id) as { name?: string } | undefined)?.name;
  return {
    locale,
    currency,
    field(objectId, fieldId, value) {
      const def = objectOf(ctx.store, objectId)?.fields.find((f) => f.id === fieldId);
      if (!def) return value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
      return formatFieldValue(def, value, {
        locale,
        currency,
        recordLabel: (object, id) => {
          const r = recordOf(ctx.store, id);
          return r ? recordLabel(objectOf(ctx.store, r.object ?? object), r) : undefined;
        },
        userName: (id) => userOf(ctx.store, id)?.name,
        fileName,
      });
    },
    fieldLabel(objectId, fieldId) {
      return objectOf(ctx.store, objectId)?.fields.find((f) => f.id === fieldId)?.label ?? "";
    },
    money(n, cur) {
      return formatCurrency(n, cur || currency, locale);
    },
    userName,
  };
}

// `records list --columns a,b`: one row per record, the requested fields
// formatted (labels as headers when they are unique).
export function recordRows(fmt: HumanFormat, objectId: string, records: CrmRecord[], columns: string[]): { rows: Record<string, unknown>[]; headers: string[] } {
  const labels = columns.map((c) => fmt.fieldLabel(objectId, c) || c);
  const headers = new Set(labels).size === labels.length && !labels.includes("id") ? labels : columns;
  const rows = records.map((r) => Object.fromEntries([["id", r.id], ...columns.map((c, i) => [headers[i], fmt.field(objectId, c, r.fields[c])])]));
  return { rows, headers: ["id", ...headers] };
}

// "2026-10-03T11:59:43.343Z" → "2026-10-03 11:59 UTC".
function when(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : iso;
}

// `records get`: key: value listing.
export function recordDetails(
  fmt: HumanFormat,
  r: { id: string; object: string; label: unknown; fields: Record<string, unknown>; ownerId?: string; createdAt: string; updatedAt: string; createdBy?: string; updatedBy?: string; fieldUpdates?: Record<string, { by: string; at: string }>; deletedAt?: string },
  order: string[],
  extra: { related?: { object: string; field: string; label?: string; fieldLabel?: string; records: { id: string; label?: string }[] }[]; activityCount?: number } = {},
): string {
  const ids = [...order.filter((id) => id in r.fields), ...Object.keys(r.fields).filter((id) => !order.includes(id))];
  const pairs: [string, string][] = ids
    .map((id): [string, string] => [fmt.fieldLabel(r.object, id) || id, fmt.field(r.object, id, r.fields[id])])
    .filter(([, v]) => v !== "");
  if (r.ownerId) pairs.push(["Owner", fmt.userName(r.ownerId)]);
  if (extra.activityCount !== undefined) pairs.push(["Activities", String(extra.activityCount)]);
  pairs.push(["Created", `${when(r.createdAt)}${r.createdBy ? ` by ${fmt.userName(r.createdBy)}` : ""}`]);
  pairs.push(["Updated", `${when(r.updatedAt)}${r.updatedBy ? ` by ${fmt.userName(r.updatedBy)}` : ""}`]);
  const width = Math.max(0, ...pairs.map(([k]) => k.length));
  const lines = [`${String(r.label)}  (${r.object} ${r.id})${r.deletedAt ? `  [deleted ${when(r.deletedAt)}]` : ""}`, ...pairs.map(([k, v]) => `  ${`${k}:`.padEnd(width + 1)} ${v}`)];
  const related = (extra.related ?? []).filter((rel) => rel.records.length);
  if (related.length) lines.push("Related:");
  for (const rel of related) {
    const shown = rel.records.slice(0, 5).map((x) => x.label ?? x.id);
    lines.push(`  ${rel.label ?? rel.object} (${rel.fieldLabel ?? rel.field}): ${shown.join(", ")}${rel.records.length > shown.length ? ` +${rel.records.length - shown.length} more` : ""}`);
  }
  const updates = Object.entries(r.fieldUpdates ?? {});
  if (updates.length) {
    lines.push("Last writes:");
    const byWriter = new Map<string, { fields: string[]; at: string }>();
    for (const [field, u] of updates) {
      const e = byWriter.get(u.by) ?? { fields: [], at: u.at };
      e.fields.push(fmt.fieldLabel(r.object, field) || field);
      if (u.at > e.at) e.at = u.at;
      byWriter.set(u.by, e);
    }
    for (const [by, e] of byWriter) lines.push(`  ${fmt.userName(by)} (${when(e.at)}): ${e.fields.join(", ")}`);
  }
  return lines.join("\n");
}

const pct = (n: number | null) => (n === null ? "—" : `${n} %`);

// `report <name>`: one compact table per report (+ totals).
export function reportText(fmt: HumanFormat, name: string, data: unknown): string {
  const d = data as Record<string, unknown>;
  const cur = typeof d.currency === "string" ? d.currency : undefined;
  const money = (n: unknown) => fmt.money(Math.round(typeof n === "number" ? n : 0), cur);
  const right = { right: ["Deals", "Amount", "Weighted", "Prob.", "Won", "Won amount", "Lost", "Lost amount", "Win rate", "People", "Customers", "Total", "Count", "Reached", "Conversion", "Idle days", "Tasks done", "Tasks open", "note", "task", "call", "email", "meeting"] };
  switch (name) {
    case "pipelineByStage": {
      const stages = d.stages as { label: string; kind: string; count: number; amount: number; weighted: number }[];
      const open = stages.filter((s) => s.kind === "open");
      return [
        table(stages.map((s) => ({ Stage: s.label, Kind: s.kind, Deals: s.count, Amount: money(s.amount), Weighted: money(s.weighted) })), ["Stage", "Kind", "Deals", "Amount", "Weighted"], right),
        `Open: ${open.reduce((a, s) => a + s.count, 0)} deal(s), ${money(open.reduce((a, s) => a + s.amount, 0))} (weighted ${money(open.reduce((a, s) => a + s.weighted, 0))})`,
      ].join("\n");
    }
    case "forecast": {
      const f = d as unknown as import("../../src/ops/pipelines").Forecast;
      return [
        `Open: ${f.openCount} deal(s), ${money(f.openAmount)} (weighted ${money(f.weightedAmount)}). Won ${money(f.wonAmount)}, lost ${money(f.lostAmount)}.`,
        "",
        table(f.byStage.map((s) => ({ Stage: s.label, Kind: s.kind, "Prob.": `${s.probability} %`, Deals: s.count, Amount: money(s.amount), Weighted: money(s.weighted) })), ["Stage", "Kind", "Prob.", "Deals", "Amount", "Weighted"], right),
        "",
        "Open deals by close month:",
        table(f.byMonth.map((m) => ({ Month: m.month === "none" ? "(no date)" : m.month, Deals: m.count, Amount: money(m.amount), Weighted: money(m.weighted) })), ["Month", "Deals", "Amount", "Weighted"], right),
      ].join("\n");
    }
    case "wonLost": {
      const w = d as unknown as { months: import("../../src/ops/reports").WonLostRow[]; totals: Omit<import("../../src/ops/reports").WonLostRow, "month"> };
      const row = (month: string, r: Omit<import("../../src/ops/reports").WonLostRow, "month">) => ({ Month: month, Won: r.wonCount, "Won amount": money(r.wonAmount), Lost: r.lostCount, "Lost amount": money(r.lostAmount), "Win rate": pct(r.winRate) });
      return table([...w.months.map((m) => row(m.month, m)), row("Total", w.totals)], ["Month", "Won", "Won amount", "Lost", "Lost amount", "Win rate"], right);
    }
    case "activityByUser": {
      const a = d as unknown as { days: number; users: import("../../src/ops/reports").ActivityByUserRow[] };
      return [
        `Last ${a.days} day(s):`,
        table(a.users.map((u) => ({ User: u.name, Total: u.total, ...u.byType, "Tasks done": u.tasksDone, "Tasks open": u.tasksOpen })), ["User", "Total", "note", "task", "call", "email", "meeting", "Tasks done", "Tasks open"], right),
      ].join("\n");
    }
    case "leadSources": {
      const l = d as unknown as { sources: { label: string; count: number; customers: number }[] };
      return table(l.sources.map((s) => ({ Source: s.label, People: s.count, Customers: s.customers })), ["Source", "People", "Customers"], right);
    }
    case "staleDeals": {
      const s = d as unknown as { days: number; deals: import("../../src/ops/reports").StaleDeal[] };
      return [
        `Open deals idle for ${s.days}+ day(s): ${s.deals.length}`,
        table(s.deals.map((x) => ({ Deal: x.label, Stage: x.stage, Amount: money(x.amount), "Idle days": x.idleDays, Owner: fmt.userName(x.ownerId), id: x.id })), ["Deal", "Stage", "Amount", "Idle days", "Owner", "id"], right),
      ].join("\n");
    }
    case "conversion": {
      const c = d as unknown as { stages: { label: string; count: number; reached: number; conversionFromPrevious: number | null }[] };
      return table(c.stages.map((s) => ({ Stage: s.label, Count: s.count, Reached: s.reached, Conversion: pct(s.conversionFromPrevious) })), ["Stage", "Count", "Reached", "Conversion"], right);
    }
    default:
      return JSON.stringify(data, null, 2);
  }
}

// Breaks a sentence into lines of at most `width` characters, each prefixed
// with `indent`.
export function wrapText(text: string, width = 76, indent = ""): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && indent.length + line.length + 1 + word.length > width) {
      lines.push(indent + line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(indent + line);
  return lines.join("\n");
}
