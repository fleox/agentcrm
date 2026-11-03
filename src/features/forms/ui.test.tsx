// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderCrm, type RenderedCrm } from "../records/testing/renderCrm";
import forms from "./index";
import { FormsPage } from "./FormsPage";
import { FormBuilderPage } from "./FormBuilder";
import { InboxPage } from "./InboxPage";
import { createForm, memoryInboxSource, setInboxSourceResolver, type LeadFormDoc } from "../../ops/forms";
import type { CrmRecord } from "../../core/types";

const routes = [
  { path: "/forms", element: createElement(FormsPage) },
  { path: "/forms/inbox", element: createElement(InboxPage) },
  { path: "/forms/:formId", element: createElement(FormBuilderPage) },
];

let ui: RenderedCrm | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
  setInboxSourceResolver(null);
});

describe("forms UI", () => {
  it("builds a form with a live preview and saves it", async () => {
    ui = await renderCrm(createElement(FormBuilderPage), { path: "/forms/:formId", route: "/forms/new", features: [forms], routes });
    await ui.waitFor(() => ui!.text().includes("Live preview"));
    const iframe = ui.find<HTMLIFrameElement>("iframe");
    expect(iframe.getAttribute("srcdoc")).toContain('data-agentcrm-form="preview"');
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    ui.type(ui.find("#form-name"), "Demo request");
    ui.type(ui.find('input[placeholder="https://my-bucket.s3.eu-west-3.amazonaws.com/inbox/"]'), "https://bucket.s3.amazonaws.com/inbox/");
    ui.click(ui.find("button", "Save"));
    await ui.waitFor(() => ui!.store.list("forms").length === 1);
    const f = ui.store.list("forms")[0] as unknown as LeadFormDoc;
    expect(f).toMatchObject({ name: "Demo request", object: "people", inbox: { kind: "s3" }, hiddenValues: { lifecycleStage: "lead", leadSource: "website" } });
    expect(f.fields.map((x) => x.field)).toEqual(["firstName", "lastName", "email", "phone", "jobTitle"]);
  });

  it("shows engine validation errors", async () => {
    ui = await renderCrm(createElement(FormBuilderPage), { path: "/forms/:formId", route: "/forms/new", features: [forms], routes });
    await ui.waitFor(() => ui!.text().includes("Live preview"));
    ui.click(ui.find("button", "Save"));
    await ui.waitFor(() => ui!.text().includes("public upload URL"));
    expect(ui.store.list("forms")).toHaveLength(0);
  });

  it("lists pending submissions and ingests them", async () => {
    ui = await renderCrm(createElement(FormsPage), { path: "/forms", features: [forms], routes });
    const crm = ui.crm;
    const form = await createForm(crm.admin, {
      name: "Contact",
      object: "people",
      fields: [
        { field: "firstName", label: "First name", required: true },
        { field: "email", label: "Email", required: true },
      ],
      inbox: { kind: "s3", settings: { uploadUrl: "https://b/inbox/" } },
      successMessage: "Thanks",
    });
    await ui.waitFor(() => ui!.text().includes("Contact") && ui!.text().includes("Not published"));
    ui.unmount();
    const inbox = memoryInboxSource([{ id: "inbox/x/1.json", formId: form.id, data: { firstName: "Zed", email: "zed@zcorp.io" }, createdAt: crm.clock.now }]);
    setInboxSourceResolver(() => inbox);
    ui = await renderCrm(createElement(InboxPage), { path: "/forms/inbox", crm, features: [forms] });
    await ui.waitFor(() => ui!.text().includes("firstName: Zed"));
    ui.click(ui.find("button", "Ingest now"));
    await ui.waitFor(() => ui!.text().includes("Created: 1"));
    expect((crm.store.list("records") as unknown as CrmRecord[]).some((r) => r.fields.email === "zed@zcorp.io")).toBe(true);
    await ui.waitFor(() => ui!.text().includes("The inbox is empty"));
  });
});
