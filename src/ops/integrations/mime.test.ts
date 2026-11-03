import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode, buildGmailRaw, buildRfc2822, decodeHeaderValue, encodeHeaderValue, htmlToText, parseAddress, parseAddressList } from "./mime";

describe("mime helpers", () => {
  it("parses addresses and lists", () => {
    expect(parseAddress("Ada Lovelace <Ada@Example.com>")).toEqual({ email: "ada@example.com", name: "Ada Lovelace" });
    expect(parseAddress('"Turing, Alan" <alan@x.io>')).toEqual({ email: "alan@x.io", name: "Turing, Alan" });
    expect(parseAddress("bob@x.io")).toEqual({ email: "bob@x.io" });
    expect(parseAddress("not an address")).toBeNull();
    expect(parseAddressList('"Turing, Alan" <alan@x.io>, bob@x.io; Eve <eve@y.com>').map((a) => a.email)).toEqual(["alan@x.io", "bob@x.io", "eve@y.com"]);
    expect(parseAddressList(undefined)).toEqual([]);
  });

  it("encodes / decodes UTF-8 headers and base64url", () => {
    expect(encodeHeaderValue("Hello")).toBe("Hello");
    const enc = encodeHeaderValue("Réunion — café ☕");
    expect(enc).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodeHeaderValue(enc)).toBe("Réunion — café ☕");
    expect(decodeHeaderValue("=?utf-8?Q?Caf=C3=A9_cr=C3=A8me?=")).toBe("Café crème");
    const long = "Ééé ".repeat(30).trim();
    expect(decodeHeaderValue(encodeHeaderValue(long))).toBe(long);
    expect(base64UrlEncode("??>>")).not.toMatch(/[+/=]/);
    expect(base64UrlDecode(base64UrlEncode("héllo ✓ ??>>"))).toBe("héllo ✓ ??>>");
  });

  it("builds an RFC 2822 message", () => {
    const raw = buildRfc2822(
      { from: { email: "me@acme.com", name: "Me" }, to: ["Ada <ada@x.io>"], cc: ["bob@x.io"], subject: "Proposition été", body: "Bonjour,\nVoici.\n" },
      { date: new Date(Date.UTC(2024, 5, 15, 10, 0, 0)), messageId: "<m1@acme.com>" },
    );
    const [head, body] = raw.split("\r\n\r\n");
    const lines = head.split("\r\n");
    expect(lines).toContain('From: "Me" <me@acme.com>');
    expect(lines).toContain('To: "Ada" <ada@x.io>');
    expect(lines).toContain("Cc: bob@x.io");
    expect(lines).toContain("Date: Sat, 15 Jun 2024 10:00:00 +0000");
    expect(lines).toContain("Message-ID: <m1@acme.com>");
    expect(lines).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(decodeHeaderValue(lines.find((l) => l.startsWith("Subject: "))!.slice(9))).toBe("Proposition été");
    expect(new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\r\n/g, "")), (c) => c.charCodeAt(0)))).toBe("Bonjour,\r\nVoici.\r\n");
    expect(base64UrlDecode(buildGmailRaw({ to: ["a@b.co"], subject: "x", body: "y" }))).toContain("To: a@b.co");
    expect(() => buildRfc2822({ to: [], subject: "x", body: "" })).toThrow();
  });

  it("converts html to text", () => {
    expect(htmlToText("<p>Hi&nbsp;<b>Ada</b></p><p>Bye &amp; thanks</p><style>p{}</style>")).toBe("Hi Ada\nBye & thanks");
  });
});
