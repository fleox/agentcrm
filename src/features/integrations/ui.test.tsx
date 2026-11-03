// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderCrm } from "../records/testing/renderCrm";
import { recordsOf } from "../../ops/store";
import { setupTestCrm } from "../../ops/testing";
import type { CrmRecord } from "../../core/types";
import { base64UrlEncode } from "../../ops/integrations";
import integrations from "./index";
import { EmailsTab } from "./EmailsTab";
import { MeetingsPanel } from "./MeetingsPanel";
import { IntegrationsSettingsSection } from "./SettingsSection";
import { resetIntegrationStateForTests, setStoredToken } from "./state";

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetIntegrationStateForTests();
  document.body.innerHTML = "";
});

const gmailMessage = {
  id: "g1",
  threadId: "t1",
  snippet: "About the pilot",
  internalDate: String(Date.UTC(2024, 5, 14)),
  payload: {
    headers: [
      { name: "From", value: "Ada <ada.lovelace@acmerobotics.com>" },
      { name: "To", value: "me@example.com" },
      { name: "Subject", value: "Pilot scope" },
    ],
    parts: [{ mimeType: "text/plain", body: { data: base64UrlEncode("Hi") } }],
  },
};

describe("integrations UI", () => {
  it("prompts to connect when no provider is connected", async () => {
    const crm = await setupTestCrm({ demo: true });
    const ada = recordsOf(crm.store, "people").find((p) => p.fields.email === "ada.lovelace@acmerobotics.com") as CrmRecord;
    const object = crm.store.get("objects", "people") as never;
    const ui = await renderCrm(<EmailsTab record={ada} object={object} />, { crm, features: [integrations] });
    expect(ui.text()).toContain("Connect Google / Microsoft");
    ui.unmount();
  });

  it("lists Gmail messages and logs one to the timeline", async () => {
    setStoredToken("google", { provider: "google", accessToken: "tok", expiresAt: Date.now() + 3600_000, account: "me@example.com" });
    const fetchMock = vi.fn(async (url: string) => {
      const body = url.includes("/messages?") ? { messages: [{ id: "g1" }] } : gmailMessage;
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const crm = await setupTestCrm({ demo: true });
    const ada = recordsOf(crm.store, "people").find((p) => p.fields.email === "ada.lovelace@acmerobotics.com") as CrmRecord;
    const object = crm.store.get("objects", "people") as never;
    const ui = await renderCrm(<EmailsTab record={ada} object={object} />, { crm, features: [integrations] });
    await ui.waitFor(() => ui.text().includes("Pilot scope"));
    expect(String(fetchMock.mock.calls[0][0])).toContain(encodeURIComponent("from:ada.lovelace@acmerobotics.com"));
    ui.click(ui.find("button", "Log to timeline"));
    await ui.waitFor(() => ui.findAll("span", "Logged").length > 0);
    const logged = (crm.store.list("activities") as unknown as { type: string; meta?: Record<string, unknown> }[]).filter((a) => a.meta?.externalId === "g1");
    expect(logged).toHaveLength(1);
    expect(logged[0].type).toBe("email");
    ui.unmount();
  });

  it("renders the settings section and the meetings panel", async () => {
    const ui = await renderCrm(<IntegrationsSettingsSection />, { features: [integrations] });
    expect(ui.text()).toContain("Connect Google");
    expect(ui.text()).toContain("Connect Microsoft");
    expect(ui.findAll("form").every((f) => f.getAttribute("data-form-type") === "other")).toBe(true);
    ui.unmount();
    const crm = await setupTestCrm({ demo: true });
    const acme = recordsOf(crm.store, "companies").find((c) => c.fields.name === "Acme Robotics") as CrmRecord;
    const panel = await renderCrm(<MeetingsPanel record={acme} object={crm.store.get("objects", "companies") as never} />, { crm, features: [integrations] });
    expect(panel.text()).toContain("Upcoming meetings");
    panel.unmount();
  });
});
