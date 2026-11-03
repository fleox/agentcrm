import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode } from "./mime";
import { buildGmailQuery, gmailSearchMessages, gmailSend, googleListEvents, mapGmailMessage, mapGoogleEvent, type GmailMessageJson } from "./google";
import type { FetchLike } from "./types";

export const gmailFixture: GmailMessageJson = {
  id: "18f0a1",
  threadId: "18f0a0",
  labelIds: ["INBOX"],
  snippet: "Hi, here&#39;s the proposal",
  internalDate: String(Date.UTC(2024, 5, 14, 9, 30)),
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: "Ada Lovelace <ada.lovelace@acmerobotics.com>" },
      { name: "To", value: "me@example.com, \"Bob\" <bob@globex.io>" },
      { name: "Cc", value: "x@gmail.com" },
      { name: "Subject", value: "=?UTF-8?B?" + btoa(unescape(encodeURIComponent("Proposition été"))) + "?=" },
      { name: "Date", value: "Fri, 14 Jun 2024 09:30:00 +0000" },
      { name: "Message-ID", value: "<abc@mail.gmail.com>" },
    ],
    parts: [
      { mimeType: "text/plain", body: { data: base64UrlEncode("Hello Ada ✓\r\nLine 2") } },
      { mimeType: "text/html", body: { data: base64UrlEncode("<p>Hello</p>") } },
    ],
  },
};

type Call = { url: string; init?: Parameters<FetchLike>[1] };
function fakeFetch(routes: (url: string, init?: Parameters<FetchLike>[1]) => unknown, calls: Call[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    const out = routes(url, init);
    const status = typeof out === "object" && out && "__status" in out ? (out as { __status: number }).__status : 200;
    return { ok: status < 400, status, json: async () => out, text: async () => JSON.stringify(out) };
  };
}

describe("gmail", () => {
  it("maps a message", () => {
    const m = mapGmailMessage(gmailFixture);
    expect(m).toMatchObject({
      id: "18f0a1",
      threadId: "18f0a0",
      provider: "google",
      from: { email: "ada.lovelace@acmerobotics.com", name: "Ada Lovelace" },
      subject: "Proposition été",
      snippet: "Hi, here's the proposal",
      date: Date.UTC(2024, 5, 14, 9, 30),
      body: "Hello Ada ✓\nLine 2",
      internetMessageId: "<abc@mail.gmail.com>",
    });
    expect(m.to.map((a) => a.email)).toEqual(["me@example.com", "bob@globex.io"]);
    expect(m.cc).toEqual([{ email: "x@gmail.com" }]);
  });

  it("builds queries", () => {
    expect(buildGmailQuery({ emails: ["a@x.io"] })).toBe("from:a@x.io OR to:a@x.io OR cc:a@x.io");
    expect(buildGmailQuery({ domains: ["acme.com"] })).toBe("from:*@acme.com OR to:*@acme.com");
    expect(buildGmailQuery({})).toBe("");
  });

  it("searches (list + get) and sends with a mocked fetch", async () => {
    const calls: Call[] = [];
    const fetchImpl = fakeFetch((url) => {
      if (url.includes("/messages?")) return { messages: [{ id: "18f0a1" }, { id: "18f0a2" }] };
      if (url.includes("/messages/18f0a1")) return gmailFixture;
      if (url.includes("/messages/18f0a2")) return { ...gmailFixture, id: "18f0a2", internalDate: String(Date.UTC(2024, 5, 15)) };
      if (url.endsWith("/messages/send")) return { id: "sent1", threadId: "t1" };
      return { __status: 404 };
    }, calls);
    const list = await gmailSearchMessages("tok", { q: "from:a@x.io", maxResults: 5 }, fetchImpl);
    expect(list.map((m) => m.id)).toEqual(["18f0a2", "18f0a1"]);
    expect(calls[0].url).toContain("q=from%3Aa%40x.io");
    expect(calls[0].url).toContain("maxResults=5");
    expect(calls[0].init?.headers?.Authorization).toBe("Bearer tok");
    expect(calls[1].url).toContain("format=metadata");
    expect(calls[1].url).toContain("metadataHeaders=Subject");

    const sent = await gmailSend("tok", { to: ["ada@x.io"], subject: "Hi", body: "Body" }, fetchImpl);
    expect(sent).toEqual({ id: "sent1", threadId: "t1" });
    const last = calls[calls.length - 1];
    expect(last.init?.method).toBe("POST");
    const raw = (JSON.parse(last.init!.body!) as { raw: string }).raw;
    expect(raw).not.toMatch(/[+/=]/);
    expect(base64UrlDecode(raw)).toContain("Subject: Hi");
  });

  it("surfaces API errors", async () => {
    const fetchImpl = fakeFetch(() => ({ __status: 401, error: { message: "Invalid Credentials" } }));
    await expect(gmailSearchMessages("bad", { q: "x" }, fetchImpl)).rejects.toMatchObject({ status: 401, unauthorized: true, provider: "google" });
  });
});

describe("google calendar", () => {
  it("maps events (timed, all-day, cancelled)", () => {
    const e = mapGoogleEvent({
      id: "ev1",
      summary: "Demo",
      start: { dateTime: "2024-06-20T09:00:00Z" },
      end: { dateTime: "2024-06-20T10:00:00Z" },
      location: "Zoom",
      htmlLink: "https://calendar.google.com/x",
      attendees: [{ email: "Ada.Lovelace@acmerobotics.com", displayName: "Ada", responseStatus: "accepted" }, { email: "room@resource.calendar.google.com", resource: true }],
    });
    expect(e).toMatchObject({ id: "ev1", provider: "google", title: "Demo", start: Date.UTC(2024, 5, 20, 9), end: Date.UTC(2024, 5, 20, 10), location: "Zoom" });
    expect(e.attendees).toEqual([{ email: "ada.lovelace@acmerobotics.com", name: "Ada", response: "accepted" }]);
    const all = mapGoogleEvent({ id: "ev2", start: { date: "2024-06-21" }, end: { date: "2024-06-22" }, status: "cancelled" });
    expect(all).toMatchObject({ title: "(no title)", allDay: true, cancelled: true, start: new Date(2024, 5, 21).getTime() });
  });

  it("lists events with paging", async () => {
    const calls: Call[] = [];
    const fetchImpl = fakeFetch((url) =>
      url.includes("pageToken=p2")
        ? { items: [{ id: "b", start: { dateTime: "2024-06-21T09:00:00Z" } }] }
        : { items: [{ id: "a", start: { dateTime: "2024-06-20T09:00:00Z" } }], nextPageToken: "p2" },
    calls);
    const events = await googleListEvents("tok", { timeMin: Date.UTC(2024, 5, 1), timeMax: Date.UTC(2024, 6, 1) }, fetchImpl);
    expect(events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(calls[0].url).toContain("/calendars/primary/events?");
    expect(calls[0].url).toContain("singleEvents=true");
    expect(calls[0].url).toContain("orderBy=startTime");
    expect(calls[0].url).toContain("timeMin=2024-06-01T00%3A00%3A00.000Z");
  });
});
