import type { DataStore, StoredDoc } from "../../src/data/types";
import type { OpsContext } from "../../src/ops/context";

// Runs an op against an in-memory copy of the session's dataset: the CLI
// shows exactly what an op would do (its result, or the error it would
// raise) before the user confirms with --yes. Nothing reaches the real
// store and no plugin action fires (isolated registry).

export async function dryRun<T>(ctx: OpsContext, work: (copy: OpsContext) => Promise<T> | T): Promise<{ result: T; store: DataStore }> {
  const [{ createMemoryStore }, { COLLECTIONS }, { createOpsContext }, { createPluginRegistry }] = await Promise.all([
    import("../../src/data/memory"),
    import("../../src/data/types"),
    import("../../src/ops/context"),
    import("../../src/core/pluginRegistry"),
  ]);
  const initial = Object.fromEntries(COLLECTIONS.map((c) => [c, ctx.store.list(c).map((d) => structuredClone(d) as StoredDoc)]));
  const store = createMemoryStore({ initial });
  await store.ready();
  const copy = createOpsContext(store, ctx.user, { now: ctx.now, plugins: createPluginRegistry(() => undefined) });
  return { result: await work(copy), store };
}
