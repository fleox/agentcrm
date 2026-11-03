// Moves a whole CRM to another backend with ids preserved (Settings →
// Data backend → Transfer): exportJson from the current store, importJson
// into the target (which must be empty unless `overwrite`), then the
// admin may switch this browser to it. Pure over two DataStores.

import type { DataStore } from "../../../data/types";
import { createOpsContext } from "../../../ops/context";
import { exportJson, importJson } from "../../../ops/exportCsv";
import type { CrmUser } from "../../../core/types";

export interface TransferReport {
  written: number;
  collections: Record<string, number>;
}

export async function transferData(from: DataStore, to: DataStore, opts: { user?: CrmUser | null; overwrite?: boolean } = {}): Promise<TransferReport> {
  await from.ready();
  await to.ready();
  if (!opts.overwrite && to.list("objects").length > 0) {
    throw new Error("The destination already holds a CRM. Pick an empty location (or confirm overwriting).");
  }
  const data = exportJson(createOpsContext(from, opts.user ?? null));
  const res = await importJson(createOpsContext(to, null), data, { mode: opts.overwrite ? "replace" : "merge" });
  const collections: Record<string, number> = {};
  for (const [c, docs] of Object.entries(data.collections ?? {})) collections[c] = (docs as unknown[]).length;
  return { written: res.written, collections };
}
