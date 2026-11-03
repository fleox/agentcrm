import { describe, expect, it } from "vitest";
import { setupTestCrm } from "../testing";
import { createRecord } from "../records";
import { recordsOf } from "../store";
import type { CrmRecord } from "../../core/types";
import { contactQuery, findSyncedActivity, logEmail, loggedEmailIds, syncMeetings, upcomingMeetings } from "./log";
import { matchContacts } from "./match";
import type { CalendarEvent, EmailMessage } from "./types";

async function crm() {
  const t = await setupTestCrm({ demo: true });
  const people = recordsOf(t.store, "people");
  const ada = people.find((p) => p.fields.email === "ada.lovelace@acmerobotics.com") as CrmRecord;
  const acme = recordsOf(t.store, "companies").find((c) => c.fields.name === "Acme Robotics") as CrmRecord;
  return { ...t, ada, acme };
}

const message = (over: Partial<EmailMessage> = {}): EmailMessage => ({
  id: "m1",
  threadId: "t1",
  provider: "google",
  from: { email: "ada.lovelace@acmerobotics.com", name: "Ada" },
  to: [{ email: "me@example.com" }],
  cc: [],
  subject: "Proposal",
  snippet: "Here it is",
  date: Date.UTC(2024, 5, 14),
  ...over,
});

describe("matchContacts", () => {
  it("matches people by email, companies by domain, ignores free mail", async () => {
    const { admin, ada, acme } = await crm();
    expect(ada.fields.company).toBe(acme.id);
    const m = matchContacts(admin, ["ADA.Lovelace@AcmeRobotics.com ", "someone.new@acmerobotics.com", "x@gmail.com", "nope"]);
    expect(m.people.map((p) => p.id)).toEqual([ada.id]);
    expect(m.companies.map((c) => c.id)).toEqual([acme.id]);
    expect(m.byEmail["someone.new@acmerobotics.com"]).toEqual({ people: [], companies: [acme.id] });
    expect(m.byEmail["x@gmail.com"]).toEqual({ people: [], companies: [] });

    await createRecord(admin, "companies", { name: "Gmail Inc", domain: "gmail.com" });
    expect(matchContacts(admin, ["x@gmail.com"]).companies).toEqual([]);
  });

  it("builds a contact query per record", async () => {
    const { admin, ada, acme } = await crm();
    expect(contactQuery(admin, ada)).toEqual({ emails: ["ada.lovelace@acmerobotics.com"], domains: [] });
    expect(contactQuery(admin, acme)).toEqual({ emails: [], domains: ["acmerobotics.com"] });
  });
});

describe("logEmail", () => {
  it("creates one email activity on the person + company, idempotently", async () => {
    const { admin, ada, acme } = await crm();
    const first = await logEmail(admin, message(), { selfEmails: ["me@example.com"] });
    expect(first.created).toBe(true);
    expect(first.activity.type).toBe("email");
    expect(first.activity.title).toBe("Proposal");
    expect(first.activity.body).toBe("Here it is");
    expect(first.activity.targets).toEqual([{ object: "people", id: ada.id }, { object: "companies", id: acme.id }]);
    expect(first.activity.meta).toMatchObject({ provider: "google", externalId: "m1", threadId: "t1", from: "ada.lovelace@acmerobotics.com", to: ["me@example.com"], cc: [], subject: "Proposal", direction: "inbound", date: Date.UTC(2024, 5, 14) });
    const again = await logEmail(admin, message({ subject: "changed" }));
    expect(again.created).toBe(false);
    expect(again.activity.id).toBe(first.activity.id);
    expect(loggedEmailIds(admin).has("google:m1")).toBe(true);
    // Same id on another provider is another message.
    const ms = await logEmail(admin, message({ provider: "microsoft" }));
    expect(ms.created).toBe(true);
  });

  it("direction, extra targets, no match, roles", async () => {
    const { admin, as, ada } = await crm();
    const out = await logEmail(admin, message({ id: "m2", from: { email: "me@example.com" }, to: [{ email: "ada.lovelace@acmerobotics.com" }] }), { selfEmails: ["Me@Example.com"] });
    expect(out.activity.meta?.direction).toBe("outbound");
    await expect(logEmail(admin, message({ id: "m3", from: { email: "x@gmail.com" }, to: [] }))).rejects.toMatchObject({ code: "validation" });
    const withTarget = await logEmail(admin, message({ id: "m4", from: { email: "x@gmail.com" }, to: [] }), { targets: [{ object: "people", id: ada.id }] });
    expect(withTarget.activity.targets).toEqual([{ object: "people", id: ada.id }]);
    await expect(logEmail(as("viewer"), message({ id: "m5" }))).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("syncMeetings", () => {
  const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
    id: "ev1",
    provider: "google",
    title: "Demo",
    start: Date.UTC(2024, 5, 20, 9),
    end: Date.UTC(2024, 5, 20, 10),
    attendees: [{ email: "me@example.com" }, { email: "ada.lovelace@acmerobotics.com" }],
    location: "Zoom",
    ...over,
  });

  it("creates, then is idempotent, then updates times", async () => {
    const { admin, ada, acme, clock } = await crm();
    const r1 = await syncMeetings(admin, [event(), event({ id: "ev-unknown", attendees: [{ email: "z@unknown.org" }] })], { selfEmails: ["me@example.com"] });
    expect(r1.created).toHaveLength(1);
    expect(r1.skipped).toBe(1);
    const meeting = r1.created[0];
    expect(meeting.type).toBe("meeting");
    expect(meeting.targets).toEqual([{ object: "people", id: ada.id }, { object: "companies", id: acme.id }]);
    expect(meeting.meta).toMatchObject({ provider: "google", externalId: "ev1", startAt: Date.UTC(2024, 5, 20, 9), endAt: Date.UTC(2024, 5, 20, 10), attendees: ["me@example.com", "ada.lovelace@acmerobotics.com"], location: "Zoom" });

    const r2 = await syncMeetings(admin, [event()], { selfEmails: ["me@example.com"] });
    expect(r2).toMatchObject({ created: [], updated: [], unchanged: 1 });

    const r3 = await syncMeetings(admin, [event({ start: Date.UTC(2024, 5, 21, 9), end: Date.UTC(2024, 5, 21, 11), title: "Demo (moved)" })]);
    expect(r3.updated).toHaveLength(1);
    const updated = findSyncedActivity(admin, "google", "ev1")!;
    expect(updated.id).toBe(meeting.id);
    expect(updated.title).toBe("Demo (moved)");
    expect(updated.meta).toMatchObject({ startAt: Date.UTC(2024, 5, 21, 9), endAt: Date.UTC(2024, 5, 21, 11), location: "Zoom" });

    clock.now = Date.UTC(2024, 5, 18);
    expect(upcomingMeetings(admin, acme.id).map((a) => a.id)).toEqual([meeting.id]);
    clock.now = Date.UTC(2024, 5, 22);
    expect(upcomingMeetings(admin, acme.id)).toEqual([]);

    const r4 = await syncMeetings(admin, [event({ cancelled: true })]);
    expect(r4.updated[0].meta?.cancelled).toBe(true);
  });

  it("includeUnmatched attaches to the given record", async () => {
    const { admin, acme } = await crm();
    const r = await syncMeetings(admin, [event({ id: "x", attendees: [{ email: "z@unknown.org" }] })], { targets: [{ object: "companies", id: acme.id }], includeUnmatched: true });
    expect(r.created[0].targets).toEqual([{ object: "companies", id: acme.id }]);
  });
});
