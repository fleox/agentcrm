// Test helpers shared by every op / tool / feature test: a seeded memory
// store and contexts for each role. Not imported by production code.

import { createPluginRegistry, type PluginRegistry } from "../core/pluginRegistry";
import type { CrmUser, UserRole } from "../core/types";
import { createMemoryStore } from "../data/memory";
import type { DataStore } from "../data/types";
import { createOpsContext, type OpsContext } from "./context";
import { seedCrm } from "./seed";
import { userOf } from "./store";

// 2024-06-15 12:00 local time — every test sees the same "now".
export const TEST_NOW = new Date(2024, 5, 15, 12, 0, 0).getTime();

export interface TestCrm {
  store: DataStore;
  plugins: PluginRegistry;
  admin: OpsContext;
  as(role: UserRole | CrmUser | null): OpsContext;
  clock: { now: number };
}

export async function setupTestCrm(opts: { demo?: boolean; now?: number } = {}): Promise<TestCrm> {
  const store = createMemoryStore();
  await store.ready();
  const plugins = createPluginRegistry((hook, err) => {
    throw new Error(`plugin ${hook} failed: ${String(err)}`);
  });
  const clock = { now: opts.now ?? TEST_NOW };
  const now = () => clock.now;
  const system = createOpsContext(store, null, { now, plugins });
  await seedCrm(system, { admin: { name: "Ada Admin", email: "ada@example.com" }, demo: opts.demo, name: "Test CRM" });
  const adminUser = userOf(store, "owner")!;
  const extra: CrmUser[] = [
    { id: "u-member", email: "mel@example.com", name: "Mel Member", role: "member" },
    { id: "u-viewer", email: "vic@example.com", name: "Vic Viewer", role: "viewer" },
  ];
  await store.write(extra.map((u) => ({ op: "set" as const, collection: "users" as const, doc: { ...u } })));
  const as = (role: UserRole | CrmUser | null): OpsContext => {
    if (role === null) return system;
    const user = typeof role === "string" ? (role === "admin" ? adminUser : extra.find((u) => u.role === role)!) : role;
    return createOpsContext(store, user, { now, plugins });
  };
  return { store, plugins, admin: as("admin"), as, clock };
}
