import { describe, expect, it } from "vitest";
import { setupTestCrm, TEST_NOW } from "./testing";
import { createRecord } from "./records";
import { addActivity, addNote, completeTask, createTask, deleteActivity, lastActivityAt, listActivities, listTasks, updateActivity } from "./activities";

describe("activities ops", () => {
  it("notes, tasks, timeline incl. related records", async () => {
    const { admin, plugins } = await setupTestCrm();
    const created: string[] = [];
    const completed: string[] = [];
    plugins.addAction("activity.created", (_c, p) => void created.push(p.activity.type));
    plugins.addAction("activity.completed", (_c, p) => void completed.push(p.activity.id));
    const c = await createRecord(admin, "companies", { name: "Acme" });
    const p = await createRecord(admin, "people", { name: "Ada", company: c.id });
    const note = await addNote(admin, c.id, "First meeting went well\nmore", undefined);
    expect(note.title).toBe("First meeting went well");
    expect(note.targets).toEqual([{ object: "companies", id: c.id }]);
    const task = await createTask(admin, { title: "Call back", dueAt: "2024-06-14", targets: [{ object: "", id: p.id }] });
    expect(task.assigneeId).toBe("owner");
    expect(task.dueAt).toBe(new Date(2024, 5, 14, 9).getTime());
    expect(listActivities(admin, { target: c.id }).total).toBe(1);
    expect(listActivities(admin, { target: c.id, includeRelated: true }).total).toBe(2);
    expect(listTasks(admin, { overdue: true }).items.map((t) => t.id)).toEqual([task.id]);
    await completeTask(admin, task.id);
    expect(listTasks(admin).total).toBe(0);
    expect(listTasks(admin, { status: "done" }).total).toBe(1);
    expect(created).toEqual(["note", "task"]);
    expect(completed).toEqual([task.id]);
    expect(lastActivityAt(admin, c.id)).toBe(TEST_NOW);
  });

  it("validates and updates", async () => {
    const { admin, as } = await setupTestCrm();
    await expect(addActivity(admin, { type: "fax" as never, title: "x" })).rejects.toThrow(/Unknown activity type/);
    await expect(addActivity(admin, { type: "note", title: "" })).rejects.toThrow(/title/);
    await expect(addActivity(admin, { type: "note", title: "x", targets: [{ object: "people", id: "ghost" }] })).rejects.toThrow(/not found/);
    await expect(createTask(admin, { title: "x", assigneeId: "nobody" })).rejects.toThrow(/assignee/);
    const call = await addActivity(admin, { type: "call", title: "Intro", meta: { durationMin: 10 } });
    const up = await updateActivity(admin, call.id, { title: "Intro call", meta: { outcome: "positive" } });
    expect(up.meta).toEqual({ durationMin: 10, outcome: "positive" });
    await expect(addNote(as("viewer"), "x", "y")).rejects.toThrow();
    await deleteActivity(admin, call.id);
    expect(listActivities(admin).total).toBe(0);
  });
});
