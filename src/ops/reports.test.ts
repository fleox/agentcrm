import { describe, expect, it } from "vitest";
import { setupTestCrm, TEST_NOW } from "./testing";
import { activityByUser, conversion, leadSources, pipelineByStage, runReport, staleDeals, wonLost } from "./reports";
import { getStats } from "./stats";
import { createRecord } from "./records";
import { compactData } from "./compact";
import { deleteRecord } from "./records";
import { seedCrm } from "./seed";
import { addNote } from "./activities";

describe("seed", () => {
  it("is idempotent and the demo dataset is deterministic and consistent", async () => {
    const a = await setupTestCrm({ demo: true });
    const b = await setupTestCrm({ demo: true });
    const ids = (s: typeof a.store) => s.list("records").map((r) => r.id).sort();
    expect(ids(a.store)).toEqual(ids(b.store));
    const stats = getStats(a.admin);
    expect(stats.objects.map((o) => [o.id, o.count])).toEqual([["companies", 30], ["people", 80], ["deals", 40]]);
    expect(stats.activities.note + stats.activities.call + stats.activities.email + stats.activities.meeting + stats.activities.task).toBe(150);
    // Every relation points at an existing record.
    const all = new Set(a.store.list("records").map((r) => r.id));
    for (const r of a.store.list("records")) {
      const f = r.fields as Record<string, unknown>;
      for (const v of [f.company, ...((f.contacts as string[]) ?? [])]) if (v) expect(all.has(v as string)).toBe(true);
    }
    const emails = a.store.list("records").filter((r) => r.object === "people").map((r) => (r.fields as Record<string, unknown>).email);
    expect(new Set(emails).size).toBe(80);
    const before = a.store.list("records").length;
    await seedCrm(a.as(null), { admin: { name: "Ada Admin", email: "ada@example.com" }, demo: true });
    expect(a.store.list("records").length).toBe(before);
  });
});

describe("reports", () => {
  it("pipeline by stage, won / lost, stale deals on demo data", async () => {
    const { admin } = await setupTestCrm({ demo: true });
    const p = pipelineByStage(admin);
    expect(p.stages.map((s) => s.count)).toEqual([8, 9, 7, 5, 7, 4]);
    const wl = wonLost(admin, { months: 12 });
    expect(wl.months).toHaveLength(12);
    expect(wl.months[11].month).toBe("2024-06");
    expect(wl.totals.wonCount + wl.totals.lostCount).toBeLessThanOrEqual(11);
    expect(wl.totals.winRate === null || (wl.totals.winRate >= 0 && wl.totals.winRate <= 100)).toBe(true);
    const stale = staleDeals(admin, { days: 0 });
    expect(stale.deals).toHaveLength(29);
    expect(runReport(admin, "conversion")).toEqual(conversion(admin));
    expect(() => runReport(admin, "nope")).toThrow(/Unknown report/);
  });

  it("activity by user, lead sources, conversion funnel", async () => {
    const { admin } = await setupTestCrm();
    const c = await createRecord(admin, "companies", { name: "A" });
    await addNote(admin, c.id, "hello");
    const abu = activityByUser(admin, { days: 7 });
    expect(abu.users[0]).toMatchObject({ userId: "owner", total: 1 });
    await createRecord(admin, "people", { name: "P1", leadSource: "website", lifecycleStage: "customer" });
    await createRecord(admin, "people", { name: "P2", leadSource: "website", lifecycleStage: "lead" });
    await createRecord(admin, "people", { name: "P3", lifecycleStage: "mql" });
    expect(leadSources(admin).sources).toEqual([
      { id: "website", label: "Website", count: 2, customers: 1 },
      { id: null, label: "Unknown", count: 1, customers: 0 },
    ]);
    const funnel = conversion(admin).stages;
    expect(funnel.find((s) => s.id === "lead")!.reached).toBe(3);
    expect(funnel.find((s) => s.id === "customer")!.reached).toBe(1);
    expect(funnel.find((s) => s.id === "mql")!.conversionFromPrevious).toBeCloseTo(66.7);
  });
});

describe("compact", () => {
  it("purges soft-deleted records and their activities, then compacts the store", async () => {
    const crm = await setupTestCrm();
    const c = await createRecord(crm.admin, "companies", { name: "Gone" });
    const keep = await createRecord(crm.admin, "companies", { name: "Kept" });
    await addNote(crm.admin, c.id, "secret");
    await deleteRecord(crm.admin, c.id);
    const dry = await compactData(crm.admin, { dryRun: true });
    expect(dry.purgedRecords).toEqual([c.id]);
    expect(crm.store.get("records", c.id)).toBeTruthy();
    crm.clock.now = TEST_NOW + 1000;
    const res = await compactData(crm.admin);
    expect(res).toMatchObject({ purgedRecords: [c.id], purgedActivities: 1, storageCompacted: false });
    expect(crm.store.get("records", c.id)).toBeUndefined();
    expect(crm.store.list("activities")).toHaveLength(0);
    expect(crm.store.get("records", keep.id)).toBeTruthy();
    await expect(compactData(crm.as("member"))).rejects.toMatchObject({ code: "forbidden" });
  });
});
