// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderCrm, type RenderedCrm } from "../records/testing/renderCrm";
import { createOpsContext } from "../../ops/context";
import { createTask } from "../../ops/activities";
import { emitShellEvent } from "../../app/shellEvents";
import type { Activity, CrmRecord } from "../../core/types";
import { TasksPage } from "./TasksPage";
import { TaskCreateOverlay } from "./TaskCreateOverlay";
import { TaskList } from "./TaskList";
import { addDays, dueGroup, groupTasks, startOfDay } from "./taskUtils";

// The shared harness imports the dashboard (recharts). Fall back to an empty
// module when recharts cannot load (missing peer dep react-is in some
// installs) — charts are never rendered here.
vi.mock("recharts", async (importOriginal) => {
  try {
    return await importOriginal();
  } catch {
    return {};
  }
});

// Demo data is seeded at TEST_NOW (2024-06-15) while the UI uses Date.now,
// so demo tasks are mostly overdue: time-sensitive assertions use tasks
// created here with due dates relative to Date.now.

let c: RenderedCrm | null = null;
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});
afterEach(() => {
  c?.unmount();
  c = null;
});

const tasksOf = (c: RenderedCrm) => (c.store.list("activities") as unknown as Activity[]).filter((a) => a.type === "task" && !a.deletedAt);

function submit(c: RenderedCrm) {
  const form = c.find<HTMLFormElement>('form[data-form-type="other"]');
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("taskUtils", () => {
  it("buckets by due date and completion", () => {
    const now = Date.now();
    const today = startOfDay(now);
    const base = { type: "task" as const, targets: [], createdAt: 0, updatedAt: 0 };
    const mk = (id: string, extra: Partial<Activity>): Activity => ({ id, title: id, ...base, ...extra });
    expect(dueGroup(mk("a", { dueAt: now - 1000 }), now)).toBe("overdue");
    expect(dueGroup(mk("b", { dueAt: addDays(today, 1) + 3600_000 }), now)).toBe("tomorrow");
    expect(dueGroup(mk("c", { dueAt: addDays(today, 4) }), now)).toBe("thisWeek");
    expect(dueGroup(mk("d", { dueAt: addDays(today, 30) }), now)).toBe("later");
    expect(dueGroup(mk("e", {}), now)).toBe("noDate");
    const groups = groupTasks([mk("e", {}), mk("a", { dueAt: now - 1000 }), mk("f", { doneAt: now })], now).map((g) => g.id);
    expect(groups).toEqual(["overdue", "noDate", "doneToday"]);
  });
});

describe("TasksPage", () => {
  it("creates a task through the modal", async () => {
    c = await renderCrm(<TasksPage />, { path: "/tasks" });
    await c.waitFor(() => c!.text().includes("My tasks"));
    const before = tasksOf(c).length;
    c.click(c.find("button", "New task"));
    await c.waitFor(() => !!document.querySelector("#task-title"));
    c.type(c.find("#task-title"), "Send the contract to Hooli");
    c.type(c.find("#task-body"), "Use the **v2** template");
    const day = new Date(addDays(startOfDay(Date.now()), 3));
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    c.type(c.find("#task-due"), iso);
    submit(c);
    await c.waitFor(() => tasksOf(c!).length === before + 1);
    const created = tasksOf(c).find((a) => a.title === "Send the contract to Hooli")!;
    expect(created.body).toBe("Use the **v2** template");
    expect(created.assigneeId).toBe(c.user.id);
    expect(created.dueAt).toBe(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0).getTime());
    await c.waitFor(() => c!.text().includes("Send the contract to Hooli"));
  });

  it("validates the title", async () => {
    c = await renderCrm(<TasksPage />, { path: "/tasks" });
    c.click(c.find("button", "New task"));
    await c.waitFor(() => !!document.querySelector("#task-title"));
    const before = tasksOf(c).length;
    submit(c);
    await c.waitFor(() => c!.text().includes("Give the task a title."));
    expect(tasksOf(c).length).toBe(before);
  });

  it("completes and reopens a task inline, groups by due date", async () => {
    c = await renderCrm(<TasksPage />, { path: "/tasks" });
    const ops = createOpsContext(c.store, c.user);
    const tomorrow = addDays(startOfDay(Date.now()), 1) + 10 * 3600_000;
    let task!: Activity;
    await act(async () => {
      task = await createTask(ops, { title: "Prepare tomorrow's demo", dueAt: tomorrow });
      await createTask(ops, { title: "Someday cleanup" });
    });
    await c.waitFor(() => c!.text().includes("Prepare tomorrow's demo"));
    expect(c.findAll("section h3").map((h) => h.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Tomorrow"), expect.stringContaining("No date")]));
    const box = () => c!.find<HTMLInputElement>(`[data-task-id="${task.id}"] input[type=checkbox]`);
    c.click(box());
    await c.waitFor(() => !!(c!.store.get("activities", task.id) as unknown as Activity).doneAt);
    // Leaves "My tasks", shows up in Done.
    await c.waitFor(() => !c!.text().includes("Prepare tomorrow's demo"));
    c.click(c.find('[role="tab"]', "Done"));
    await c.waitFor(() => c!.text().includes("Prepare tomorrow's demo") && c!.text().includes("Completed today"));
    c.click(box());
    await c.waitFor(() => !(c!.store.get("activities", task.id) as unknown as Activity).doneAt);
  });

  it("filters by text and by assignee", async () => {
    c = await renderCrm(<TasksPage />, { path: "/tasks" });
    const ops = createOpsContext(c.store, c.user);
    const other = (c.store.list("users") as unknown as { id: string }[]).find((u) => u.id !== c!.user.id)!;
    await act(async () => {
      await createTask(ops, { title: "Zebra unique task", assigneeId: other.id });
      await createTask(ops, { title: "Yak unique task" });
    });
    c.click(c.find('[role="tab"]', "All tasks"));
    await c.waitFor(() => c!.text().includes("Zebra unique task"));
    c.type(c.find('input[aria-label="Filter tasks…"]'), "unique");
    await c.waitFor(() => c!.text().includes("Yak unique task") && c!.text().includes("Zebra unique task"));
    c.type(c.find('select[aria-label="Assignee"]'), other.id);
    await c.waitFor(() => !c!.text().includes("Yak unique task"));
    expect(c.text()).toContain("Zebra unique task");
  });

  it("is read-only for viewers", async () => {
    c = await renderCrm(<TasksPage />, { path: "/tasks", role: "viewer" });
    c.click(c.find('[role="tab"]', "All tasks"));
    await c.waitFor(() => c!.findAll("[data-task-id]").length > 0);
    expect(c.findAll("button", "New task").length).toBe(0);
    expect(c.findAll<HTMLInputElement>("[data-task-id] input[type=checkbox]").every((b) => b.disabled)).toBe(true);
  });
});

describe("TaskList + tasks.create overlay", () => {
  it("opens the editor from the shell event with targets and saves them", async () => {
    c = await renderCrm(<TaskCreateOverlay />, { path: "/" });
    const company = (c.store.list("records") as unknown as CrmRecord[]).find((r) => r.object === "companies" && r.fields.name === "Hooli")!;
    act(() => emitShellEvent("tasks.create", { targets: [{ object: "companies", id: company.id }], title: "Follow up" }));
    await c.waitFor(() => !!document.querySelector("#task-title"));
    expect(c.find<HTMLInputElement>("#task-title").value).toBe("Follow up");
    expect(c.find('[data-testid="task-targets"]').textContent).toContain("Hooli");
    const before = tasksOf(c).length;
    submit(c);
    await c.waitFor(() => tasksOf(c!).length === before + 1);
    const created = tasksOf(c).find((a) => a.title === "Follow up")!;
    expect(created.targets).toEqual([{ object: "companies", id: company.id }]);
    await c.waitFor(() => !document.querySelector("#task-title"));
  });

  it("renders target chips and deletes from the row menu", async () => {
    const crmRender = await renderCrm(<div />, { path: "/" });
    const company = (crmRender.store.list("records") as unknown as CrmRecord[]).find((r) => r.object === "companies")!;
    const ops = createOpsContext(crmRender.store, crmRender.user);
    const task = await createTask(ops, { title: "Chip task", targets: [{ object: "companies", id: company.id }] });
    const crm = crmRender.crm;
    crmRender.unmount();
    function Host() {
      return <TaskList tasks={[task]} showTargets />;
    }
    c = await renderCrm(<Host />, { path: "/", crm });
    const link = c.find<HTMLAnchorElement>(`[data-task-id="${task.id}"] a`);
    expect(link.getAttribute("href")).toBe(`#/objects/companies/${company.id}`);
    c.click(c.find('[aria-label="Task actions"]'));
    c.click(c.find('[role="menuitem"]', "Delete"));
    await c.waitFor(() => c!.findAll('[role="dialog"] button', "Delete").length > 0);
    const confirmBtn = c.findAll('[role="dialog"] button', "Delete").pop();
    c.click(confirmBtn);
    await c.waitFor(() => !!(c!.store.get("activities", task.id) as unknown as Activity).deletedAt);
  });
});
