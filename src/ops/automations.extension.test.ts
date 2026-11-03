// The automations extension point: actions registered by extension modules.
import type { Activity } from "../core/types";
import { createAutomation, installAutomations, listAutomationRuns, testAutomation, validateAutomation } from "./automations";
import { registerAutomationAction, resetAutomationActions } from "./automations/extensionActions";
import { addNote } from "./activities";
import { createRecord } from "./records";
import { setupTestCrm } from "./testing";

afterEach(() => resetAutomationActions());

describe("extension automation actions", () => {
  it("validates against the registry, renders template params and runs", async () => {
    const t = await setupTestCrm();
    const input = { name: "Celebrate", object: "people", trigger: { type: "record.created" as const }, conditions: [], actions: [{ type: "extension" as const, action: "demo-ext.note", params: { text: "Hello {{label}}" } }] };
    expect(() => validateAutomation(t.admin, input)).toThrow(/unknown extension action "demo-ext.note"/);
    const off = registerAutomationAction({
      id: "demo-ext.note",
      label: "Add a demo note",
      params: [{ id: "text", label: "Text", type: "text", required: true, template: true }],
      objects: ["people"],
      describe: ({ params }) => `Note "${String(params.text)}"`,
      run: async (ctx, { params, record }) => {
        const note = await addNote(ctx, { object: record.object, id: record.id }, String(params.text));
        return `noted ${note.id}`;
      },
    });
    expect(() => registerAutomationAction({ id: "bad id", label: "x", run: () => undefined })).toThrow(/Invalid/);
    expect(() => validateAutomation(t.admin, { ...input, actions: [{ type: "extension", action: "demo-ext.note", params: {} }] })).toThrow(/"Text" is required/);
    expect(() => validateAutomation(t.admin, { ...input, object: "companies" })).toThrow(/doesn't apply/);
    const automation = await createAutomation(t.admin, input);
    expect(automation.actions[0]).toEqual({ type: "extension", action: "demo-ext.note", params: { text: "Hello {{label}}" } });
    const uninstall = installAutomations(t.plugins);
    try {
      const ada = await createRecord(t.admin, "people", { firstName: "Ada", lastName: "Lovelace" });
      const notes = (t.store.list("activities") as unknown as Activity[]).filter((a) => a.type === "note" && a.targets.some((x) => x.id === ada.id));
      expect(notes.map((n) => n.body)).toEqual(["Hello Ada Lovelace"]);
      const [run] = listAutomationRuns(t.admin, { recordId: ada.id });
      expect(run).toMatchObject({ status: "ok", actions: [{ type: "extension", ok: true, message: expect.stringMatching(/^noted /) }] });
      const dry = await testAutomation(t.admin, input, ada.id);
      expect(dry.run.actions?.[0].message).toBe('Note "Hello Ada Lovelace"');
      // Unregistered (extension disabled) → the run fails cleanly.
      off();
      const bob = await createRecord(t.admin, "people", { firstName: "Bob" });
      const [failed] = listAutomationRuns(t.admin, { recordId: bob.id });
      expect(failed).toMatchObject({ status: "error" });
      expect(failed.message).toMatch(/not available/);
    } finally {
      uninstall();
    }
  });
});
