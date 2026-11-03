// /tasks — My tasks / All / Overdue / Upcoming / Done, grouped by due date,
// with a text filter and an assignee filter.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckSquare, Plus, Search } from "lucide-react";
import { Button, Input, PageHeader, Select, Tabs } from "../../components/ui";
import { useActivities, useCan, useCurrentUser, useRecordLabel, useUsers } from "../../app/CrmDataContext";
import type { Activity } from "../../core/types";
import { TaskList } from "./TaskList";
import { TaskEditorModal } from "./TaskEditorModal";

export type TaskView = "mine" | "all" | "overdue" | "upcoming" | "done";
const VIEWS: TaskView[] = ["mine", "all", "overdue", "upcoming", "done"];
const VIEW_KEY = "agentcrm.tasks.view";

function isMine(task: Activity, userId: string): boolean {
  return !task.assigneeId || task.assigneeId === userId;
}

// Open tasks assigned to me (or unassigned) — nav badge.
export function useOpenTaskCount(): number | null {
  const user = useCurrentUser();
  const activities = useActivities();
  const n = activities.filter((a) => a.type === "task" && !a.doneAt && isMine(a, user.id)).length;
  return n || null;
}

export function filterTasksByView(tasks: Activity[], view: TaskView, userId: string, now: number): Activity[] {
  switch (view) {
    case "mine":
      return tasks.filter((a) => !a.doneAt && isMine(a, userId));
    case "all":
      return tasks.filter((a) => !a.doneAt);
    case "overdue":
      return tasks.filter((a) => !a.doneAt && a.dueAt !== undefined && a.dueAt < now);
    case "upcoming":
      return tasks.filter((a) => !a.doneAt && a.dueAt !== undefined && a.dueAt >= now);
    case "done":
      return tasks.filter((a) => !!a.doneAt);
  }
}

function readView(): TaskView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v && (VIEWS as string[]).includes(v)) return v as TaskView;
  } catch {
    // Storage blocked.
  }
  return "mine";
}

export function TasksPage() {
  const { t } = useTranslation("tasks");
  const user = useCurrentUser();
  const canWrite = useCan("activities.write");
  const activities = useActivities();
  const users = useUsers();
  const labelOf = useRecordLabel();
  const [view, setViewState] = useState<TaskView>(readView);
  const [q, setQ] = useState("");
  const [assignee, setAssignee] = useState("");
  const [creating, setCreating] = useState(false);
  const now = Date.now();

  const setView = (v: TaskView) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Not persisted.
    }
  };

  const tasks = useMemo(() => activities.filter((a) => a.type === "task"), [activities]);
  const showAssigneeFilter = view !== "mine";
  // Assignee filter applies to every view except "My tasks" (and their counts).
  const scoped = useMemo(
    () => (assignee ? tasks.filter((a) => (assignee === "none" ? !a.assigneeId : a.assigneeId === assignee)) : tasks),
    [tasks, assignee],
  );
  const counts = useMemo(() => {
    const out = {} as Record<TaskView, number>;
    for (const v of VIEWS) out[v] = filterTasksByView(v === "mine" ? tasks : scoped, v, user.id, now).length;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, scoped, user.id]);

  const visible = useMemo(() => {
    const base = filterTasksByView(showAssigneeFilter ? scoped : tasks, view, user.id, now);
    const needle = q.trim().toLowerCase();
    if (!needle) return base;
    return base.filter((a) => {
      const hay = [a.title, a.body ?? "", ...a.targets.map((tg) => labelOf(tg.id) ?? "")].join(" ").toLowerCase();
      return hay.includes(needle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, scoped, view, user.id, q, labelOf, showAssigneeFilter]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t("title")}
        icon={<CheckSquare />}
        actions={
          canWrite && (
            <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setCreating(true)}>
              {t("newTask")}
            </Button>
          )
        }
      >
        <div className="-mb-3 mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <Tabs className="-mb-px border-b-0" value={view} onChange={(v) => setView(v as TaskView)} tabs={VIEWS.map((v) => ({ id: v, label: t(`views.${v}`), count: counts[v] }))} />
          <div className="mb-2 flex items-center gap-2">
            <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("filter.search")} aria-label={t("filter.search")} className="w-48 sm:w-56" />
            {showAssigneeFilter && (
              <Select
                aria-label={t("filter.assignee")}
                className="w-40"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                options={[{ value: "", label: t("filter.anyone") }, { value: "none", label: t("unassigned") }, ...users.map((u) => ({ value: u.id, label: u.id === user.id ? t("filter.me", { name: u.name }) : u.name }))]}
              />
            )}
          </div>
        </div>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto bg-white dark:bg-surface-950">
        <TaskList tasks={visible} showTargets groupByDue emptyText={q.trim() ? t("filter.noMatch") : t(`emptyViews.${view}`)} />
      </div>
      <TaskEditorModal open={creating} onClose={() => setCreating(false)} defaultAssigneeId={user.id} />
    </div>
  );
}
