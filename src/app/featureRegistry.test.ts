import { FEATURES } from "../features";
import { setModuleEnabled } from "../ops/modules";
import { setupTestCrm } from "../ops/testing";
import { connectModuleState, getAllFeatures, getFeatures, getModuleStates, getSlot, isModuleEnabled, registerExternalFeature, registerFeatures, subscribeFeatures } from "./featureRegistry";

describe("feature registry × modules", () => {
  beforeAll(() => registerFeatures(FEATURES));

  it("filters disabled modules out of features and slots, live", async () => {
    const crm = await setupTestCrm();
    const off = connectModuleState(crm.store);
    let notified = 0;
    const unsub = subscribeFeatures(() => notified++);
    try {
      expect(getFeatures().map((f) => f.id)).toContain("automations");
      expect(getSlot("dashboardWidgets").map((w) => w.id)).toContain("automation-runs");
      await setModuleEnabled(crm.admin, "automations", false);
      expect(notified).toBeGreaterThan(0);
      expect(isModuleEnabled("automations")).toBe(false);
      expect(getFeatures().map((f) => f.id)).not.toContain("automations");
      expect(getAllFeatures().map((f) => f.id)).toContain("automations");
      expect(getSlot("dashboardWidgets").map((w) => w.id)).not.toContain("automation-runs");
      expect(getModuleStates().find((m) => m.id === "automations")?.enabled).toBe(false);
      // The reports page moved to its own module.
      expect(getFeatures().find((f) => f.id === "reports")?.routes.map((r) => r.path)).toEqual(["/reports"]);
      expect(getFeatures().find((f) => f.id === "dashboard")?.routes.map((r) => r.path)).toEqual(["/"]);
      await setModuleEnabled(crm.admin, "automations", true);
      expect(getFeatures().map((f) => f.id)).toContain("automations");
    } finally {
      unsub();
      off();
    }
  });

  it("refuses an external feature taking a built-in id", () => {
    expect(() => registerExternalFeature({ id: "dashboard", routes: [], i18n: { en: {} } })).toThrow(/built-in/);
  });
});
