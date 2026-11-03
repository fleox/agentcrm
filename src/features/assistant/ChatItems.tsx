// Rendering of the conversation: user bubbles, markdown answers, tool call
// rows (collapsed, expandable) and inline approval cards.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Check, ChevronRight, Info, ShieldCheck, Wrench, X } from "lucide-react";
import { Badge, Button, Spinner } from "../../components/ui";
import { cn } from "../../shared/lib/utils";
import type { ApprovalDecision, DisplayItem } from "../../ai/assistant";
import { renderAssistantMarkdown } from "./markdown";

type ToolItem = Extract<DisplayItem, { kind: "tool" }>;

export function prettyJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

const MARKDOWN_CLASSES = cn(
  "markdown break-words text-sm leading-relaxed text-surface-800 dark:text-surface-100",
  "[&_a]:text-accent-700 [&_a]:underline dark:[&_a]:text-accent-300 [&_blockquote]:border-l-2 [&_blockquote]:border-surface-200 [&_blockquote]:pl-3 [&_blockquote]:text-surface-500",
  "[&_code]:rounded [&_code]:bg-surface-100 [&_code]:px-1 [&_code]:text-[12px] dark:[&_code]:bg-surface-800 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:font-semibold",
  "[&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-surface-100 [&_pre]:p-2 dark:[&_pre]:bg-surface-800 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_table]:my-2 [&_table]:w-full [&_table]:text-xs [&_td]:border [&_td]:border-surface-200 [&_td]:px-1.5 [&_td]:py-1 [&_th]:border [&_th]:border-surface-200 [&_th]:bg-surface-50 [&_th]:px-1.5 [&_th]:py-1 [&_th]:text-left dark:[&_td]:border-surface-700 dark:[&_th]:border-surface-700 dark:[&_th]:bg-surface-800",
);

function AssistantText({ text, streaming }: { text: string; streaming?: boolean }) {
  const html = useMemo(() => renderAssistantMarkdown(text), [text]);
  return (
    <div className="min-w-0">
      <div className={MARKDOWN_CLASSES} dangerouslySetInnerHTML={{ __html: html }} />
      {streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-surface-400 align-middle" aria-hidden="true" />}
    </div>
  );
}

const STATUS_COLOR: Record<ToolItem["status"], string> = { pending: "yellow", running: "blue", done: "green", error: "red", rejected: "gray" };

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="space-y-1">
      <div className="text-2xs font-medium uppercase tracking-wide text-surface-400">{label}</div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-50 p-2 font-mono text-[11px] leading-snug text-surface-700 dark:bg-surface-950 dark:text-surface-300">{prettyJson(value)}</pre>
    </div>
  );
}

function ToolRow({ item }: { item: ToolItem }) {
  const { t } = useTranslation("assistant");
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-surface-200 bg-white text-xs dark:border-surface-800 dark:bg-surface-900">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-surface-50 dark:hover:bg-surface-800/60">
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-surface-400 transition-transform", open && "rotate-90")} />
        <Wrench className="h-3.5 w-3.5 shrink-0 text-surface-400" />
        <span className="min-w-0 flex-1 truncate font-mono text-surface-700 dark:text-surface-200">{item.name}</span>
        <span className={cn("inline-flex", item.status !== "running" && "hidden")}>
          <Spinner size="sm" />
        </span>
        <Badge color={STATUS_COLOR[item.status]}>{t(`tool.${item.status}`)}</Badge>
      </button>
      {open && (
        <div className="space-y-2 border-t border-surface-100 p-2 dark:border-surface-800">
          <JsonBlock label={t("tool.input")} value={item.input} />
          {item.result !== undefined && <JsonBlock label={t("tool.result")} value={item.result} />}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ item, onDecide }: { item: ToolItem; onDecide(id: string, d: ApprovalDecision): void }) {
  const { t } = useTranslation("assistant");
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10" role="group" aria-label={t("approval.title")}>
      <div className="flex items-center gap-2 font-medium text-surface-900 dark:text-white">
        <ShieldCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        {t("approval.title")}
      </div>
      <p className="mt-1 text-xs text-surface-600 dark:text-surface-300">
        {t("approval.description")} <code className="rounded bg-white px-1 font-mono text-[11px] dark:bg-surface-900">{item.name}</code>
      </p>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 font-mono text-[11px] leading-snug text-surface-700 dark:bg-surface-950 dark:text-surface-300">{prettyJson(item.input)}</pre>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="primary" icon={<Check />} onClick={() => onDecide(item.id, "approve")}>
          {t("approval.approve")}
        </Button>
        <Button size="sm" variant="outline" icon={<ShieldCheck />} onClick={() => onDecide(item.id, "always")} title={t("approval.alwaysHint")}>
          {t("approval.always")}
        </Button>
        <Button size="sm" variant="ghost" icon={<X />} onClick={() => onDecide(item.id, "reject")}>
          {t("approval.reject")}
        </Button>
      </div>
    </div>
  );
}

export function ChatItemView({ item, onDecide }: { item: DisplayItem; onDecide(id: string, d: ApprovalDecision): void }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-surface-100 px-3 py-2 text-sm text-surface-900 dark:bg-surface-800 dark:text-surface-100">{item.text}</div>
        </div>
      );
    case "assistant":
      return <AssistantText text={item.text} streaming={item.streaming} />;
    case "tool":
      return item.status === "pending" ? <ApprovalCard item={item} onDecide={onDecide} /> : <ToolRow item={item} />;
    case "error":
      return (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 break-words">{item.message}</span>
        </div>
      );
    case "notice":
      return (
        <div className="flex items-center gap-1.5 text-xs text-surface-500">
          <Info className="h-3.5 w-3.5" />
          {item.text}
        </div>
      );
    default:
      return null;
  }
}
