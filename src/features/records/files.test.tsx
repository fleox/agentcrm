// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { Activity, CrmRecord, FileMeta } from "../../core/types";
import { renderCrm, type RenderedCrm } from "./testing/renderCrm";
import { RecordPage } from "./RecordPage";
import { renderMarkdown } from "../../components/ui";

let current: RenderedCrm | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
});

const recordRoute = { path: "/objects/:objectId/:recordId" };

function setFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { configurable: true, value: files });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("record files UI", () => {
  it("shows the avatar, attaches files in the composer, lists them in the Files tab", async () => {
    const c = await renderCrm(<RecordPage />, { ...recordRoute, route: "/objects/people/__ID__", demo: true });
    const person = (c.store.list("records") as unknown as CrmRecord[]).find((r) => r.object === "people" && r.fields.avatar)!;
    c.unmount();
    current = await renderCrm(<RecordPage />, { ...recordRoute, route: `/objects/people/${person.id}?tab=notes`, crm: c.crm });
    const ui = current;
    await ui.waitFor(() => !!ui.el.querySelector('[data-testid="record-avatar"]'));
    expect(ui.el.querySelector('[data-testid="record-avatar"]')).toBeTruthy();
    // Composer: attach a document, save the note.
    const input = ui.el.querySelector<HTMLInputElement>('[data-testid="composer-file-input"]')!;
    await act(async () => setFiles(input, [new File(["%PDF-1.4 demo"], "offer.pdf", { type: "application/pdf" })]));
    await ui.waitFor(() => ui.text().includes("offer.pdf") && !ui.text().includes("Uploading"));
    ui.type(ui.find("textarea"), "Offer sent");
    await act(async () => {
      ui.find("form[data-testid=activity-composer]").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await ui.waitFor(() => (ui.store.list("activities") as unknown as Activity[]).some((a) => a.body === "Offer sent" && a.attachments?.length === 1));
    const note = (ui.store.list("activities") as unknown as Activity[]).find((a) => a.body === "Offer sent")!;
    const file = ui.store.get("files", note.attachments![0]) as unknown as FileMeta;
    expect(file).toMatchObject({ name: "offer.pdf", mime: "application/pdf", targets: [{ kind: "activity", id: note.id }] });
    await ui.waitFor(() => !!ui.el.querySelector(`[data-activity-id="${note.id}"] [data-file-id="${file.id}"]`));

    // Files tab: the avatar (record) and the note's PDF.
    ui.click(ui.find('[role="tab"]', /Files/));
    await ui.waitFor(() => !!ui.el.querySelector('[data-testid="files-grid"]'));
    expect(ui.el.querySelector(`[data-testid="files-grid"] [data-file-id="${file.id}"]`)).toBeTruthy();
    expect(ui.el.querySelector(`[data-testid="files-grid"] [data-file-id="${person.fields.avatar}"]`)).toBeTruthy();
    // Image → lightbox.
    ui.click(ui.el.querySelector(`[data-testid="files-grid"] [data-file-id="${person.fields.avatar}"] button`));
    await ui.waitFor(() => !!document.querySelector('[data-testid="lightbox"]'));
  });

  it("renders file: images through the store and drops unsafe image URLs", () => {
    const html = renderMarkdown("![a](file:abc123) ![b](https://x.io/b.png) ![c](javascript:alert(1)) <img src=\"http://evil/x.png\"> ![d](data:image/png;base64,AAAA)");
    expect(html).toContain('data-file-id="abc123"');
    expect(html).toContain('src="https://x.io/b.png"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("http://evil");
    expect(html).not.toContain("data:image");
  });
});
