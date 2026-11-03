// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { renderCrm, type RenderedCrm, ADMIN_UI_FEATURES } from "../records/testing/renderCrm";
import { connectModuleState } from "../../app/featureRegistry";
import { packExtension } from "../../extensions/package";
import { fakePackage } from "../../extensions/testing";
import { installExtension } from "../../ops/extensions";
import { SettingsPage } from "../settings/SettingsPage";
import customize from "./index";
import reports from "../reports";
import deals from "../deals";

let c: RenderedCrm | null = null;
let disconnect: (() => void) | null = null;
afterEach(() => {
  disconnect?.();
  disconnect = null;
  c?.unmount();
  c = null;
});

const FEATURES = [...ADMIN_UI_FEATURES, customize, reports, deals];

async function open(route: string, role: "admin" | "viewer" = "admin") {
  c = await renderCrm(<SettingsPage />, { path: "/settings/:section/:sub?", route, role, features: FEATURES, demo: false });
  disconnect = connectModuleState(c.store);
  return c;
}

function moduleCard(id: string): HTMLElement {
  return c!.find(`[data-module="${id}"]`);
}

describe("Settings → Modules", () => {
  it("lists modules by category and toggles one", async () => {
    await open("/settings/modules");
    await c!.waitFor(() => !!document.querySelector('[data-module="reports"]'));
    expect(c!.text()).toContain("Deals & pipelines");
    expect(moduleCard("records").textContent).toContain("Required");
    expect(moduleCard("records").querySelector<HTMLButtonElement>("[role=switch]")!.disabled).toBe(true);
    c!.click(moduleCard("reports").querySelector("[role=switch]"));
    await c!.waitFor(() => (c!.store.get("config", "modules")?.disabled as string[] | undefined)?.includes("reports") === true);
    await c!.waitFor(() => moduleCard("reports").querySelector("[role=switch]")?.getAttribute("aria-checked") === "false");
  });

  it("asks before cascading to dependents", async () => {
    await open("/settings/modules");
    await act(async () => {
      await installExtension(c!.crm.admin, fakePackage("sales-goals", { dependsOn: ["deals"] }));
    });
    await c!.waitFor(() => !!document.querySelector('[data-module="sales-goals"]'));
    expect(moduleCard("deals").textContent).toContain("Used by Sales Goals");
    c!.click(moduleCard("deals").querySelector("[role=switch]"));
    await c!.waitFor(() => c!.text().includes("Disable dependent modules too?"));
    c!.click(c!.find("[role=dialog] button", "Continue"));
    await c!.waitFor(() => c!.store.get("extensions", "sales-goals")?.enabled === false);
    expect(c!.store.get("config", "modules")?.disabled).toEqual(["deals"]);
  });

  it("is read-only for viewers", async () => {
    await open("/settings/modules", "viewer");
    await c!.waitFor(() => !!document.querySelector('[data-module="reports"]'));
    expect(c!.text()).toContain("Only admins can change this");
    expect(moduleCard("reports").querySelector<HTMLButtonElement>("[role=switch]")!.disabled).toBe(true);
  });
});

describe("Settings → Modules → Installed extensions", () => {
  it("installs a ZIP after the trust confirmation, then upgrades it", async () => {
    await open("/settings/modules/extensions");
    await c!.waitFor(() => !!document.querySelector("[data-testid=extension-dropzone]"));
    const pick = async (version: string) => {
      const zip = await packExtension({ ...fakePackage("hello-module", { version }), manifest: { ...fakePackage("hello-module", { version }).manifest, author: "Ada" } });
      const input = c!.find<HTMLInputElement>("[data-testid=extension-file]");
      const file = new File([zip as BlobPart], "hello.zip", { type: "application/zip" });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await c!.waitFor(() => !!document.querySelector("[data-testid=confirm-install]"));
    };
    await pick("1.0.0");
    expect(c!.text()).toContain("This code will run with your rights");
    const confirm = c!.find<HTMLButtonElement>("[data-testid=confirm-install]");
    expect(confirm.disabled).toBe(true);
    c!.click(c!.find("[data-testid=trust-extension]"));
    c!.click(confirm);
    await c!.waitFor(() => !!c!.store.get("extensions", "hello-module"));
    await c!.waitFor(() => !!document.querySelector('[data-extension="hello-module"]'));
    expect(c!.find('[data-extension="hello-module"]').textContent).toContain("by Ada");

    await pick("2.0.0");
    expect(c!.text()).toContain("Upgrade 1.0.0 → 2.0.0");
    c!.click(c!.find("[data-testid=trust-extension]"));
    c!.click(c!.find("[data-testid=confirm-install]"));
    await c!.waitFor(() => (c!.store.get("extensions", "hello-module")?.manifest as { version: string }).version === "2.0.0");
    await c!.waitFor(() => c!.find('[data-extension="hello-module"]').textContent!.includes("Upgraded from 1.0.0"));
  });

  it("rejects an invalid ZIP with a readable error", async () => {
    await open("/settings/modules/extensions");
    await c!.waitFor(() => !!document.querySelector("[data-testid=extension-dropzone]"));
    const input = c!.find<HTMLInputElement>("[data-testid=extension-file]");
    Object.defineProperty(input, "files", { value: [new File(["nope"], "x.zip")], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await c!.waitFor(() => c!.text().includes("This package can't be installed"));
    expect(c!.text()).toContain("Not a valid ZIP");
  });
});

describe("Settings → Appearance", () => {
  it("applies a preset and changes settings live", async () => {
    await open("/settings/appearance");
    await c!.waitFor(() => !!document.querySelector('[data-preset="ocean"]'));
    c!.click(c!.find('[data-preset="ocean"]'));
    await c!.waitFor(() => c!.store.get("config", "appearance")?.preset === "ocean");
    c!.click(c!.find("[role=radiogroup][aria-label=Density] button", "Compact"));
    await c!.waitFor(() => c!.store.get("config", "appearance")?.density === "compact");
    expect(c!.store.get("config", "appearance")?.preset).toBe("custom");
    expect(c!.find("[data-testid=appearance-preview]")).toBeTruthy();
  });

  it("is read-only for viewers", async () => {
    await open("/settings/appearance", "viewer");
    await c!.waitFor(() => !!document.querySelector('[data-preset="ocean"]'));
    expect(c!.find<HTMLButtonElement>('[data-preset="ocean"]').disabled).toBe(true);
    expect(c!.text()).toContain("Only admins can change this");
  });
});
