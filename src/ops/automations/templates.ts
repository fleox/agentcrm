// Ready-made automations (the "templates gallery"). Each template builds
// an AutomationInput the user can tweak before saving. Texts are English
// (stored data); the UI translates names / descriptions by template id.

import type { AutomationAction, AutomationTrigger, Filter } from "../../core/types";

export interface AutomationInput {
  name: string;
  enabled?: boolean;
  object: string;
  trigger: AutomationTrigger;
  conditions?: Filter[];
  actions: AutomationAction[];
}

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  // Objects that must exist for the template to apply.
  requires: string[];
  build(): AutomationInput;
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "deal-won-onboarding",
    name: "Deal won → onboarding task",
    description: "When a deal reaches a won stage, create an onboarding task for its owner due in 2 days and log a note.",
    requires: ["deals"],
    build: () => ({
      name: "Deal won → onboarding task",
      object: "deals",
      trigger: { type: "stage.changed", to: "won" },
      conditions: [],
      actions: [
        { type: "createTask", title: "Kick off onboarding for {{label}}", dueInDays: 2, assignTo: "owner" },
        { type: "addNote", body: "🎉 Deal won ({{amount}}). Onboarding task created for {{owner}}." },
      ],
    }),
  },
  {
    id: "new-lead-round-robin",
    name: "New lead → assign round robin",
    description: "When a person is created as a lead, assign an owner in turn among active admins and members, and create a first-touch task.",
    requires: ["people"],
    build: () => ({
      name: "New lead → assign round robin",
      object: "people",
      trigger: { type: "record.created" },
      conditions: [{ field: "lifecycleStage", op: "eq", value: "lead" }],
      actions: [
        { type: "assignOwner", userId: "roundRobin" },
        { type: "createTask", title: "First touch: {{label}}", dueInDays: 1, assignTo: "owner" },
      ],
    }),
  },
  {
    id: "stale-deal-followup",
    name: "Deal stale 14 days → follow-up task",
    description: "Every check, open deals without any activity for 14 days get a follow-up task for their owner (once per idle period).",
    requires: ["deals"],
    build: () => ({
      name: "Deal stale 14 days → follow-up task",
      object: "deals",
      trigger: { type: "inactivity", days: 14 },
      conditions: [{ field: "stage", op: "notIn", value: ["won", "lost"] }],
      actions: [{ type: "createTask", title: "Follow up on {{label}} (no activity for 14 days)", dueInDays: 1, assignTo: "owner" }],
    }),
  },
  {
    id: "deal-lost-note",
    name: "Deal lost → log the reason",
    description: "When a deal moves to a lost stage, log a note with the lost reason on its timeline.",
    requires: ["deals"],
    build: () => ({
      name: "Deal lost → log the reason",
      object: "deals",
      trigger: { type: "stage.changed", to: "lost" },
      conditions: [],
      actions: [{ type: "addNote", body: "Deal lost. Reason: {{lostReason}}" }],
    }),
  },
  {
    id: "customer-welcome",
    name: "New customer → welcome task",
    description: "When a person's lifecycle stage becomes Customer, create a task to send the welcome pack.",
    requires: ["people"],
    build: () => ({
      name: "New customer → welcome task",
      object: "people",
      trigger: { type: "field.changed", field: "lifecycleStage", to: "customer" },
      conditions: [],
      actions: [{ type: "createTask", title: "Send the welcome pack to {{label}}", dueInDays: 3, assignTo: "owner" }],
    }),
  },
  {
    id: "new-person-webhook",
    name: "New person → webhook",
    description: "POST every new person as JSON to a URL you own (Zapier, Make, n8n, Slack workflow…). Set the URL before enabling.",
    requires: ["people"],
    build: () => ({
      name: "New person → webhook",
      enabled: false,
      object: "people",
      trigger: { type: "record.created" },
      conditions: [],
      actions: [{ type: "webhook", url: "https://example.com/your-webhook" }],
    }),
  },
];

export function findAutomationTemplate(id: string): AutomationTemplate | undefined {
  return AUTOMATION_TEMPLATES.find((t) => t.id === id);
}
