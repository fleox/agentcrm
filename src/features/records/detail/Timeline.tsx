// Record timeline: every activity on the record AND on records pointing at
// it (a company's people / deals), grouped by month, with type filters,
// inline edit / delete / complete, plus record lifecycle events.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import type { Activity, ActivityType, CrmRecord, ObjectDef } from "../../../core/types";
import { Avatar, Button, Checkbox, confirmDialog, Dropdown, EmptyState, Input, Markdown, useFieldContext } from "../../../components/ui";
import { useActivities, useCan, useOps, useUsers } from "../../../app/CrmDataContext";
import { recordHref } from "../../../app/paths";
import { completeTask, deleteActivity, listActivities, updateActivity } from "../../../ops/activities";
import { toast } from "../../../shared/lib/toast";
import { cn, formatDateTime, formatRelative } from "../../../shared/lib/utils";
import { ACTIVITY_ICONS, ACTIVITY_TONES } from "./activityStyle";
import { ActivityComposer } from "./ActivityComposer";
import { MarkdownEditor } from "./MarkdownEditor";

function activityTime(a: Activity): number {
  return typeof a.meta?.startAt === "number" ? (a.meta.startAt as number) : a.createdAt;
}

function monthLabel(ms: number, locale: string): string {
  return new Date(ms).toLocaleDateString(locale, { month: "long", year: "numeric" });
}

export function ActivityItem({ activity, record, compact }: { activity: Activity; record?: CrmRecord; compact?: boolean }) {
  const { t } = useTranslation("records");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const ctx = useFieldContext();
  const users = useUsers({ includeDisabled: true });
  const canWrite = useCan("activities.write");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(activity.title);
  const [body, setBody] = useState(activity.body ?? "");
  const [expanded, setExpanded] = useState(false);
  const Icon = ACTIVITY_ICONS[activity.type];
  const author = users.find((u) => u.id === activity.createdBy);
  const assignee = users.find((u) => u.id === activity.assigneeId);
  const others = activity.targets.filter((tg) => tg.id !== record?.id);
  const long = (activity.body ?? "").length > 400;
  const meta = activity.meta ?? {};
  const now = Date.now();

  const save = async () => {
    try {
      await updateActivity(ops, activity.id, { title: title.trim() || activity.title, body });
      setEditing(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <li className="relative flex gap-3 pb-4" data-activity-id={activity.id}>
      <span className="absolute bottom-0 left-[13px] top-7 w-px bg-surface-200 dark:bg-surface-800" aria-hidden="true" />
      <span className={cn("relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full", ACTIVITY_TONES[activity.type])}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1 rounded-lg border border-surface-200 bg-white px-3 py-2 dark:border-surface-800 dark:bg-surface-900">
        <div className="flex items-start gap-2">
          {activity.type === "task" && (
            <Checkbox
              className="mt-0.5"
              aria-label={activity.doneAt ? t("timeline.reopen") : t("timeline.complete")}
              checked={!!activity.doneAt}
              disabled={!canWrite}
              onChange={(e) => void completeTask(ops, activity.id, e.target.checked).catch((err) => toast.error((err as Error).message))}
            />
          )}
          <div className="min-w-0 flex-1">
            {editing ? (
              <Input aria-label={t("composer.title")} value={title} onChange={(e) => setTitle(e.target.value)} />
            ) : (
              <div className={cn("text-[13px] font-medium text-surface-900 dark:text-white", activity.doneAt && activity.type === "task" && "text-surface-400 line-through")}>{activity.title}</div>
            )}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs text-surface-400">
              <span>{tc(`activityTypes.${activity.type}`)}</span>
              {author && (
                <span className="inline-flex items-center gap-1">
                  · <Avatar name={author.name} src={author.avatarUrl} size="xs" /> {author.name}
                </span>
              )}
              <span title={formatDateTime(activityTime(activity), ctx.locale)}>· {formatRelative(activityTime(activity), ctx.locale)}</span>
              {activity.type === "call" && typeof meta.durationMin === "number" && <span>· {t("timeline.duration", { count: meta.durationMin })}</span>}
              {(activity.type === "call" || activity.type === "email") && typeof meta.direction === "string" && <span>· {t(`composer.directions.${meta.direction}`, { defaultValue: String(meta.direction) })}</span>}
              {activity.type === "call" && typeof meta.outcome === "string" && <span>· {t(`composer.outcomes.${meta.outcome}`, { defaultValue: String(meta.outcome) })}</span>}
              {activity.type === "meeting" && typeof meta.startAt === "number" && (
                <span>
                  · {formatDateTime(meta.startAt as number, ctx.locale)}
                  {typeof meta.endAt === "number" ? ` – ${new Date(meta.endAt as number).toLocaleTimeString(ctx.locale, { hour: "2-digit", minute: "2-digit" })}` : ""}
                </span>
              )}
              {activity.type === "task" && activity.dueAt && (
                <span className={cn(!activity.doneAt && activity.dueAt < now && "font-medium text-red-600 dark:text-red-400")}>· {t("timeline.due", { date: formatDateTime(activity.dueAt, ctx.locale) })}</span>
              )}
              {assignee && activity.type === "task" && <span>· {t("timeline.assignedTo", { name: assignee.name })}</span>}
            </div>
          </div>
          {canWrite && !editing && (
            <Dropdown
              align="end"
              trigger={({ ref, onClick }) => (
                <button ref={ref as never} type="button" onClick={onClick} aria-label={t("timeline.menu")} className="rounded p-0.5 text-surface-400 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              )}
              items={[
                { id: "edit", label: tc("common.edit"), icon: <Pencil />, onSelect: () => setEditing(true) },
                ...(activity.type === "task" ? [{ id: "done", label: activity.doneAt ? t("timeline.reopen") : t("timeline.complete"), icon: <Check />, onSelect: () => void completeTask(ops, activity.id, !activity.doneAt) }] : []),
                {
                  id: "delete",
                  label: tc("common.delete"),
                  icon: <Trash2 />,
                  danger: true,
                  separator: true,
                  onSelect: async () => {
                    if (!(await confirmDialog({ title: tc("confirm.deleteTitle", { name: activity.title }), danger: true, confirmLabel: tc("common.delete") }))) return;
                    await deleteActivity(ops, activity.id).catch((err) => toast.error((err as Error).message));
                  },
                },
              ]}
            />
          )}
        </div>
        {editing ? (
          <div className="mt-2 space-y-2">
            <MarkdownEditor value={body} onChange={setBody} autoFocus onSubmit={() => void save()} onCancel={() => setEditing(false)} />
            <div className="flex justify-end gap-2">
              <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
                {tc("common.cancel")}
              </Button>
              <Button size="xs" variant="primary" onClick={() => void save()}>
                {tc("common.save")}
              </Button>
            </div>
          </div>
        ) : (
          activity.body &&
          !compact && (
            <div className={cn("relative mt-1.5", long && !expanded && "max-h-40 overflow-hidden")}>
              <Markdown source={activity.body} />
              {long && !expanded && <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white dark:from-surface-900" />}
            </div>
          )
        )}
        {long && !editing && !compact && (
          <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-1 text-2xs font-medium text-accent-700 hover:underline dark:text-accent-300">
            {expanded ? t("timeline.showLess") : t("timeline.showMore")}
          </button>
        )}
        {others.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {others.map((tg) => (
              <a key={tg.id} href={recordHref(tg.object, tg.id)} className="inline-flex items-center gap-1 rounded border border-surface-200 px-1.5 py-px text-2xs text-surface-600 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800">
                <Avatar name={ctx.recordLabel(tg.id) ?? "?"} size="xs" square={tg.object === "companies"} />
                {ctx.recordLabel(tg.id) ?? tg.id}
              </a>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

const FILTERS: ("all" | ActivityType)[] = ["all", "note", "task", "call", "email", "meeting"];

export function Timeline({ record, object }: { record: CrmRecord; object: ObjectDef }) {
  const { t } = useTranslation("records");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const ctx = useFieldContext();
  const all = useActivities();
  const users = useUsers({ includeDisabled: true });
  const canWrite = useCan("activities.write");
  const [filter, setFilter] = useState<"all" | ActivityType>("all");
  const [includeRelated, setIncludeRelated] = useState(true);
  const [composing, setComposing] = useState(false);

  const items = useMemo(() => listActivities(ops, { target: record.id, includeRelated }).items, [ops, record.id, includeRelated, all]);
  const shown = filter === "all" ? items : items.filter((a) => a.type === filter);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const a of items) c[a.type] = (c[a.type] ?? 0) + 1;
    return c;
  }, [items]);

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: Activity[] }[] = [];
    for (const a of shown) {
      const d = new Date(activityTime(a));
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      let g = out[out.length - 1];
      if (!g || g.key !== key) {
        g = { key, label: monthLabel(activityTime(a), ctx.locale), items: [] };
        out.push(g);
      }
      g.items.push(a);
    }
    return out;
  }, [shown, ctx.locale]);

  const creator = users.find((u) => u.id === record.createdBy);

  return (
    <div className="space-y-3" data-testid="timeline">
      {canWrite &&
        (composing ? (
          <ActivityComposer targets={[{ object: object.id, id: record.id }]} autoFocus onDone={() => setComposing(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="flex h-9 w-full items-center gap-2 rounded-lg border border-dashed border-surface-300 px-3 text-left text-[13px] text-surface-500 hover:border-surface-400 hover:bg-surface-50 dark:border-surface-700 dark:hover:bg-surface-900"
          >
            <Plus className="h-4 w-4" />
            {t("timeline.log")}
          </button>
        ))}
      <div className="flex flex-wrap items-center gap-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={cn("h-6 rounded-md px-2 text-xs", filter === f ? "bg-surface-900 text-white dark:bg-white dark:text-surface-900" : "text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800")}
          >
            {f === "all" ? t("timeline.all") : tc(`activityTypes.${f}`)}
            {counts[f] ? <span className="ml-1 opacity-60">{counts[f]}</span> : null}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-surface-500">
          <Checkbox checked={includeRelated} onChange={(e) => setIncludeRelated(e.target.checked)} />
          {t("timeline.includeRelated")}
        </label>
      </div>
      {shown.length === 0 ? (
        <EmptyState title={t("timeline.empty")} description={t("timeline.emptyHint")} />
      ) : (
        groups.map((g) => (
          <section key={g.key}>
            <h4 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-surface-400">{g.label}</h4>
            <ul>
              {g.items.map((a) => (
                <ActivityItem key={a.id} activity={a} record={record} />
              ))}
            </ul>
          </section>
        ))
      )}
      {filter === "all" && (
        <div className="flex items-center gap-3 pl-0.5 text-2xs text-surface-400">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-100 dark:bg-surface-800">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          {t("timeline.created", { object: object.labelSingular, when: formatDateTime(record.createdAt, ctx.locale), by: creator?.name ?? t("timeline.system") })}
        </div>
      )}
    </div>
  );
}
