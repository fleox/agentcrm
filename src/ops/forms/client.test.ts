// @vitest-environment happy-dom
// Runs the generated client script in a DOM: honeypot, minimum fill
// time, payload shape per inbox kind, success message.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectDef } from "../../core/types";
import { standardObjects } from "../../core/schema/standardObjects";
import { buildFormArtifacts } from "./html";
import type { LeadFormDoc } from "./types";

const people = standardObjects(Date.now()).find((o: ObjectDef) => o.id === "people")!;

function form(inbox: LeadFormDoc["inbox"]): LeadFormDoc {
  return {
    id: "f1",
    name: "Contact",
    object: "people",
    fields: [
      { field: "firstName", label: "First name", required: true },
      { field: "email", label: "Email", required: true },
      { field: "tags", label: "Tags", required: false },
    ],
    inbox,
    successMessage: "Merci !",
  };
}

function mount(f: LeadFormDoc) {
  const built = buildFormArtifacts(f, people);
  document.body.innerHTML = built.embedSnippet.replace(/<script>[\s\S]*<\/script>/, "");
  new Function(built.embedSnippet.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "")();
  const el = document.querySelector("form")!;
  (el.querySelector('[name="firstName"]') as HTMLInputElement).value = "Ada";
  (el.querySelector('[name="email"]') as HTMLInputElement).value = "ada@corp.io";
  (el.querySelector('[name="tags"]') as HTMLInputElement).value = "a, b";
  return el;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("generated form script", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, type: "cors" }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("refuses too-fast submissions, then PUTs to the S3 inbox and shows the success message", async () => {
    const el = mount(form({ kind: "s3", settings: { uploadUrl: "https://b.s3.amazonaws.com/inbox/" } }));
    el.requestSubmit();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(el.querySelector(".acrm-status")!.textContent).toMatch(/take a second/);
    vi.setSystemTime(Date.now() + 5000);
    el.requestSubmit();
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toMatch(/^https:\/\/b\.s3\.amazonaws\.com\/inbox\/f1\/\d+-[0-9a-f]{12}\.json$/);
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ formId: "f1", data: { firstName: "Ada", email: "ada@corp.io", tags: ["a", "b"] } });
    expect(typeof body.createdAt).toBe("number");
    expect(body.meta.elapsedMs).toBeGreaterThanOrEqual(2500);
    expect(document.querySelector(".acrm-success")!.textContent).toBe("Merci !");
  });

  it("silently drops honeypot submissions", async () => {
    const el = mount(form({ kind: "s3", settings: { uploadUrl: "https://b/inbox/" } }));
    (el.querySelector('[name="_hp"]') as HTMLInputElement).value = "bot";
    vi.setSystemTime(Date.now() + 5000);
    el.requestSubmit();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector(".acrm-success")!.textContent).toBe("Merci !");
  });

  it("POSTs Firestore REST documents and flat webhook payloads", async () => {
    let el = mount(form({ kind: "firebase", settings: { projectId: "p", apiKey: "k" } }));
    vi.setSystemTime(Date.now() + 5000);
    el.requestSubmit();
    await flush();
    let [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe("https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/inbox?key=k");
    const doc = JSON.parse(init.body);
    expect(doc.fields.formId).toEqual({ stringValue: "f1" });
    expect(doc.fields.data.mapValue.fields.tags).toEqual({ arrayValue: { values: [{ stringValue: "a" }, { stringValue: "b" }] } });
    expect(doc.fields.createdAt.integerValue).toMatch(/^\d+$/);

    el = mount(form({ kind: "webhook", settings: { url: "https://hook.io/x", extra: '{"access_key":"K"}' } }));
    vi.setSystemTime(Date.now() + 5000);
    el.requestSubmit();
    await flush();
    [url, init] = fetchMock.mock.calls[1] as [string, { method: string; body: string }];
    expect(url).toBe("https://hook.io/x");
    expect(JSON.parse(init.body)).toMatchObject({ firstName: "Ada", email: "ada@corp.io", access_key: "K", _formId: "f1" });
  });

  it("shows an error and re-enables the button when the inbox refuses", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 403, type: "cors" }));
    const el = mount(form({ kind: "s3", settings: { uploadUrl: "https://b/inbox/" } }));
    vi.setSystemTime(Date.now() + 5000);
    el.requestSubmit();
    await flush();
    await flush();
    expect(el.querySelector(".acrm-status")!.textContent).toMatch(/went wrong/);
    expect((el.querySelector("button") as HTMLButtonElement).disabled).toBe(false);
  });
});
