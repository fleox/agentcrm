import { describe, expect, it } from "vitest";
import { createForm, memoryInboxSource, setInboxSourceResolver } from "../ops/forms";
import { createRecord } from "../ops/records";
import { setupTestCrm } from "../ops/testing";
import { AI_TOOLS, callTool, findTool } from "./tools";

const DAY = 86_400_000;

describe("automation / form / email tools", () => {
  it("are in the catalog with the right mutating flags", () => {
    const flags = Object.fromEntries(AI_TOOLS.map((t) => [t.name, t.mutating]));
    expect(flags).toMatchObject({ list_automations: false, create_automation: true, run_automations: true, list_forms: false, ingest_inbox: true, draft_email: false });
    expect(findTool("describe_schema")).toBeDefined();
  });

  it("creates automations from a template or a definition and runs scheduled ones (dry run first)", async () => {
    const t = await setupTestCrm();
    const fromTpl = (await callTool(t.admin, "create_automation", { templateId: "stale-deal-followup" })) as { id: string; enabled: boolean };
    expect(fromTpl.enabled).toBe(true);
    await callTool(t.admin, "create_automation", { name: "Note", object: "companies", trigger: { type: "record.created" }, actions: [{ type: "addNote", body: "hi" }], enabled: false });
    await expect(callTool(t.admin, "create_automation", { name: "x" })).rejects.toThrow(/templateId/);
    await expect(callTool(t.as("member"), "create_automation", { templateId: "deal-lost-note" })).rejects.toThrow(/Not allowed/);
    const list = (await callTool(t.admin, "list_automations", { includeRuns: true })) as { automations: unknown[]; templates: unknown[]; runs: unknown[] };
    expect(list.automations).toHaveLength(2);
    expect(list.templates.length).toBeGreaterThan(3);

    const deal = await createRecord(t.admin, "deals", { name: "Idle deal" });
    t.clock.now += 20 * DAY;
    const dry = (await callTool(t.admin, "run_automations", {})) as { dryRun: boolean; ran: number };
    expect(dry).toMatchObject({ dryRun: true, ran: 1 });
    expect(t.store.list("automationRuns")).toHaveLength(0);
    const real = (await callTool(t.admin, "run_automations", { confirm: true })) as { ran: number };
    expect(real.ran).toBe(1);
    const test = (await callTool(t.admin, "run_automations", { automationId: fromTpl.id, recordId: deal.id })) as { matched: boolean; dryRun: boolean };
    expect(test).toMatchObject({ matched: true, dryRun: true });
    const off = (await callTool(t.admin, "run_automations", { automationId: fromTpl.id, enabled: false })) as { enabled: boolean };
    expect(off.enabled).toBe(false);
  });

  it("lists forms and ingests the inbox (dry run unless confirmed)", async () => {
    const t = await setupTestCrm();
    const form = await createForm(t.admin, {
      name: "Demo",
      object: "people",
      fields: [{ field: "email", label: "Email", required: true }],
      inbox: { kind: "s3", settings: { uploadUrl: "https://b/inbox/" } },
      successMessage: "",
    });
    const inbox = memoryInboxSource([{ id: "s1", formId: form.id, data: { email: "new@lead.io" }, createdAt: 1 }]);
    setInboxSourceResolver(() => inbox);
    try {
      expect(((await callTool(t.admin, "list_forms", {})) as { forms: { id: string }[] }).forms[0].id).toBe(form.id);
      const dry = (await callTool(t.admin, "ingest_inbox", {})) as { dryRun: boolean; created: number };
      expect(dry).toMatchObject({ dryRun: true, created: 1 });
      expect(inbox.items).toHaveLength(1);
      const real = (await callTool(t.admin, "ingest_inbox", { confirm: true })) as { created: number };
      expect(real.created).toBe(1);
      expect(inbox.items).toHaveLength(0);
    } finally {
      setInboxSourceResolver(null);
    }
  });

  it("drafts an email without sending", async () => {
    const t = await setupTestCrm();
    const company = await createRecord(t.admin, "companies", { name: "Acme" });
    const p = await createRecord(t.admin, "people", { firstName: "Jane", lastName: "Doe", email: "Jane@Acme.com", company: company.id });
    const deal = await createRecord(t.admin, "deals", { name: "Acme deal", contacts: [p.id] });
    const res = (await callTool(t.admin, "draft_email", { recordId: deal.id, purpose: "Proposal follow-up" })) as { draft: { to: { email: string }[]; subject: string; body: string }; sent: boolean };
    expect(res.sent).toBe(false);
    expect(res.draft.to).toEqual([{ id: p.id, name: "Jane Doe", email: "jane@acme.com" }]);
    expect(res.draft.subject).toBe("Proposal follow-up");
    expect(res.draft.body).toMatch(/^Hi Jane,/);
    const viaCompany = (await callTool(t.admin, "draft_email", { recordId: company.id, subject: "Hello", body: "Text" })) as { draft: { to: unknown[]; body: string } };
    expect(viaCompany.draft.to).toHaveLength(1);
    expect(viaCompany.draft.body).toBe("Text");
  });
});
