// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminRedirectUri, handleOAuthPopupCallback, needsInteraction, OAUTH_MESSAGE_TYPE } from "./auth";
import { effectiveSettings, getIntegrationSettings, getStoredToken, resetIntegrationStateForTests, saveIntegrationSettings, setStoredToken } from "./state";

function fakeWindow(search: string, opts: { opener?: boolean; pending?: string } = {}) {
  const postMessage = vi.fn();
  const close = vi.fn();
  const store = new Map<string, string>(opts.pending ? [["agentcrm.integrations.pending", opts.pending]] : []);
  const win = {
    opener: opts.opener === false ? null : { postMessage },
    location: { search, origin: "https://crm.example.com" },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null },
    close,
  } as unknown as Window;
  return { win, postMessage, close };
}

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetIntegrationStateForTests();
});

describe("popup callback", () => {
  it("posts the code to the opener and closes", () => {
    const { win, postMessage, close } = fakeWindow("?code=abc&state=acrm_123", { pending: "acrm_123" });
    expect(handleOAuthPopupCallback(win)).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: OAUTH_MESSAGE_TYPE, state: "acrm_123", code: "abc" }, "https://crm.example.com");
    expect(close).toHaveBeenCalled();
  });

  it("ignores normal boots, foreign states and mismatches", () => {
    expect(handleOAuthPopupCallback(fakeWindow("?code=abc&state=acrm_1", { opener: false }).win)).toBe(false);
    expect(handleOAuthPopupCallback(fakeWindow("?code=abc&state=other").win)).toBe(false);
    expect(handleOAuthPopupCallback(fakeWindow("?state=acrm_1").win)).toBe(false);
    expect(handleOAuthPopupCallback(fakeWindow("?code=abc&state=acrm_1", { pending: "acrm_2" }).win)).toBe(false);
    expect(handleOAuthPopupCallback(fakeWindow("").win)).toBe(false);
    expect(handleOAuthPopupCallback(undefined)).toBe(false);
  });

  it("forwards errors", () => {
    const { win, postMessage } = fakeWindow("?error=access_denied&error_description=Nope&state=acrm_9");
    expect(handleOAuthPopupCallback(win)).toBe(true);
    expect(postMessage.mock.calls[0][0]).toMatchObject({ error: "access_denied", errorDescription: "Nope" });
  });

  it("redirect uri is origin + path", () => {
    expect(adminRedirectUri({ origin: "https://crm.example.com", pathname: "/admin/" })).toBe("https://crm.example.com/admin/");
  });
});

describe("integration state", () => {
  it("settings in localStorage, tokens in sessionStorage only", () => {
    saveIntegrationSettings({ googleClientId: " gid.apps.googleusercontent.com ", autoLog: false });
    expect(JSON.parse(window.localStorage.getItem("agentcrm.integrations.settings")!)).toMatchObject({ googleClientId: "gid.apps.googleusercontent.com", autoLog: false });
    setStoredToken("google", { provider: "google", accessToken: "secret", expiresAt: Date.now() + 3600_000 });
    expect(window.sessionStorage.getItem("agentcrm.integrations.token.google")).toContain("secret");
    expect(JSON.stringify({ ...window.localStorage })).not.toContain("secret");
    resetIntegrationStateForTests();
    expect(getStoredToken("google")?.accessToken).toBe("secret");
    expect(getIntegrationSettings().autoLog).toBe(false);
    expect(needsInteraction("google")).toBe(false);
    setStoredToken("google", { provider: "google", accessToken: "x", expiresAt: 0 });
    expect(needsInteraction("google")).toBe(true);
    setStoredToken("microsoft", { provider: "microsoft", accessToken: "x", expiresAt: 0, refreshToken: "r" });
    expect(needsInteraction("microsoft")).toBe(false);
  });

  it("falls back to team-shared client ids", () => {
    saveIntegrationSettings({ microsoftClientId: "local-ms" });
    expect(effectiveSettings({ googleClientId: "shared-g", microsoftClientId: "shared-ms", microsoftTenant: "contoso" })).toMatchObject({
      googleClientId: "shared-g",
      microsoftClientId: "local-ms",
      microsoftTenant: "contoso",
    });
  });
});
