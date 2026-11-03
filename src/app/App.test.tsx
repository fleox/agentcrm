// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "./App";
import { registerFeatures } from "./featureRegistry";
import { FEATURES } from "../features";
import { resetDataStore, setDataStore } from "../data";
import { createMemoryStore } from "../data/memory";
import { createOpsContext } from "../ops/context";
import { seedCrm } from "../ops/seed";
import { resetRuntimeConfigCache, setRuntimeConfigOverride, type RuntimeConfig } from "../lib/runtimeConfig";
import { emitShellEvent } from "./shellEvents";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function waitFor(check: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timeout; body: ${document.body.textContent?.slice(0, 400)}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

function go(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

function mount() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(<App />));
  return { el, root };
}

beforeAll(() => registerFeatures(FEATURES));

afterEach(() => {
  setRuntimeConfigOverride(undefined);
  resetRuntimeConfigCache();
  resetDataStore();
  document.body.innerHTML = "";
  window.location.hash = "";
});

describe("App shell", () => {
  it("shows the setup wizard (with the This browser quick start) when not configured", async () => {
    setRuntimeConfigOverride(null);
    const { root } = mount();
    await waitFor(() => !!document.body.textContent?.includes("Set up AgentCRM"));
    expect(document.body.textContent).toContain("This browser");
    act(() => root.unmount());
  });

  it("boots a configured store into the dashboard with dynamic object nav, then navigates", async () => {
    const config = { backend: "local" } as RuntimeConfig;
    setRuntimeConfigOverride(config);
    const store = createMemoryStore();
    await store.ready();
    await seedCrm(createOpsContext(store, null), { admin: { name: "Ada Admin", email: "ada@example.com" }, demo: true, name: "Smoke CRM" });
    setDataStore(store, config);
    const { root } = mount();
    await waitFor(() => !!document.body.textContent?.includes("Pipeline by stage"));
    const text = document.body.textContent ?? "";
    for (const s of ["Smoke CRM", "Dashboard", "Tasks", "Companies", "People", "Deals", "Settings", "Automations"]) expect(text).toContain(s);

    go("#/objects/companies");
    await waitFor(() => !!document.body.textContent?.includes("Hooli"));

    // Record detail pages render every field type's input.
    for (const object of ["companies", "people", "deals"]) {
      const r = store.list("records").find((x) => x.object === object)!;
      go(`#/objects/${object}/${r.id}`);
      await waitFor(() => !!document.body.textContent?.includes("Timeline"));
    }

    // Cmd+K palette from the search feature.
    act(() => emitShellEvent("search.open"));
    await waitFor(() => !!document.querySelector('input[placeholder^="Search records"]'));

    go("#/settings");
    await waitFor(() => !!document.body.textContent?.includes("CRM name"));
    act(() => root.unmount());
  });
});

describe("App shell × modules", () => {
  it("hides disabled modules live and shows the module-disabled page on their routes", async () => {
    const config = { backend: "local" } as RuntimeConfig;
    setRuntimeConfigOverride(config);
    const store = createMemoryStore();
    await store.ready();
    const system = createOpsContext(store, null);
    await seedCrm(system, { admin: { name: "Ada Admin", email: "ada@example.com" }, demo: true, name: "Modules CRM" });
    setDataStore(store, config);
    const { root } = mount();
    await waitFor(() => !!document.body.textContent?.includes("Pipeline by stage"));
    const nav = () => [...document.querySelectorAll("aside nav a")].map((a) => a.textContent);
    expect(nav()).toContain("Deals");
    expect(nav()).toContain("Reports");

    const { setModuleEnabled } = await import("../ops/modules");
    await act(async () => {
      await setModuleEnabled(system, "deals", false);
      await setModuleEnabled(system, "reports", false);
    });
    await waitFor(() => !nav().includes("Deals") && !nav().includes("Reports"));
    expect(document.body.textContent).not.toContain("Pipeline by stage");

    go("#/reports");
    await waitFor(() => !!document.body.textContent?.includes("This module is disabled"));
    expect(document.body.textContent).toContain("Open Settings → Modules");
    go("#/objects/deals");
    await waitFor(() => !!document.body.textContent?.includes("“Deals & pipelines” is switched off"));
    // Disabled dashboard: "/" goes to the first object.
    await act(async () => {
      await setModuleEnabled(system, "dashboard", false);
    });
    go("#/");
    await waitFor(() => window.location.hash === "#/objects/companies");
    act(() => root.unmount());
  });

  it("applies the workspace appearance and shows the logo", async () => {
    const config = { backend: "local" } as RuntimeConfig;
    setRuntimeConfigOverride(config);
    const store = createMemoryStore();
    await store.ready();
    const system = createOpsContext(store, null);
    await seedCrm(system, { admin: { name: "Ada Admin", email: "ada@example.com" }, demo: false, name: "Look CRM" });
    setDataStore(store, config);
    const { applyPreset, setLogo } = await import("../ops/appearance");
    await applyPreset(system, "forest");
    await setLogo(system, "data:image/png;base64,iVBORw0KGgo=");
    const { root } = mount();
    await waitFor(() => !!document.querySelector("[data-testid=workspace-logo]"));
    expect(document.documentElement.getAttribute("data-sidebar")).toBe("dark");
    expect(document.getElementById("agentcrm-appearance")?.textContent).toContain("--acc-500:22 163 74");
    expect(JSON.parse(localStorage.getItem("agentcrm.appearance")!)).toMatchObject({ v: 1, attrs: { "data-sidebar": "dark" } });
    expect(document.querySelector("aside")?.getAttribute("data-sidebar")).toBe("dark");
    act(() => root.unmount());
  });
});
