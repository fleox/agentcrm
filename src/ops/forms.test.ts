import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Activity, CrmRecord } from "../core/types";
import { createMemoryConnector } from "../shared/storage/connectors/memory";
import { createAutomation, installAutomations } from "./automations";
import {
  buildFormHtml,
  companyDomainOfEmail,
  connectorInboxSource,
  createForm,
  deleteForm,
  firestoreInboxSource,
  getForm,
  ingestInbox,
  ingestSubmissions,
  listInbox,
  memoryInboxSource,
  parseSubmission,
  publishForm,
  setInboxSourceResolver,
  suggestFormFields,
  updateForm,
  validateForm,
  type InboxSubmission,
  type LeadFormInput,
} from "./forms";
import { createRecord } from "./records";
import { setupTestCrm, type TestCrm } from "./testing";

function contactForm(over: Partial<LeadFormInput> = {}): LeadFormInput {
  return {
    name: "Contact us",
    object: "people",
    fields: [
      { field: "firstName", label: "First name", required: true },
      { field: "lastName", label: "", required: false },
      { field: "email", label: "Work email", required: true },
      { field: "lifecycleStage", label: "Stage", required: false },
      { field: "tags", label: "Interests", required: false },
    ],
    inbox: { kind: "s3", settings: { uploadUrl: "https://bucket.s3.eu-west-3.amazonaws.com/inbox", prefix: "inbox/" } },
    successMessage: "Thanks <friend>!",
    hiddenValues: { leadSource: "website" },
    ...over,
  };
}

const people = (t: TestCrm) => (t.store.list("records") as unknown as CrmRecord[]).filter((r) => r.object === "people");
const companies = (t: TestCrm) => (t.store.list("records") as unknown as CrmRecord[]).filter((r) => r.object === "companies");
const notes = (t: TestCrm) => (t.store.list("activities") as unknown as Activity[]).filter((a) => a.meta?.source === "form");

function sub(id: string, formId: string, data: Record<string, unknown>, meta?: Record<string, unknown>): InboxSubmission {
  return { id, formId, data, createdAt: 1, ...(meta ? { meta } : {}) };
}

describe("forms CRUD", () => {
  let t: TestCrm;
  beforeEach(async () => {
    t = await setupTestCrm();
  });

  it("creates, updates and deletes; labels default to the field label", async () => {
    const f = await createForm(t.admin, contactForm());
    expect(f.fields[1]).toEqual({ field: "lastName", label: "Last name", required: false });
    expect(f.inbox.settings.prefix).toBe("inbox/");
    const u = await updateForm(t.admin, f.id, { name: "Contact" });
    expect(u.name).toBe("Contact");
    expect(u.createdAt).toBe(f.createdAt);
    await deleteForm(t.admin, f.id);
    expect(() => getForm(t.admin, f.id)).toThrow(/not found/);
  });

  it("validates fields and inbox settings", () => {
    expect(() => validateForm(t.admin, contactForm({ fields: [{ field: "company", label: "", required: false }] }))).toThrow(/relation fields can't.*at least one field/);
    expect(() => validateForm(t.admin, contactForm({ inbox: { kind: "s3", settings: {} } }))).toThrow(/upload URL/);
    expect(() => validateForm(t.admin, contactForm({ inbox: { kind: "firebase", settings: { projectId: "p" } } }))).toThrow(/API key/);
    expect(() => validateForm(t.admin, contactForm({ inbox: { kind: "webhook", settings: { url: "https://x.io", extra: "[1]" } } }))).toThrow(/JSON object/);
    expect(() => validateForm(t.admin, contactForm({ publishedPath: "../x.html" }))).toThrow(/relative/);
    expect(() => validateForm(t.admin, contactForm({ hiddenValues: { ghost: 1 } }))).toThrow(/ghost/);
  });

  it("requires forms.write", async () => {
    await expect(createForm(t.as("member"), contactForm())).rejects.toThrow(/Not allowed/);
  });

  it("suggests fields", () => {
    expect(suggestFormFields(t.admin, "people").map((f) => f.field)).toEqual(["firstName", "lastName", "email", "phone", "jobTitle"]);
  });
});

describe("buildFormHtml", () => {
  it("builds an accessible standalone page and an embed snippet", async () => {
    const t = await setupTestCrm();
    const f = await createForm(t.admin, contactForm({ name: "Contact <us> & co", accentColor: "#ff0000", texts: { description: "Talk to sales" } }));
    const built = await buildFormHtml(t.admin, f.id, { baseUrl: "https://example.com/" });
    expect(built.path).toBe("forms/contact-us-co/index.html");
    expect(built.url).toBe("https://example.com/forms/contact-us-co/");
    expect(built.html).toMatch(/^<!doctype html>/);
    expect(built.html).toContain("<title>Contact &lt;us&gt; &amp; co</title>");
    expect(built.html).toContain('<html lang="en">');
    expect(built.html).toContain('data-form-type="other"');
    expect(built.html).toMatch(/<label for="acrm-[^"]+-2">Work email <span class="acrm-req" aria-hidden="true">\*<\/span><\/label><input type="email" id="acrm-[^"]+-2" name="email" required aria-required="true"/);
    expect(built.html).toContain('<option value="lead">Lead</option>');
    expect(built.html).toContain('name="_hp" tabindex="-1" autocomplete="off"');
    expect(built.html).toContain('role="status" aria-live="polite"');
    expect(built.html).toContain("--acrm-accent:#ff0000");
    expect(built.html).toContain("Talk to sales");
    // Config is script-safe.
    expect(built.html).not.toContain("Thanks <friend>");
    expect(built.html).toContain("Thanks \\u003cfriend\\u003e!");
    expect(built.html).toContain('"endpoint":"https://bucket.s3.eu-west-3.amazonaws.com/inbox/"');
    expect(built.embedSnippet).toContain(`data-agentcrm-form="${f.id}"`);
    expect(built.embedSnippet).toContain("<script>");
    expect(built.embedSnippet).not.toContain("<html");
  });

  it("builds Firestore and webhook endpoints", async () => {
    const t = await setupTestCrm();
    const fb = await createForm(t.admin, contactForm({ inbox: { kind: "firebase", settings: { projectId: "my-proj", apiKey: "AIza123" } } }));
    expect((await buildFormHtml(t.admin, fb.id)).html).toContain("https://firestore.googleapis.com/v1/projects/my-proj/databases/(default)/documents/inbox?key=AIza123");
    const wh = await createForm(t.admin, contactForm({ inbox: { kind: "webhook", settings: { url: "https://formspree.io/f/abc", extra: '{"access_key":"k"}', format: "form" } } }));
    const html = (await buildFormHtml(t.admin, wh.id)).html;
    expect(html).toContain('"endpoint":"https://formspree.io/f/abc"');
    expect(html).toContain('"extra":{"access_key":"k"}');
    expect(html).toContain('"format":"form"');
  });

  it("publishes through an uploader and records the URL", async () => {
    const t = await setupTestCrm();
    const f = await createForm(t.admin, contactForm());
    const connector = createMemoryConnector();
    const res = await publishForm(t.admin, f.id, { put: (i) => connector.put(i), publicUrl: async (p) => `https://site.test/${p}` });
    expect(res.url).toBe("https://site.test/forms/contact-us/");
    expect(new TextDecoder().decode(connector.files.get("forms/contact-us/index.html"))).toContain("<form");
    const stored = getForm(t.admin, f.id);
    expect(stored.publishedUrl).toBe("https://site.test/forms/contact-us/");
    expect(stored.publishedAt).toBe(t.clock.now);
  });
});

describe("ingestion", () => {
  let t: TestCrm;
  let formId: string;
  beforeEach(async () => {
    t = await setupTestCrm();
    formId = (await createForm(t.admin, contactForm())).id;
  });
  afterEach(() => setInboxSourceResolver(null));

  it("creates people + company from the email domain, dedupes on email, logs a note", async () => {
    const before = people(t).length;
    const report = await ingestSubmissions(t.admin, [
      sub("s1", formId, { firstName: "Ada", lastName: "Lovelace", email: " Ada@Analytical-Engines.co.uk ", tags: ["crm"], extra: "ignored" }, { page: "https://site/contact" }),
      sub("s2", formId, { firstName: "Ada", email: "ada@analytical-engines.co.uk", lastName: "King" }),
      sub("s3", formId, { firstName: "Bob", email: "bob@gmail.com" }),
    ]);
    expect(report).toMatchObject({ processed: 3, created: 2, updated: 1, failed: 0, companiesCreated: 1 });
    expect(people(t).length).toBe(before + 2);
    const ada = people(t).find((p) => p.fields.email === "ada@analytical-engines.co.uk")!;
    expect(ada.fields).toMatchObject({ firstName: "Ada", lastName: "King", leadSource: "website", tags: ["crm"] });
    expect(ada.fields.extra).toBeUndefined();
    expect(ada.ownerId).toBeUndefined();
    const company = companies(t).find((c) => c.id === ada.fields.company)!;
    expect(company.fields).toMatchObject({ name: "Analytical Engines" });
    expect(company.fields.domain).toContain("analytical-engines.co.uk");
    const bob = people(t).find((p) => p.fields.email === "bob@gmail.com")!;
    expect(bob.fields.company).toBeUndefined();
    const adaNotes = notes(t).filter((n) => n.targets.some((x) => x.id === ada.id));
    expect(adaNotes).toHaveLength(2);
    expect(adaNotes[0].title).toBe("Form submission: Contact us");
    expect(adaNotes.find((n) => n.meta?.submissionId === "s1")!.body).toContain("- **Work email:** ada@analytical-engines.co.uk");
    expect(adaNotes.find((n) => n.meta?.submissionId === "s1")!.body).toContain("- **Page:** https://site/contact");
    expect(adaNotes[0].targets.map((x) => x.object).sort()).toEqual(["companies", "people"]);
  });

  it("links an existing company by domain", async () => {
    const acme = await createRecord(t.admin, "companies", { name: "Acme", domain: "https://www.acme.com" });
    await ingestSubmissions(t.admin, [sub("s1", formId, { firstName: "Al", email: "al@acme.com" })]);
    expect(people(t).find((p) => p.fields.email === "al@acme.com")!.fields.company).toBe(acme.id);
    expect(companies(t).filter((c) => String(c.fields.domain).includes("acme.com"))).toHaveLength(1);
  });

  it("drops spam, fails invalid submissions and never ingests a submission twice", async () => {
    const inbox = memoryInboxSource([
      sub("spam", formId, { firstName: "X", email: "x@x.io", _hp: "http://spam" }),
      sub("bad", formId, { email: "nofirst@x.io" }),
      sub("ghost", "nope", { firstName: "G" }),
      sub("ok", formId, { firstName: "Ok", email: "ok@corp.io" }),
    ]);
    const r = await ingestInbox(t.admin, undefined, { source: inbox });
    expect(r).toMatchObject({ processed: 4, created: 1, failed: 2, spam: 1 });
    expect(r.errors.map((e) => e.submission)).toEqual(["bad", "ghost"]);
    expect(r.errors[0].message).toMatch(/First name/);
    expect(inbox.items).toHaveLength(0);
    expect(inbox.failed.map((f) => f.id)).toEqual(["bad", "ghost"]);
    // Same submission again (e.g. its delete failed last time).
    const again = await ingestSubmissions(t.admin, [sub("ok", formId, { firstName: "Ok", email: "ok@corp.io" })]);
    expect(again.results?.[0].outcome).toBe("duplicate");
    expect(people(t).filter((p) => p.fields.email === "ok@corp.io")).toHaveLength(1);
    expect(getForm(t.admin, formId).lastIngestAt).toBe(t.clock.now);
  });

  it("dry run writes nothing and acknowledges nothing", async () => {
    const inbox = memoryInboxSource([sub("s1", formId, { firstName: "Dry", email: "dry@dry.io" })]);
    const before = t.store.list("records").length;
    const r = await ingestInbox(t.admin, formId, { source: inbox, dryRun: true });
    expect(r).toMatchObject({ processed: 1, created: 1, companiesCreated: 1 });
    expect(t.store.list("records").length).toBe(before);
    expect(inbox.items).toHaveLength(1);
  });

  it("fires record.created automations", async () => {
    const off = installAutomations(t.plugins);
    try {
      await createAutomation(t.admin, { name: "Lead task", object: "people", trigger: { type: "record.created" }, actions: [{ type: "createTask", title: "Call {{label}}" }] });
      await ingestSubmissions(t.admin, [sub("s1", formId, { firstName: "Auto", email: "auto@corp.io" })]);
      const tasks = (t.store.list("activities") as unknown as Activity[]).filter((a) => a.type === "task" && a.title === "Call Auto");
      expect(tasks).toHaveLength(1);
    } finally {
      off();
    }
  });

  it("reads an S3-like connector inbox through the resolver and moves failures aside", async () => {
    const bucket = createMemoryConnector();
    await bucket.put({ path: `inbox/${formId}/100-a.json`, content: JSON.stringify({ formId, data: { firstName: "S3", email: "s3@corp.io" }, createdAt: 100 }) });
    await bucket.put({ path: `inbox/${formId}/200-b.json`, content: "not json" });
    await bucket.put({ path: "inbox/readme.txt", content: "ignored" });
    setInboxSourceResolver((_ctx, form) => (form.inbox.kind === "s3" ? connectorInboxSource(bucket, form.inbox.settings.prefix) : null));
    const pending = await listInbox(t.admin, formId);
    // The unparseable file (createdAt 0) sorts first.
    expect(pending.submissions.map((s) => s.id)).toEqual([`inbox/${formId}/200-b.json`, `inbox/${formId}/100-a.json`]);
    const r = await ingestInbox(t.admin);
    expect(r).toMatchObject({ created: 1, failed: 1 });
    expect([...bucket.files.keys()].sort()).toEqual(["inbox-failed/" + formId + "/200-b.json", "inbox/readme.txt"]);
    expect(JSON.parse(new TextDecoder().decode(bucket.files.get(`inbox-failed/${formId}/200-b.json`)))).toMatchObject({ raw: "not json", _error: "Not a valid submission file." });
  });

  it("skips webhook forms and forms without credentials", async () => {
    const wh = await createForm(t.admin, contactForm({ name: "Hook", inbox: { kind: "webhook", settings: { url: "https://hook.io/x" } } }));
    const r = await ingestInbox(t.admin);
    expect(r.skippedForms?.map((s) => s.formId).sort()).toEqual([formId, wh.id].sort());
  });

  it("requires records.write", async () => {
    await expect(ingestInbox(t.as("viewer"))).rejects.toThrow(/Not allowed/);
  });
});

describe("inbox helpers", () => {
  it("parses submissions and company domains", () => {
    expect(parseSubmission("x", '{"formId":"f","data":{"a":1},"createdAt":"5"}')).toEqual({ id: "x", formId: "f", data: { a: 1 }, createdAt: 5 });
    expect(parseSubmission("x", "{}")).toBeNull();
    expect(companyDomainOfEmail("a@Sub.Example.com")).toBe("sub.example.com");
    expect(companyDomainOfEmail("a@hotmail.fr")).toBeNull();
  });

  it("reads Firestore over REST with the admin token", async () => {
    const calls: { url: string; method?: string; auth?: string }[] = [];
    const fetchMock = async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      calls.push({ url, method: init?.method, auth: init?.headers?.authorization });
      const body =
        init?.method === undefined
          ? {
              documents: [
                {
                  name: "projects/p/databases/(default)/documents/inbox/d1",
                  fields: { formId: { stringValue: "f1" }, createdAt: { integerValue: "42" }, data: { mapValue: { fields: { email: { stringValue: "a@b.io" }, tags: { arrayValue: { values: [{ stringValue: "x" }] } }, ok: { booleanValue: true } } } } },
                },
                { name: "projects/p/databases/(default)/documents/inbox/d2", fields: { formId: { stringValue: "f1" }, data: { mapValue: {} }, status: { stringValue: "failed" } } },
              ],
            }
          : {};
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    };
    const src = firestoreInboxSource({ projectId: "p", getToken: async () => "tok", fetch: fetchMock });
    const list = await src.list();
    expect(list).toEqual([{ id: "projects/p/databases/(default)/documents/inbox/d1", formId: "f1", createdAt: 42, data: { email: "a@b.io", tags: ["x"], ok: true } }]);
    await src.remove(list[0].id);
    expect(calls[0]).toMatchObject({ url: "https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/inbox?pageSize=300", auth: "Bearer tok" });
    expect(calls[1]).toMatchObject({ url: "https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/inbox/d1", method: "DELETE" });
  });
});
