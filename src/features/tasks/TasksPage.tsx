import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CheckSquare } from "lucide-react";
import { Checkbox, EmptyState, PageHeader } from "../../components/ui";
import { useActivities, useCurrentUser, useOps, useRecordLabel } from "../../app/CrmDataContext";
import { completeTask } from "../../ops/activities";
import { formatDate, cn } from "../../shared/lib/utils";
import { intlLocale } from "../../i18n";
import { recordHref } from "../../app/paths";

export function useOpenTaskCount(): number | null {
  const user = useCurrentUser();
  const activities = useActivities();
  const n = activities.filter((a) => a.type === "task" && !a.doneAt && (!a.assigneeId || a.assigneeId === user.id)).length;
  return n || null;
}

export function TasksPage() {
  const { t } = useTranslation("tasks");
  const ops = useOps();
  const user = useCurrentUser();
  const activities = useActivities();
  const labelOf = useRecordLabel();
  const tasks = useMemo(
    () => activities.filter((a) => a.type === "task" && !a.doneAt && (!a.assigneeId || a.assigneeId === user.id)).sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)),
    [activities, user.id],
  );
  const now = Date.now();
  return (
    <div>
      <PageHeader title={t("title")} icon={<CheckSquare />} />
      {tasks.length === 0 ? (
        <EmptyState className="py-24" icon={<CheckSquare />} title={t("empty")} description={t("emptyHint")} />
      ) : (
        <ul className="divide-y divide-surface-100 dark:divide-surface-800">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-3 px-6 py-2.5">
              <Checkbox checked={false} onChange={() => void completeTask(ops, task.id)} aria-label={task.title} />
              <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
              <span className="flex shrink-0 gap-1">
                {task.targets.map((tg) => (
                  <a key={tg.id} href={recordHref(tg.object, tg.id)} className="rounded border border-surface-200 px-1.5 text-xs text-surface-600 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-300">
                    {labelOf(tg.id) ?? tg.id}
                  </a>
                ))}
              </span>
              {task.dueAt && <span className={cn("w-28 shrink-0 text-right text-xs", task.dueAt < now ? "text-red-600" : "text-surface-500")}>{t("due", { date: formatDate(task.dueAt, intlLocale()) })}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
