import { describe, expect, it } from "vitest";
import { setupTestCrm } from "./testing";
import { createRecord } from "./records";
import { createPipeline, deletePipeline, forecast, moveStage, updatePipeline } from "./pipelines";
import { objectOf, recordOf } from "./store";

describe("pipelines ops", () => {
  it("moves stages by id or label, sets probability, close date and lost reason", async () => {
    const { admin } = await setupTestCrm();
    const d = await createRecord(admin, "deals", { name: "D", amount: 5000 });
    const q = await moveStage(admin, d.id, "Qualified");
    expect(q.fields).toMatchObject({ stage: "qualified", probability: 25 });
    const lost = await moveStage(admin, d.id, "lost", { lostReason: "Budget" });
    expect(lost.fields).toMatchObject({ stage: "lost", probability: 0, lostReason: "Budget", closeDate: "2024-06-15" });
    await expect(moveStage(admin, d.id, "Nope")).rejects.toThrow(/Unknown stage/);
  });

  it("forecasts weighted by probability", async () => {
    const { admin } = await setupTestCrm();
    await createRecord(admin, "deals", { name: "A", amount: 1000, stage: "proposal", closeDate: "2024-07-01" });
    await createRecord(admin, "deals", { name: "B", amount: 2000, stage: "negotiation", probability: 90, closeDate: "2024-08-10" });
    await createRecord(admin, "deals", { name: "C", amount: 500, stage: "won" });
    await createRecord(admin, "deals", { name: "D", amount: 700, stage: "lost" });
    const f = forecast(admin);
    expect(f).toMatchObject({ openCount: 2, openAmount: 3000, weightedAmount: 500 + 1800, wonAmount: 500, lostAmount: 700 });
    expect(f.byMonth.map((m) => m.month)).toEqual(["2024-07", "2024-08"]);
    expect(f.byStage.find((s) => s.stageId === "won")!.weighted).toBe(500);
    expect(forecast(admin, { from: "2024-08-01" }).openAmount).toBe(2000);
  });

  it("creates / edits / deletes pipelines keeping select options in sync", async () => {
    const { admin, store } = await setupTestCrm();
    const p = await createPipeline(admin, { name: "Partners", stages: [{ label: "New" }, { label: "Signed", kind: "won" }, { label: "Lost" }] });
    // Stage ids are unique across pipelines.
    expect(p.stages.map((s) => s.id)).toEqual(["new-2", "signed", "lost-2"]);
    expect(p.stages.map((s) => s.kind)).toEqual(["open", "won", "lost"]);
    const deals = objectOf(store, "deals")!;
    expect(deals.fields.find((f) => f.id === "stage")!.options!.map((o) => o.id)).toContain("signed");
    expect(deals.fields.find((f) => f.id === "pipeline")!.options!.map((o) => o.id)).toEqual(["sales", "partners"]);
    const d = await createRecord(admin, "deals", { name: "X", stage: "signed" });
    expect(d.fields.pipeline).toBe("partners");
    await updatePipeline(admin, p.id, { stages: [{ id: "new-2", label: "Intro" }, { id: "lost-2", label: "Lost", kind: "lost" }] });
    expect(recordOf(store, d.id)!.fields.stage).toBe("new-2");
    expect(objectOf(store, "deals")!.fields.find((f) => f.id === "stage")!.options!.find((o) => o.id === "new-2")!.label).toBe("Intro");
    const res = await deletePipeline(admin, p.id);
    expect(res.moved).toBe(1);
    expect(recordOf(store, d.id)!.fields).toMatchObject({ pipeline: "sales", stage: "new" });
    await expect(deletePipeline(admin, "sales")).rejects.toThrow(/last pipeline/);
  });
});
