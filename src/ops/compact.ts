// Physical purge (GDPR erasure): hard-deletes soft-deleted records (and
// their activities), soft-deleted activities and old automation runs,
// then asks the backend to rewrite its storage without history
// (journal: new snapshot + merged segments deleted).

import type { DocMutation } from "../data/types";
import { assertCan, type OpsContext } from "./context";
import { hardDeleteMutations } from "./records";
import { activitiesOf, automationRunsOf, recordsOf } from "./store";

export interface CompactOptions {
  // Only purge items deleted more than N days ago (default 0 = all).
  olderThanDays?: number;
  // Automation runs kept (most recent first). Default 500.
  keepRuns?: number;
  dryRun?: boolean;
}

export interface CompactReport {
  purgedRecords: string[];
  purgedActivities: number;
  purgedRuns: number;
  storageCompacted: boolean;
  dryRun: boolean;
}

export async function compactData(ctx: OpsContext, opts: CompactOptions = {}): Promise<CompactReport> {
  assertCan(ctx, "compact");
  const cutoff = ctx.now() - (opts.olderThanDays ?? 0) * 86_400_000;
  const records = recordsOf(ctx.store, undefined, { includeDeleted: true }).filter((r) => r.deletedAt && r.deletedAt <= cutoff);
  const ids = records.map((r) => r.id);
  const mutations: DocMutation[] = ids.length ? hardDeleteMutations(ctx, ids) : [];
  const alreadyDeleted = new Set(mutations.filter((m) => m.op === "delete" && m.collection === "activities").map((m) => (m as { id: string }).id));
  let purgedActivities = alreadyDeleted.size;
  for (const a of activitiesOf(ctx.store, { includeDeleted: true })) {
    if (a.deletedAt && a.deletedAt <= cutoff && !alreadyDeleted.has(a.id)) {
      mutations.push({ op: "delete", collection: "activities", id: a.id });
      purgedActivities++;
    }
  }
  const keep = opts.keepRuns ?? 500;
  const runs = automationRunsOf(ctx.store).sort((a, b) => b.startedAt - a.startedAt);
  const oldRuns = runs.slice(keep);
  for (const r of oldRuns) mutations.push({ op: "delete", collection: "automationRuns", id: r.id });

  const report: CompactReport = { purgedRecords: ids, purgedActivities, purgedRuns: oldRuns.length, storageCompacted: false, dryRun: !!opts.dryRun };
  if (opts.dryRun) return report;
  if (mutations.length) await ctx.store.write(mutations, { message: `Purge ${ids.length} deleted records` });
  if (ctx.store.compact) {
    await ctx.store.compact();
    report.storageCompacted = true;
  }
  return report;
}
