import { describe, expect, it } from "vitest";
import {
  buildGraphSearch,
  buildGraphSendMailBody,
  buildMicrosoftAuthorizeUrl,
  createPkcePair,
  exchangeMicrosoftCode,
  graphCalendarView,
  graphSearchMessages,
  graphSendMail,
  graphSendViaDraft,
  mapGraphEvent,
  mapGraphMessage,
  refreshMicrosoftToken,
  type GraphMessageJson,
} from "./microsoft";
import type { FetchLike } from "./types";

const graphFixture: GraphMessageJson = {
  id: "AAMk1",
  conversationId: "conv1",
  subject: "Re: Pricing",
  bodyPreview: "Thanks for the numbers",
  body: { contentType: "html", content: "<p>Thanks for the <b>numbers</b></p>" },
  from: { emailAddress: { address: "Bob@Globex.io", name: "Bob" } },
  toRecipients: [{ emailAddress: { address: "me@contoso.com", name: "me@contoso.com" } }],
  ccRecipients: [],
  receivedDateTime: "2024-06-14T08:00:00Z",
  internetMessageId: "<x@outlook.com>",
  webLink: "https://outlook.office365.com/owa/?ItemID=AAMk1",
};

type Call = { url: string; init?: Parameters<FetchLike>[1] };
function fakeFetch(routes: (url: string, init?: Parameters<FetchLike>[1]) => unknown, calls: Call[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    const out = routes(url, init);
    const status = out === undefined ? 202 : typeof out === "object" && out && "__status" in out ? (out as { __status: number }).__status : 200;
    return { ok: status < 400, status, json: async () => out, text: async () => (out === undefined ? "" : JSON.stringify(out)) };
  };
}

describe("microsoft oauth", () => {
  it("builds PKCE + authorize URL", async () => {
    const pkce = await createPkcePair(() => new Uint8Array(32));
    expect(pkce.verifier).toBe("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const url = new URL(buildMicrosoftAuthorizeUrl({ clientId: "cid", redirectUri: "https://crm.example.com/admin/", state: "acrm_s", codeChallenge: pkce.challenge }));
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_mode")).toBe("query");
    expect(url.searchParams.get("scope")).toContain("Mail.Send");
    expect(buildMicrosoftAuthorizeUrl({ clientId: "c", tenant: "contoso.onmicrosoft.com", redirectUri: "x", state: "s", codeChallenge: "c" })).toContain("/contoso.onmicrosoft.com/oauth2");
  });

  it("exchanges and refreshes tokens", async () => {
    const calls: Call[] = [];
    const fetchImpl = fakeFetch(() => ({ access_token: "at", expires_in: 3600, refresh_token: "rt", scope: "Mail.Read" }), calls);
    const tokens = await exchangeMicrosoftCode({ clientId: "cid", redirectUri: "https://a/b", code: "code1", codeVerifier: "ver", now: 1000 }, fetchImpl);
    expect(tokens).toEqual({ accessToken: "at", expiresAt: 1000 + 3600_000, refreshToken: "rt", scope: "Mail.Read" });
    const body = new URLSearchParams(calls[0].init!.body!);
    expect(calls[0].url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("ver");
    expect(body.get("client_secret")).toBeNull();
    await refreshMicrosoftToken({ clientId: "cid", refreshToken: "rt", now: 0 }, fetchImpl);
    expect(new URLSearchParams(calls[1].init!.body!).get("grant_type")).toBe("refresh_token");
  });
});

describe("graph mail", () => {
  it("maps a message", () => {
    expect(mapGraphMessage(graphFixture)).toEqual({
      id: "AAMk1",
      threadId: "conv1",
      provider: "microsoft",
      from: { email: "bob@globex.io", name: "Bob" },
      to: [{ email: "me@contoso.com" }],
      cc: [],
      subject: "Re: Pricing",
      snippet: "Thanks for the numbers",
      date: Date.UTC(2024, 5, 14, 8),
      body: "Thanks for the numbers",
      internetMessageId: "<x@outlook.com>",
      url: "https://outlook.office365.com/owa/?ItemID=AAMk1",
    });
  });

  it("searches, sends (sendMail + draft flow)", async () => {
    expect(buildGraphSearch({ emails: ["a@x.io"], domains: ["acme.com"] })).toBe("participants:a@x.io OR participants:acme.com");
    const calls: Call[] = [];
    const fetchImpl = fakeFetch((url, init) => {
      if (url.includes("/me/messages?")) return { value: [graphFixture, { ...graphFixture, id: "draft", isDraft: true }] };
      if (url.endsWith("/me/messages") && init?.method === "POST") return { id: "newid", conversationId: "c2" };
      return undefined;
    }, calls);
    const list = await graphSearchMessages("tok", { emails: ["bob@globex.io"] }, fetchImpl);
    expect(list.map((m) => m.id)).toEqual(["AAMk1"]);
    expect(new URL(calls[0].url).searchParams.get("$search")).toBe('"participants:bob@globex.io"');

    const body = buildGraphSendMailBody({ to: ["Ada <ada@x.io>"], cc: ["c@x.io"], subject: "Hi", body: "Hello" });
    expect(body).toEqual({
      message: { subject: "Hi", body: { contentType: "Text", content: "Hello" }, toRecipients: [{ emailAddress: { address: "ada@x.io", name: "Ada" } }], ccRecipients: [{ emailAddress: { address: "c@x.io" } }] },
      saveToSentItems: true,
    });
    await graphSendMail("tok", { to: ["ada@x.io"], subject: "Hi", body: "Hello" }, fetchImpl);
    expect(calls[1].url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    const sent = await graphSendViaDraft("tok", { to: ["ada@x.io"], subject: "Hi", body: "Hello" }, fetchImpl);
    expect(sent).toEqual({ id: "newid", threadId: "c2" });
    expect(calls[3].url).toBe("https://graph.microsoft.com/v1.0/me/messages/newid/send");
  });
});

describe("graph calendar", () => {
  it("maps and lists calendarView with nextLink paging", async () => {
    const ev = mapGraphEvent({
      id: "e1",
      subject: "QBR",
      start: { dateTime: "2024-06-20T09:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2024-06-20T10:30:00.0000000", timeZone: "UTC" },
      location: { displayName: "Room 1" },
      attendees: [{ emailAddress: { address: "Bob@globex.io", name: "Bob" }, status: { response: "accepted" }, type: "required" }],
      organizer: { emailAddress: { address: "me@contoso.com" } },
      onlineMeeting: { joinUrl: "https://teams/x" },
    });
    expect(ev).toMatchObject({ id: "e1", provider: "microsoft", title: "QBR", start: Date.UTC(2024, 5, 20, 9), end: Date.UTC(2024, 5, 20, 10, 30), location: "Room 1", url: "https://teams/x", organizer: "me@contoso.com" });
    expect(ev.attendees).toEqual([{ email: "bob@globex.io", name: "Bob", response: "accepted" }]);

    const calls: Call[] = [];
    const fetchImpl = fakeFetch((url) =>
      url === "next" ? { value: [{ id: "e2", start: { dateTime: "2024-06-21T09:00:00", timeZone: "UTC" } }] } : { value: [{ id: "e1", start: { dateTime: "2024-06-20T09:00:00", timeZone: "UTC" } }], "@odata.nextLink": "next" },
    calls);
    const events = await graphCalendarView("tok", { start: Date.UTC(2024, 5, 1), end: Date.UTC(2024, 6, 1) }, fetchImpl);
    expect(events.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(calls[0].url).toContain("/me/calendarView?startDateTime=2024-06-01T00%3A00%3A00.000Z");
    expect(calls[0].init?.headers?.Prefer).toContain('outlook.timezone="UTC"');
  });
});
