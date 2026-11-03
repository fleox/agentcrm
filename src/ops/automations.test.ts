import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Activity, Automation } from "../core/types";
import { addNote } from "./activities";
import {
  AUTOMATION_TEMPLATES,
  MAX_AUTOMATION_DEPTH,
  clearAutomationRuns,
  createAutomation,
  createAutomationFromTemplate,
  deleteAutomation,
  duplicateAutomation,
  installAutomations,
  listAutomationRuns,
  renderTemplate,
  runAutomationEvent,
  runScheduled,
  setAutomationEnabled,
  setAutomationFetch,
  testAutomation,
  updateAutomation,
  validateAutomation,
} from "./automations";
import { moveStage } from "./pipelines";
import { createRecord, updateRecord } from "./records";
import { requireObject } from "./store";
import { setupTestCrm, type TestCrm } from "./testing";

const DAY = 86_400_000;

function tasksOf(t: TestCrm, recordId: string): Activity[] {
  return (t.store.list("activities") as unknown as Activity[]).filter((a) => a.type === "task" && a.targets.some((x) => x.id === recordId));
}
function notesOf(t: TestCrm, recordId: string): Activity[] {
  return (t.store.list("activities") as unknown as Activity[]).filter((a) => a.type === "note" && a.targets.some((x) => x.id === recordId));
}

describe("automations CRUD & validation", () => {
  let t: TestCrm;
  beforeEach(async () => {
    t = await setupTestCrm();
  });

  it("creates, updates, toggles, duplicates and deletes", async () => {
    const a = await createAutomation(t.admin, { name: " Welcome ", object: "people", trigger: { type: "record.created" }, actions: [{ type: "addNote", body: "Hi {{label}}" }] });
    expect(a.name).toBe("Welcome");
    expect(a.enabled).toBe(true);
    expect(a.conditions).toEqual([]);
    const u = await updateAutomation(t.admin, a.id, { name: "Welcome note" });
    expect(u.name).toBe("Welcome note");
    expect((await setAutomationEnabled(t.admin, a.id, false)).enabled).toBe(false);
    const copy = await duplicateAutomation(t.admin, a.id);
    expect(copy.name).toBe("Welcome note (copy)");
    expect(copy.enabled).toBe(false);
    await deleteAutomation(t.admin, a.id);
    expect(t.store.get("automations", a.id)).toBeUndefined();
  });

  it("reports every validation problem at once", () => {
    expect(() =>
      validateAutomation(t.admin, {
        name: "",
        object: "people",
        trigger: { type: "field.changed" },
        conditions: [{ field: "nope", op: "eq", value: 1 }],
        actions: [{ type: "webhook", url: "ftp://x" }, { type: "updateField", field: "ghost", value: 1 }, { type: "assignOwner", userId: "nobody" }],
      }),
    ).toThrow(/name is required.*needs a field.*nope.*https.*ghost.*nobody/);
    expect(() => validateAutomation(t.admin, { name: "x", object: "people", trigger: { type: "inactivity" }, actions: [{ type: "addNote", body: "x" }] })).toThrow(/days/);
    expect(() => validateAutomation(t.admin, { name: "x", object: "people", trigger: { type: "stage.changed" }, actions: [{ type: "addNote", body: "x" }] })).toThrow(/no pipeline/);
    expect(() => validateAutomation(t.admin, { name: "x", object: "ghosts", trigger: { type: "record.created" }, actions: [] })).toThrow(/Unknown object.*at least one action/);
  });

  it("enforces roles", async () => {
    const input = { name: "x", object: "people", trigger: { type: "record.created" as const }, actions: [{ type: "addNote" as const, body: "x" }] };
    await expect(createAutomation(t.as("member"), input)).rejects.toThrow(/Not allowed/);
    await expect(createAutomation(t.as("viewer"), input)).rejects.toThrow(/Not allowed/);
    await expect(runScheduled(t.as("viewer"))).rejects.toThrow(/Not allowed/);
    await expect(runScheduled(t.as("member"))).resolves.toMatchObject({ ran: 0 });
  });

  it("instantiates every template on the standard schema", async () => {
    for (const tpl of AUTOMATION_TEMPLATES) {
      const a = await createAutomationFromTemplate(t.admin, tpl.id);
      expect(a.object).toBe(tpl.requires[0]);
    }
    expect(t.store.list("automations")).toHaveLength(AUTOMATION_TEMPLATES.length);
    await expect(createAutomationFromTemplate(t.admin, "nope")).rejects.toThrow(/Unknown automation template/);
  });
});

describe("event triggers", () => {
  let t: TestCrm;
  let uninstall: () => void;
  beforeEach(async () => {
    t = await setupTestCrm();
    uninstall = installAutomations(t.plugins);
  });
  afterEach(() => uninstall());

  it("record.created → task with template, due date and owner; run logged", async () => {
    const a = await createAutomation(t.admin, {
      name: "Lead task",
      object: "people",
      trigger: { type: "record.created" },
      conditions: [{ field: "lifecycleStage", op: "eq", value: "lead" }],
      actions: [{ type: "createTask", title: "Call {{firstName}} ({{label}}, {{lifecycleStage}})", dueInDays: 2, assignTo: "owner" }],
    });
    const p = await createRecord(t.admin, "people", { firstName: "Grace", lastName: "Hopper", lifecycleStage: "lead" });
    const tasks = tasksOf(t, p.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Call Grace (Grace Hopper, Lead)");
    expect(tasks[0].dueAt).toBe(t.clock.now + 2 * DAY);
    expect(tasks[0].assigneeId).toBe("owner");
    const runs = listAutomationRuns(t.admin, { automationId: a.id });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "ok", recordId: p.id, actions: [{ type: "createTask", ok: true }] });
    expect((t.store.get("automations", a.id) as unknown as Automation).lastRunAt).toBe(t.clock.now);

    // Conditions not met → nothing.
    const c = await createRecord(t.admin, "people", { firstName: "Cust", lifecycleStage: "customer" });
    expect(tasksOf(t, c.id)).toHaveLength(0);
    // Disabled → nothing.
    await setAutomationEnabled(t.admin, a.id, false);
    const q = await createRecord(t.admin, "people", { firstName: "Q", lifecycleStage: "lead" });
    expect(tasksOf(t, q.id)).toHaveLength(0);
  });

  it("field.changed with `to` (option label or id) and record.updated with a field", async () => {
    await createAutomation(t.admin, { name: "Customer", object: "people", trigger: { type: "field.changed", field: "lifecycleStage", to: "Customer" }, actions: [{ type: "addNote", body: "Became {{lifecycleStage}}" }] });
    await createAutomation(t.admin, { name: "Any job change", object: "people", trigger: { type: "record.updated", field: "jobTitle" }, actions: [{ type: "addNote", body: "Job: {{jobTitle}}" }] });
    const p = await createRecord(t.admin, "people", { firstName: "A", lifecycleStage: "lead" });
    await updateRecord(t.admin, p.id, { lifecycleStage: "mql" });
    expect(notesOf(t, p.id)).toHaveLength(0);
    await updateRecord(t.admin, p.id, { lifecycleStage: "customer" });
    expect(notesOf(t, p.id).map((n) => n.body)).toEqual(["Became Customer"]);
    await updateRecord(t.admin, p.id, { jobTitle: "CTO" });
    expect(notesOf(t, p.id).map((n) => n.body).sort()).toEqual(["Became Customer", "Job: CTO"]);
  });

  it("stage.changed matches a stage kind (won) and runs every action", async () => {
    await createAutomationFromTemplate(t.admin, "deal-won-onboarding");
    const deal = await createRecord(t.admin, "deals", { name: "Big deal", amount: 1200 });
    await moveStage(t.admin, deal.id, "proposal");
    expect(tasksOf(t, deal.id)).toHaveLength(0);
    await moveStage(t.admin, deal.id, "Won");
    expect(tasksOf(t, deal.id).map((x) => x.title)).toEqual(["Kick off onboarding for Big deal"]);
    expect(notesOf(t, deal.id)[0].body).toContain("$1,200");
  });

  it("assignOwner round robin rotates over active admins / members and persists its cursor", async () => {
    const a = await createAutomationFromTemplate(t.admin, "new-lead-round-robin");
    const owners: (string | undefined)[] = [];
    for (let i = 0; i < 3; i++) {
      const p = await createRecord(t.admin, "people", { firstName: `L${i}`, lifecycleStage: "lead" });
      owners.push((t.store.get("records", p.id) as { ownerId?: string }).ownerId);
      // The first-touch task goes to the new owner.
      expect(tasksOf(t, p.id)[0].assigneeId).toBe(owners[i]);
    }
    // Ada Admin, Mel Member (viewer excluded), sorted by name.
    expect(owners).toEqual(["owner", "u-member", "owner"]);
    expect((t.store.get("automations", a.id) as { roundRobinCursor?: number }).roundRobinCursor).toBe(1);
  });

  it("stops loops with the depth limit and logs skipped runs", async () => {
    // Two automations ping-pong the industry forever.
    const a = await createAutomation(t.admin, { name: "To retail", object: "companies", trigger: { type: "field.changed", field: "industry", to: "software" }, actions: [{ type: "updateField", field: "industry", value: "retail" }] });
    const b = await createAutomation(t.admin, { name: "To software", object: "companies", trigger: { type: "field.changed", field: "industry", to: "retail" }, actions: [{ type: "updateField", field: "industry", value: "software" }] });
    const c = await createRecord(t.admin, "companies", { name: "Acme" });
    await updateRecord(t.admin, c.id, { industry: "software" });
    const runs = listAutomationRuns(t.admin).reverse();
    expect(runs.map((r) => [r.automationId, r.status])).toEqual([
      [a.id, "ok"],
      [b.id, "ok"],
      [a.id, "ok"],
      [b.id, "skipped"],
    ]);
    expect(runs).toHaveLength(MAX_AUTOMATION_DEPTH + 1);
    expect(runs[3].message).toMatch(/Loop protection/);
    // The last write (depth 3) stuck.
    expect((t.store.get("records", c.id) as unknown as { fields: Record<string, unknown> }).fields.industry).toBe("retail");
  });

  it("webhook posts JSON (best effort, failures logged as errors)", async () => {
    const calls: { url: string; body: unknown }[] = [];
    let fail = false;
    setAutomationFetch(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return fail ? { ok: false, status: 500 } : { ok: true, status: 200 };
    });
    try {
      const a = await createAutomation(t.admin, { name: "Hook", object: "companies", trigger: { type: "record.created" }, actions: [{ type: "webhook", url: "https://hooks.example.com/x" }, { type: "addNote", body: "after hook" }] });
      const c = await createRecord(t.admin, "companies", { name: "Hooked", industry: "software" });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://hooks.example.com/x");
      expect(calls[0].body).toMatchObject({ automation: { id: a.id, name: "Hook" }, trigger: "record.created", record: { id: c.id, label: "Hooked", display: { industry: "Software" } } });
      fail = true;
      const d = await createRecord(t.admin, "companies", { name: "Broken" });
      const run = listAutomationRuns(t.admin, { automationId: a.id, recordId: d.id })[0];
      expect(run.status).toBe("error");
      expect(run.message).toMatch(/HTTP 500/);
      // The other action still ran.
      expect(notesOf(t, d.id)).toHaveLength(1);
    } finally {
      setAutomationFetch(null);
    }
  });

  it("runAutomationEvent can be called directly and ignores deleted records", async () => {
    await createAutomation(t.admin, { name: "n", object: "companies", trigger: { type: "record.created" }, actions: [{ type: "addNote", body: "x" }] });
    uninstall();
    const c = await createRecord(t.admin, "companies", { name: "Direct" });
    expect(notesOf(t, c.id)).toHaveLength(0);
    const report = await runAutomationEvent(t.admin, { type: "record.created", payload: { record: c } });
    expect(report.ran).toBe(1);
    expect(notesOf(t, c.id)).toHaveLength(1);
    const gone = await runAutomationEvent(t.admin, { type: "record.created", payload: { record: { ...c, deletedAt: 1 } } });
    expect(gone.ran).toBe(0);
    uninstall = () => undefined;
  });
});

describe("scheduled triggers", () => {
  let t: TestCrm;
  beforeEach(async () => {
    t = await setupTestCrm();
  });

  it("inactivity fires once per idle period (idempotent across runs)", async () => {
    const a = await createAutomationFromTemplate(t.admin, "stale-deal-followup");
    const deal = await createRecord(t.admin, "deals", { name: "Sleepy" });
    const won = await createRecord(t.admin, "deals", { name: "Done", stage: "won" });
    expect((await runScheduled(t.admin)).ran).toBe(0);
    t.clock.now += 15 * DAY;
    const first = await runScheduled(t.admin);
    expect(first.ran).toBe(1);
    expect(tasksOf(t, deal.id)).toHaveLength(1);
    expect(tasksOf(t, won.id)).toHaveLength(0);
    // Same period: nothing new (the task itself counts as activity, and
    // the run key prevents duplicates anyway).
    expect((await runScheduled(t.admin)).ran).toBe(0);
    t.clock.now += 1 * DAY;
    expect((await runScheduled(t.admin)).ran).toBe(0);
    // 14 more idle days → a new follow-up.
    t.clock.now += 14 * DAY;
    expect((await runScheduled(t.admin)).ran).toBe(1);
    expect(tasksOf(t, deal.id)).toHaveLength(2);
    expect(listAutomationRuns(t.admin, { automationId: a.id })).toHaveLength(2);
  });

  it("inactivity with a non-activity action relies on run keys", async () => {
    await createAutomation(t.admin, { name: "Tag idle", object: "companies", trigger: { type: "inactivity", days: 7 }, actions: [{ type: "assignOwner", userId: "u-member" }] });
    const c = await createRecord(t.admin, "companies", { name: "Idle" });
    t.clock.now += 8 * DAY;
    expect((await runScheduled(t.admin)).ran).toBe(1);
    // assignOwner updated the record → its updatedAt moved: not idle any more.
    expect((await runScheduled(t.admin)).ran).toBe(0);
    await addNote(t.admin, c.id, "touch");
    t.clock.now += 3 * DAY;
    expect((await runScheduled(t.admin)).ran).toBe(0);
  });

  it("schedule respects everyHours, supports dry runs and a single automation", async () => {
    const a = await createAutomation(t.admin, { name: "Daily", object: "companies", trigger: { type: "schedule", everyHours: 24 }, conditions: [{ field: "industry", op: "eq", value: "software" }], actions: [{ type: "addNote", body: "Daily check of {{label}}" }] });
    const c = await createRecord(t.admin, "companies", { name: "Soft", industry: "software" });
    await createRecord(t.admin, "companies", { name: "Other", industry: "retail" });
    const dry = await runScheduled(t.admin, { dryRun: true });
    expect(dry.ran).toBe(1);
    expect(dry.runs[0].actions?.[0].message).toBe('Add note "Daily check of Soft"');
    expect(notesOf(t, c.id)).toHaveLength(0);
    expect(listAutomationRuns(t.admin)).toHaveLength(0);
    expect((await runScheduled(t.admin)).ran).toBe(1);
    t.clock.now += 3 * 3_600_000;
    expect((await runScheduled(t.admin)).ran).toBe(0);
    expect((await runScheduled(t.admin, { automationId: a.id, force: true })).ran).toBe(1);
    t.clock.now += 24 * 3_600_000;
    expect((await runScheduled(t.admin)).ran).toBe(1);
    expect(notesOf(t, c.id)).toHaveLength(3);
    const event = await createAutomation(t.admin, { name: "evt", object: "companies", trigger: { type: "record.created" }, actions: [{ type: "addNote", body: "x" }] });
    await expect(runScheduled(t.admin, { automationId: event.id })).rejects.toThrow(/only schedule/);
    expect((await clearAutomationRuns(t.admin)).deleted).toBe(3);
  });
});

describe("testAutomation & templates", () => {
  it("dry-runs on a record and reports failed conditions", async () => {
    const t = await setupTestCrm();
    const p = await createRecord(t.admin, "people", { firstName: "Ann", lastName: "Lee", lifecycleStage: "lead" });
    const def = { name: "x", object: "people", trigger: { type: "record.created" as const }, conditions: [{ field: "lifecycleStage", op: "eq" as const, value: "lead" }], actions: [{ type: "createTask" as const, title: "Hello {{label}}", dueInDays: 1 }] };
    const res = await testAutomation(t.admin, def, p.id);
    expect(res.matched).toBe(true);
    expect(res.run.actions?.[0].message).toBe('Create task "Hello Ann Lee" due in 1 day(s) for Ada Admin');
    expect(tasksOf(t, p.id)).toHaveLength(0);
    await updateRecord(t.admin, p.id, { lifecycleStage: "customer" });
    const miss = await testAutomation(t.admin, def, p.id);
    expect(miss.matched).toBe(false);
    expect(miss.failedConditions).toHaveLength(1);
    const real = await testAutomation(t.admin, { ...def, conditions: [] }, p.id, { dryRun: false });
    expect(real.run.status).toBe("ok");
    expect(tasksOf(t, p.id)).toHaveLength(1);
  });

  it("renders placeholders", async () => {
    const t = await setupTestCrm();
    const c = await createRecord(t.admin, "companies", { name: "Acme", annualRevenue: 5000, industry: "software" });
    const object = requireObject(t.store, "companies");
    expect(renderTemplate(t.admin, "{{label}} · {{industry}} · {{annualRevenue}} · {{owner}} · {{object}} · {{nope}}|", c, object)).toBe("Acme · Software · $5,000 · Ada Admin · Company · |");
    expect(renderTemplate(t.admin, "{{today}}", c, object)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

