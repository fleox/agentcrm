// Task rows used by the tasks page and the record detail page (records
// feature): inline complete / reopen, edit due date, reassign, related
// record chips, edit modal and delete. Read-only without activities.write.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, CheckSquare, MoreHorizontal, Paperclip, Pencil, Trash2, UserRound, X } from "lucide-react";
import { AttachmentList, Avatar, Checkbox, confirmDialog, Dropdown, EmptyState, IconButton, Input, ObjectIcon, Popover, useFilesBridge, usePopover } from "../../components/ui";
import { deleteFile } from "../../ops/files";
import { useCan, useObjects, useOps, useRecordLabel, useUsers } from "../../app/CrmDataContext";
import { completeTask, deleteActivity, updateActivity } from "../../ops/activities";
import type { Activity, CrmUser } from "../../core/types";
import { recordHref } from "../../app/paths";
import { intlLocale } from "../../i18n";
import { toast } from "../../shared/lib/toast";
import { cn } from "../../shared/lib/utils";
import { TaskEditorModal } from "./TaskEditorModal";
import { addDays, fromDateTimeInputs, groupTasks, isOverdue, sortTasks, startOfDay, toDateInput, withDay } from "./taskUtils";

export interface TaskListProps {
  tasks: Activity[];
  showTargets?: boolean;
  emptyText?: string;
  groupByDue?: boolean;
}

function useNow(): number {
  // Re-evaluated on each render; good enough for due-date coloring.
  return Date.now();
}

export function TaskList({ tasks, showTargets = false, emptyText, groupByDue = false }: TaskListProps) {
  const { t } = useTranslation("tasks");
  const now = useNow();
  const [editing, setEditing] = useState<Activity | null>(null);
  const sections = useMemo(() => (groupByDue ? groupTasks(tasks, now) : [{ id: "all", tasks: sortTasks(tasks) }]), [tasks, groupByDue, now]);

  if (tasks.length === 0) {
    return <EmptyState className="py-10" icon={<CheckSquare />} title={emptyText ?? t("list.empty")} />;
  }
  return (
    <div className="text-[13px]">
      {sections.map((s) => (
        <section key={s.id} aria-label={groupByDue ? t(`groups.${s.id}`) : undefined}>
          {groupByDue && (
            <h3
              className={cn(
                "sticky top-0 z-[1] flex items-center gap-2 border-b border-surface-100 bg-surface-50/95 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide backdrop-blur dark:border-surface-800 dark:bg-surface-900/95",
                s.id === "overdue" ? "text-red-600 dark:text-red-400" : "text-surface-500",
              )}
            >
              {t(`groups.${s.id}`)}
              <span className="rounded bg-surface-200/70 px-1 text-2xs font-medium text-surface-600 dark:bg-surface-800 dark:text-surface-300">{s.tasks.length}</span>
            </h3>
          )}
          <ul className="divide-y divide-surface-100 dark:divide-surface-800">
            {s.tasks.map((task) => (
              <TaskRow key={task.id} task={task} now={now} showTargets={showTargets} onEdit={() => setEditing(task)} />
            ))}
          </ul>
        </section>
      ))}
      <TaskEditorModal open={!!editing} task={editing ?? undefined} onClose={() => setEditing(null)} />
    </div>
  );
}

function TaskRow({ task, now, showTargets, onEdit }: { task: Activity; now: number; showTargets: boolean; onEdit(): void }) {
  const { t } = useTranslation("tasks");
  const ops = useOps();
  const canWrite = useCan("activities.write");
  const labelOf = useRecordLabel();
  const objects = useObjects();
  const users = useUsers({ includeDisabled: true });
  const assignee = users.find((u) => u.id === task.assigneeId);
  const done = !!task.doneAt;
  const bridge = useFilesBridge();
  const [showFiles, setShowFiles] = useState(false);
  const attachments = bridge ? (task.attachments ?? []).filter((id) => { const m = bridge.meta(id); return !!m && !m.deletedAt; }) : [];

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const toggle = () => run(() => completeTask(ops, task.id, !done));
  const remove = async () => {
    if (!(await confirmDialog({ title: t("list.deleteConfirm", { title: task.title }), danger: true, confirmLabel: t("list.delete") }))) return;
    await run(async () => {
      await deleteActivity(ops, task.id);
      toast.success(t("toast.deleted"));
    });
  };

  return (
    <li className="group px-4 py-1.5 hover:bg-surface-50 dark:hover:bg-surface-900/60" data-task-id={task.id}>
      <div className="flex min-h-[28px] items-center gap-3">
      <Checkbox checked={done} disabled={!canWrite} onChange={() => void toggle()} aria-label={done ? t("list.reopen", { title: task.title }) : t("list.complete", { title: task.title })} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          onClick={onEdit}
          disabled={!canWrite}
          className={cn(
            "min-w-0 max-w-full truncate text-left font-medium text-surface-800 hover:underline disabled:cursor-default disabled:no-underline dark:text-surface-100",
            done && "text-surface-400 line-through dark:text-surface-500",
          )}
        >
          {task.title}
        </button>
        {showTargets &&
          task.targets.map((tg) => {
            const o = objects.find((x) => x.id === tg.object);
            return (
              <a
                key={tg.id}
                href={recordHref(tg.object, tg.id)}
                className="inline-flex max-w-[180px] items-center gap-1 rounded border border-surface-200 py-px pl-0.5 pr-1.5 text-xs text-surface-600 hover:bg-surface-100 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800"
              >
                <ObjectIcon name={o?.icon} color={o?.color} tile className="h-4 w-4" />
                <span className="truncate">{labelOf(tg.id) ?? tg.id}</span>
              </a>
            );
          })}
        {attachments.length > 0 && (
          <button
            type="button"
            onClick={() => setShowFiles((v) => !v)}
            aria-expanded={showFiles}
            title={t("list.attachments", { count: attachments.length })}
            className="inline-flex items-center gap-0.5 rounded px-1 py-px text-xs text-surface-500 hover:bg-surface-100 hover:text-surface-800 dark:hover:bg-surface-800 dark:hover:text-surface-100"
          >
            <Paperclip className="h-3 w-3" />
            {attachments.length}
          </button>
        )}
      </div>
      <DueChip task={task} now={now} disabled={!canWrite || done} onChange={(dueAt) => run(() => updateActivity(ops, task.id, { dueAt }))} />
      <AssigneeButton assignee={assignee} users={users} disabled={!canWrite} onChange={(id) => run(() => updateActivity(ops, task.id, { assigneeId: id }))} />
      {canWrite ? (
        <Dropdown
          align="end"
          trigger={({ ref, onClick }) => (
            <IconButton ref={ref} onClick={onClick} label={t("list.actions")} icon={<MoreHorizontal />} size="xs" className="opacity-60 group-hover:opacity-100 focus:opacity-100" />
          )}
          items={[
            { id: "edit", label: t("list.edit"), icon: <Pencil />, onSelect: onEdit },
            { id: "toggle", label: done ? t("list.markOpen") : t("list.markDone"), icon: <CheckSquare />, onSelect: () => void toggle() },
            { id: "delete", label: t("list.delete"), icon: <Trash2 />, danger: true, separator: true, onSelect: () => void remove() },
          ]}
        />
      ) : (
        <span className="w-6" />
      )}
      </div>
      {showFiles && attachments.length > 0 && <AttachmentList ids={attachments} size="sm" className="ml-7 mt-1.5 pb-1" onRemove={canWrite ? (f) => run(() => deleteFile(ops, f.id)) : undefined} />}
    </li>
  );
}

function DueChip({ task, now, disabled, onChange }: { task: Activity; now: number; disabled: boolean; onChange(dueAt: number | null): void }) {
  const { t } = useTranslation("tasks");
  const p = usePopover();
  const overdue = isOverdue(task, now);
  const today = startOfDay(now);
  const label = dueLabel(task.dueAt, now, t);
  const set = (v: number | null) => {
    p.close();
    onChange(v);
  };
  return (
    <>
      <button
        ref={p.anchorRef}
        type="button"
        disabled={disabled}
        onClick={p.toggle}
        title={t("list.dueDate")}
        aria-label={task.dueAt !== undefined ? t("list.dueOn", { date: label }) : t("list.setDue")}
        className={cn(
          "inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-xs tabular-nums transition-colors disabled:cursor-default",
          overdue ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400" : task.dueAt !== undefined ? "text-surface-600 dark:text-surface-300" : "text-surface-400",
          !disabled && "hover:bg-surface-100 dark:hover:bg-surface-800",
          task.dueAt === undefined && !disabled && "opacity-0 group-hover:opacity-100 focus:opacity-100",
        )}
      >
        <CalendarDays className="h-3.5 w-3.5" />
        <span className={cn(task.dueAt === undefined && "hidden sm:inline")}>{task.dueAt !== undefined ? label : t("list.noDue")}</span>
      </button>
      <Popover open={p.open} onClose={p.close} anchor={p.anchor} align="end">
        <div className="w-56 p-2 text-[13px]">
          <Input
            type="date"
            aria-label={t("list.dueDate")}
            defaultValue={toDateInput(task.dueAt)}
            onChange={(e) => {
              const v = fromDateTimeInputs(e.target.value);
              if (v !== undefined) set(withDay(v, task.dueAt));
            }}
          />
          <div className="mt-2 grid grid-cols-2 gap-1">
            {(
              [
                ["today", 0],
                ["tomorrow", 1],
                ["nextWeek", 7],
                ["inTwoWeeks", 14],
              ] as const
            ).map(([key, n]) => (
              <button key={key} type="button" onClick={() => set(withDay(addDays(today, n), task.dueAt))} className="rounded px-2 py-1 text-left text-xs text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-800">
                {t(`quick.${key}`)}
              </button>
            ))}
          </div>
          {task.dueAt !== undefined && (
            <button type="button" onClick={() => set(null)} className="mt-1 flex w-full items-center gap-1.5 border-t border-surface-100 px-2 pt-2 text-left text-xs text-surface-500 hover:text-surface-800 dark:border-surface-800 dark:hover:text-surface-100">
              <X className="h-3.5 w-3.5" /> {t("list.clearDue")}
            </button>
          )}
        </div>
      </Popover>
    </>
  );
}

function AssigneeButton({ assignee, users, disabled, onChange }: { assignee: CrmUser | undefined; users: CrmUser[]; disabled: boolean; onChange(id: string | null): void }) {
  const { t } = useTranslation("tasks");
  const p = usePopover();
  const [q, setQ] = useState("");
  const list = users.filter((u) => !u.disabled && `${u.name} ${u.email}`.toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (id: string | null) => {
    p.close();
    setQ("");
    onChange(id);
  };
  return (
    <>
      <button
        ref={p.anchorRef}
        type="button"
        disabled={disabled}
        onClick={p.toggle}
        title={assignee ? t("list.assignedTo", { name: assignee.name }) : t("unassigned")}
        aria-label={assignee ? t("list.assignedTo", { name: assignee.name }) : t("unassigned")}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:ring-2 hover:ring-surface-200 disabled:cursor-default disabled:hover:ring-0 dark:hover:ring-surface-700"
      >
        {assignee ? (
          <Avatar name={assignee.name} src={assignee.avatarUrl} size="sm" />
        ) : (
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-surface-300 text-surface-400 dark:border-surface-600">
            <UserRound className="h-3 w-3" />
          </span>
        )}
      </button>
      <Popover open={p.open} onClose={p.close} anchor={p.anchor} align="end">
        <div className="w-60 text-[13px]">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && list[0]) {
                e.preventDefault();
                pick(list[0].id);
              }
            }}
            placeholder={t("list.searchUsers")}
            className="h-9 w-full border-b border-surface-100 bg-transparent px-3 text-sm outline-none placeholder:text-surface-400 dark:border-surface-800"
          />
          <div className="max-h-60 overflow-y-auto py-1">
            {list.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => pick(u.id)}
                className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-100 dark:hover:bg-surface-800", u.id === assignee?.id && "font-medium")}
              >
                <Avatar name={u.name} src={u.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                {u.id === assignee?.id && <span className="text-accent-600">✓</span>}
              </button>
            ))}
            {list.length === 0 && <div className="px-3 py-2 text-surface-400">{t("list.noUsers")}</div>}
          </div>
          {assignee && (
            <button type="button" onClick={() => pick(null)} className="flex w-full items-center gap-1.5 border-t border-surface-100 px-3 py-2 text-left text-xs text-surface-500 hover:bg-surface-50 dark:border-surface-800 dark:hover:bg-surface-800">
              <X className="h-3.5 w-3.5" /> {t("list.unassign")}
            </button>
          )}
        </div>
      </Popover>
    </>
  );
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

// "Today 14:30", "Tomorrow", "Mon", "Jun 15" / "Jun 15, 2023".
export function dueLabel(dueAt: number | undefined, now: number, t: TFn): string {
  if (dueAt === undefined) return "";
  const locale = intlLocale();
  const today = startOfDay(now);
  const d = new Date(dueAt);
  const time = d.getHours() !== 9 || d.getMinutes() !== 0 ? ` ${new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d)}` : "";
  if (dueAt >= today && dueAt < addDays(today, 1)) return `${t("quick.today")}${time}`;
  if (dueAt >= addDays(today, 1) && dueAt < addDays(today, 2)) return `${t("quick.tomorrow")}${time}`;
  if (dueAt >= addDays(today, -1) && dueAt < today) return `${t("quick.yesterday")}${time}`;
  if (dueAt >= today && dueAt < addDays(today, 7)) return `${new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d)}${time}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" }).format(d);
}
