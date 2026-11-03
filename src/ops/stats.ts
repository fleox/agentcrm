// Dataset overview (dashboard header, `agentcrm status`, doctor).

import { ACTIVITY_TYPES, type ActivityType } from "../core/types";
import { assertCan, type OpsContext } from "./context";
import { forecast } from "./pipelines";
import { activitiesOf, objectsOf, pipelinesOf, recordsOf, usersOf } from "./store";

export interface CrmStats {
  objects: { id: string; label: string; count: number; deleted: number }[];
  activities: Record<ActivityType, number>;
  openTasks: number;
  overdueTasks: number;
  users: number;
  pipeline: { pipelineId: string; openCount: number; openAmount: number; weightedAmount: number } | null;
  backend: string;
}

export function getStats(ctx: OpsContext): CrmStats {
  assertCan(ctx, "reports.read");
  const now = ctx.now();
  const activities = activitiesOf(ctx.store);
  const byType = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t, 0])) as Record<ActivityType, number>;
  for (const a of activities) byType[a.type]++;
  const tasks = activities.filter((a) => a.type === "task" && !a.doneAt);
  const firstPipeline = pipelinesOf(ctx.store, "deals")[0] ?? pipelinesOf(ctx.store)[0];
  const f = firstPipeline ? forecast(ctx, { pipelineId: firstPipeline.id }) : null;
  return {
    objects: objectsOf(ctx.store).map((o) => {
      const all = recordsOf(ctx.store, o.id, { includeDeleted: true });
      const deleted = all.filter((r) => r.deletedAt).length;
      return { id: o.id, label: o.labelPlural, count: all.length - deleted, deleted };
    }),
    activities: byType,
    openTasks: tasks.length,
    overdueTasks: tasks.filter((t) => t.dueAt !== undefined && t.dueAt < now).length,
    users: usersOf(ctx.store).filter((u) => !u.disabled).length,
    pipeline: f ? { pipelineId: f.pipelineId, openCount: f.openCount, openAmount: f.openAmount, weightedAmount: f.weightedAmount } : null,
    backend: ctx.store.kind,
  };
}
