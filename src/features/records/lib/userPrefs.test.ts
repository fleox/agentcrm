import { describe, expect, it } from "vitest";
import { defaultViewFor } from "../../../core/schema/standardObjects";
import { setupTestCrm } from "../../../ops/testing";
import type { ObjectDef } from "../../../core/types";
import { applyPrefsPatch, applyViewPrefs, layoutOverrides, mergePrefs } from "./userPrefs";

describe("user prefs", () => {
  it("keeps the newest copy per view and per object", () => {
    const a = { views: { v1: { columns: ["a"], at: 10 }, v2: { columns: ["x"], at: 50 } }, lastView: { people: { id: "v1", at: 10 } } };
    const b = { views: { v1: { columns: ["b"], at: 20 }, v2: { columns: ["y"], at: 40 } }, lastView: { people: { id: "v2", at: 30 } } };
    expect(mergePrefs(a, b)).toEqual({ views: { v1: { columns: ["b"], at: 20 }, v2: { columns: ["x"], at: 50 } }, lastView: { people: { id: "v2", at: 30 } } });
    expect(applyPrefsPatch(a, { views: { v1: null } }).views).toEqual({ v2: { columns: ["x"], at: 50 } });
  });

  it("applies a layout over the saved view, dropping what no longer exists", async () => {
    const crm = await setupTestCrm();
    const people = crm.store.get("objects", "people") as unknown as ObjectDef;
    const base = defaultViewFor(people);
    const view = applyViewPrefs(base, people, {
      columns: ["email", "gone"],
      filters: [{ field: "lifecycleStage", op: "in", value: ["customer"] }, { field: "gone", op: "eq", value: 1 }],
      sorts: [{ field: "createdAt", dir: "desc" }],
      type: "kanban",
      groupBy: "email",
      at: 1,
    });
    expect(view.columns).toEqual(["email"]);
    expect(view.filters).toEqual([{ field: "lifecycleStage", op: "in", value: ["customer"] }]);
    expect(view.sorts).toEqual([{ field: "createdAt", dir: "desc" }]);
    // Kanban on a field that can't group: back to the saved type.
    expect(view.type).toBe(base.type);
    expect(layoutOverrides(view, base)).toEqual({ columns: ["email"], filters: view.filters, sorts: view.sorts });
    expect(applyViewPrefs(base, people, { at: 2 })).toEqual(base);
  });
});
