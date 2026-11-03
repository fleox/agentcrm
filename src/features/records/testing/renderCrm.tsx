// Test harness shared by the admin UI features (records, dashboard, tasks,
// settings, search). Mounts a component inside the real providers (auth,
// CRM data, i18n, router) over a seeded memory store, without the whole
// App boot. Not imported by production code.
//
//   const crm = await renderCrm(<ObjectListPage />, { path: "/objects/:objectId", route: "/objects/companies" });
//   await crm.waitFor(() => crm.text().includes("Hooli"));
//   crm.click(crm.find("button", "New"));
//   crm.unmount();

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import i18n from "../../../i18n";
import { AuthProvider } from "../../../app/AuthContext";
import { CrmDataProvider } from "../../../app/CrmDataContext";
import { registerFeatures } from "../../../app/featureRegistry";
import { ConfirmHost, ToastContainer } from "../../../components/ui";
import type { CrmUser, UserRole } from "../../../core/types";
import type { DataStore, StoreIdentity } from "../../../data/types";
import { setupTestCrm, type TestCrm } from "../../../ops/testing";
import type { Feature } from "../../types";
import records from "../index";
import dashboard from "../../dashboard";
import tasks from "../../tasks";
import settings from "../../settings";
import search from "../../search";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const ADMIN_UI_FEATURES: Feature[] = [dashboard, tasks, records, search, settings];

export interface RenderCrmOptions {
  // Route pattern the element is mounted on ("/objects/:objectId").
  path?: string;
  // Initial location ("/objects/companies").
  route?: string;
  role?: UserRole;
  demo?: boolean;
  // Reuse an existing seeded CRM.
  crm?: TestCrm;
  // Extra routes (e.g. the record page to navigate to).
  routes?: { path: string; element: ReactElement }[];
  features?: Feature[];
}

export interface RenderedCrm {
  crm: TestCrm;
  store: DataStore;
  user: CrmUser;
  el: HTMLElement;
  root: Root;
  text(): string;
  waitFor(check: () => boolean, ms?: number): Promise<void>;
  flush(ms?: number): Promise<void>;
  find<T extends Element = HTMLElement>(selector: string, text?: string | RegExp): T;
  findAll<T extends Element = HTMLElement>(selector: string, text?: string | RegExp): T[];
  click(el: Element | null | undefined): void;
  type(el: Element | null | undefined, value: string): void;
  key(el: Element | null | undefined | Window, key: string, init?: KeyboardEventInit): void;
  unmount(): void;
}

function matches(el: Element, text?: string | RegExp): boolean {
  if (text === undefined) return true;
  const content = (el.textContent ?? "").trim();
  return typeof text === "string" ? content === text || content.includes(text) : text.test(content);
}

// Sets an input / textarea / select value the way React notices.
export function setNativeValue(el: Element, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  if (el instanceof HTMLSelectElement) return;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export async function renderCrm(element: ReactElement, opts: RenderCrmOptions = {}): Promise<RenderedCrm> {
  registerFeatures(opts.features ?? ADMIN_UI_FEATURES);
  const crm = opts.crm ?? (await setupTestCrm({ demo: opts.demo ?? true }));
  const user = crm.as(opts.role ?? "admin").user!;
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  const path = opts.path ?? "/";
  const route = opts.route ?? path;
  act(() =>
    root.render(
      <I18nextProvider i18n={i18n}>
        <AuthProvider backend="local" identity={{ uid: user.id, email: user.email, displayName: user.name, role: user.role } satisfies StoreIdentity} user={user} onSignOut={async () => undefined}>
          <CrmDataProvider store={crm.store} user={user}>
            <MemoryRouter initialEntries={[route]}>
              <Routes>
                <Route path={path} element={element} />
                {(opts.routes ?? []).map((r) => (
                  <Route key={r.path} path={r.path} element={r.element} />
                ))}
                <Route path="*" element={<div data-testid="elsewhere" />} />
              </Routes>
            </MemoryRouter>
          </CrmDataProvider>
        </AuthProvider>
        <ToastContainer />
        <ConfirmHost />
      </I18nextProvider>,
    ),
  );

  const api: RenderedCrm = {
    crm,
    store: crm.store,
    user,
    el,
    root,
    text: () => document.body.textContent ?? "",
    async flush(ms = 20) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, ms));
      });
    },
    async waitFor(check, ms = 3000) {
      const start = Date.now();
      while (!check()) {
        if (Date.now() - start > ms) throw new Error(`timeout; body: ${(document.body.textContent ?? "").slice(0, 600)}`);
        await api.flush();
      }
    },
    findAll<T extends Element = HTMLElement>(selector: string, text?: string | RegExp): T[] {
      return [...document.body.querySelectorAll<T>(selector)].filter((e) => matches(e, text));
    },
    find<T extends Element = HTMLElement>(selector: string, text?: string | RegExp): T {
      const hit = api.findAll<T>(selector, text)[0];
      if (!hit) throw new Error(`No element ${selector}${text ? ` with text ${String(text)}` : ""}; body: ${(document.body.textContent ?? "").slice(0, 400)}`);
      return hit;
    },
    click(target) {
      if (!target) throw new Error("click: no element");
      act(() => {
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        (target as HTMLElement).click();
      });
    },
    type(target, value) {
      if (!target) throw new Error("type: no element");
      act(() => setNativeValue(target, value));
    },
    key(target, key, init = {}) {
      if (!target) throw new Error("key: no element");
      act(() => {
        target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
      });
    },
    unmount() {
      act(() => root.unmount());
      document.body.innerHTML = "";
    },
  };
  return api;
}
