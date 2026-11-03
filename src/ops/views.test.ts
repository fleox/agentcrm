import { describe, expect, it } from "vitest";
import { setupTestCrm } from "./testing";
import { createView, deleteView, duplicateView, listViews, runView, updateView } from "./views";
import { createRecord } from "./records";

describe("views ops", () => {
  it("members create private views, admins shared ones", async () => {
    const crm = await setupTestCrm();
    const member = crm.as("member");
    const mine = await createView(member, { object: "companies", name: "Mine", filters: [{ field: "industry", op: "eq", value: "software" }] });
    expect(mine).toMatchObject({ shared: false, ownerId: "u-member" });
    await expect(createView(member, { object: "companies", name: "Team", shared: true })).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateView(member, mine.id, { shared: true })).rejects.toMatchObject({ code: "forbidden" });
    expect(listViews(crm.admin, "companies").map((v) => v.name)).toEqual(["All companies"]);
    expect(listViews(member, "companies").map((v) => v.name)).toEqual(["All companies", "Mine"]);
    await expect(updateView(crm.as("viewer"), "companies-all", { name: "x" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("validates kanban grouping and runs views", async () => {
    const { admin } = await setupTestCrm();
    await expect(createView(admin, { object: "deals", name: "K", type: "kanban", groupBy: "amount", shared: true })).rejects.toThrow(/kanban/);
    const k = await createView(admin, { object: "deals", name: "By stage", type: "kanban", groupBy: "stage", pipelineId: "sales", shared: true });
    await createRecord(admin, "companies", { name: "Soft", industry: "software" });
    await createRecord(admin, "companies", { name: "Shop", industry: "retail" });
    const v = await createView(admin, { object: "companies", name: "Software", filters: [{ field: "industry", op: "eq", value: "software" }], shared: true });
    expect(runView(admin, v.id).items.map((r) => r.fields.name)).toEqual(["Soft"]);
    const copy = await duplicateView(admin, v.id);
    expect(copy).toMatchObject({ name: "Software (copy)", shared: false });
    await deleteView(admin, k.id);
    await expect(deleteView(admin, "people-all")).rejects.toThrow(/at least one view/);
  });
});
