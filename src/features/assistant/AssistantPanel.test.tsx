// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { registerFeatures } from "../../app/featureRegistry";
// Only the features this test needs (keeps it independent of other
// features' work in progress).
import assistant from ".";
import settings from "../settings";
import { resetDataStore, setDataStore } from "../../data";
import { createMemoryStore } from "../../data/memory";
import { createOpsContext } from "../../ops/context";
import { seedCrm } from "../../ops/seed";
import { resetRuntimeConfigCache, setRuntimeConfigOverride, type RuntimeConfig } from "../../lib/runtimeConfig";
import { emitShellEvent } from "../../app/shellEvents";
import { ASSISTANT_STORAGE_KEYS, ASSISTANT_HISTORY_KEY } from "../../ai/assistant";
import { sseResponse, textTurn, toolTurn } from "../../ai/assistant/testUtils";
import DOMPurify from "dompurify";
import { renderAssistantMarkdown } from "./markdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function waitFor(check: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timeout; body: ${document.body.textContent?.slice(0, 600)}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

const panel = () => document.querySelector('[data-testid="assistant-panel"]');
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label) as HTMLButtonElement | undefined;

function typeInto(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function boot() {
  const config = { backend: "local" } as RuntimeConfig;
  setRuntimeConfigOverride(config);
  const store = createMemoryStore();
  await store.ready();
  await seedCrm(createOpsContext(store, null), { admin: { name: "Ada Admin", email: "ada@example.com" }, demo: true, name: "Smoke CRM" });
  setDataStore(store, config);
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(<App />));
  await waitFor(() => !!document.body.textContent?.includes("Smoke CRM"));
  return { store, root };
}

beforeAll(() => registerFeatures([assistant, settings]));

afterEach(() => {
  vi.unstubAllGlobals();
  setRuntimeConfigOverride(undefined);
  resetRuntimeConfigCache();
  resetDataStore();
  document.body.innerHTML = "";
  window.location.hash = "";
  localStorage.clear();
  sessionStorage.clear();
});

describe("assistant panel", () => {
  it("shows the no-key empty state and the settings section", async () => {
    const { root } = await boot();
    act(() => emitShellEvent("assistant.toggle"));
    await waitFor(() => !!panel());
    expect(panel()!.textContent).toContain("Connect your Claude API key");
    act(() => button("Open assistant settings")!.click());
    await waitFor(() => !!document.body.textContent?.includes("Your key stays in this browser"));
    expect(document.querySelector("#assistant-api-key")?.getAttribute("type")).toBe("password");
    act(() => root.unmount());
  });

  it("streams an answer, asks approval for a mutating tool and runs it", async () => {
    localStorage.setItem(ASSISTANT_STORAGE_KEYS.apiKey, "sk-test");
    const responses = [
      () => sseResponse(toolTurn([{ id: "tu_1", name: "create_record", input: { object: "companies", fields: { name: "Panel Corp" } } }], "Creating it.")),
      () => sseResponse(textTurn("Done: **Panel Corp** created.")),
    ];
    const fetchMock = vi.fn(async () => responses.shift()!());
    vi.stubGlobal("fetch", fetchMock);
    const { store, root } = await boot();

    // Cmd/Ctrl+J opens the panel.
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", ctrlKey: true })));
    await waitFor(() => !!panel()?.querySelector("textarea"));
    typeInto(panel()!.querySelector("textarea")!, "Create Panel Corp");
    act(() => button("Send")!.click());

    await waitFor(() => !!button("Approve"));
    expect(panel()!.textContent).toContain("create_record");
    expect(panel()!.textContent).toContain("Panel Corp");
    act(() => button("Approve")!.click());

    await waitFor(() => !!panel()?.querySelector("strong") && panel()!.textContent!.includes("created."));
    expect(store.list("records").some((r) => (r as { fields?: { name?: string } }).fields?.name === "Panel Corp")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(firstBody.system).toContain("Ada Admin");
    await waitFor(() => !!sessionStorage.getItem(ASSISTANT_HISTORY_KEY)?.includes("Panel Corp"));

    // New chat clears the conversation.
    act(() => button("New chat")!.click());
    await waitFor(() => !panel()!.textContent!.includes("created."));
    act(() => root.unmount());
  });
});

describe("assistant markdown", () => {
  // happy-dom's DOM is not complete enough for DOMPurify's own output
  // (it is in real browsers): check that every render goes through it.
  it("sanitizes and opens external links in a new tab", () => {
    const spy = vi.spyOn(DOMPurify, "sanitize");
    const html = renderAssistantMarkdown("**b** [x](https://example.com) [y](#/objects/companies/1)");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(html).toContain("<strong>b</strong>");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toMatch(/<a href="#\/objects\/companies\/1">y<\/a>/);
  });
});
