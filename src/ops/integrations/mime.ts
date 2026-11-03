// MIME helpers: address parsing, UTF-8 base64 / base64url, RFC 2047
// encoded words, and the RFC 2822 message builder Gmail's
// users.messages.send expects (base64url of the raw message).

import type { EmailAddress } from "./types";

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64Encode(text: string): string {
  return bytesToBase64(utf8.encode(text));
}

export function base64UrlEncode(input: string | Uint8Array): string {
  const b64 = typeof input === "string" ? base64Encode(input) : bytesToBase64(input);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(data: string): string {
  let b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return utf8Decoder.decode(bytes);
}

// RFC 2047 "encoded word" for non-ASCII header values (subject, names).
export function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  // Split into chunks so each encoded word stays under 75 chars.
  const words: string[] = [];
  let chunk = "";
  for (const ch of value) {
    if (utf8.encode(chunk + ch).length > 42) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${base64Encode(w)}?=`).join("\r\n ");
}

// Decodes RFC 2047 encoded words (B and Q) found in header values.
export function decodeHeaderValue(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, _charset: string, enc: string, text: string) => {
      try {
        if (enc.toUpperCase() === "B") return base64UrlDecode(text.replace(/\+/g, "-").replace(/\//g, "_"));
        const bytes: number[] = [];
        const s = text.replace(/_/g, " ");
        for (let i = 0; i < s.length; i++) {
          if (s[i] === "=" && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) {
            bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
            i += 2;
          } else bytes.push(s.charCodeAt(i));
        }
        return utf8Decoder.decode(new Uint8Array(bytes));
      } catch {
        return text;
      }
    });
}

// "Ada Lovelace <Ada@Example.com>" → { email: "ada@example.com", name: "Ada Lovelace" }
export function parseAddress(raw: string): EmailAddress | null {
  const s = decodeHeaderValue(raw).trim();
  if (!s) return null;
  const m = /^(.*?)\s*<([^<>]+)>\s*$/.exec(s);
  if (m) {
    const email = m[2].trim().toLowerCase();
    if (!email.includes("@")) return null;
    const name = m[1].trim().replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"').trim();
    return name && name.toLowerCase() !== email ? { email, name } : { email };
  }
  const email = s.replace(/^"|"$/g, "").toLowerCase();
  return email.includes("@") ? { email } : null;
}

// Splits an address list on commas outside quotes / angle brackets.
export function parseAddressList(raw: string | undefined | null): EmailAddress[] {
  if (!raw) return [];
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = false;
  for (const ch of raw) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "<" && !quoted) angle = true;
    else if (ch === ">" && !quoted) angle = false;
    if ((ch === "," || ch === ";") && !quoted && !angle) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map(parseAddress).filter((a): a is EmailAddress => !!a);
}

export function formatAddress(a: EmailAddress | string): string {
  const addr = typeof a === "string" ? { email: a } : a;
  if (!addr.name) return addr.email;
  // eslint-disable-next-line no-control-regex
  const name = /^[\x20-\x7e]*$/.test(addr.name) ? `"${addr.name.replace(/(["\\])/g, "\\$1")}"` : encodeHeaderValue(addr.name);
  return `${name} <${addr.email}>`;
}

export interface OutgoingEmail {
  from?: EmailAddress | string;
  to: (EmailAddress | string)[];
  cc?: (EmailAddress | string)[];
  bcc?: (EmailAddress | string)[];
  subject: string;
  // Plain-text body.
  body: string;
  // Reply threading.
  inReplyTo?: string;
  references?: string;
}

export function emailList(list: (EmailAddress | string)[] | undefined): EmailAddress[] {
  return (list ?? [])
    .map((a) => (typeof a === "string" ? parseAddress(a) : a ? { ...a, email: a.email.trim().toLowerCase() } : null))
    .filter((a): a is EmailAddress => !!a && a.email.includes("@"));
}

// Builds an RFC 2822 message (CRLF line endings, UTF-8 text/plain body in
// base64 so any character survives). `date` / `messageId` are injectable
// for deterministic tests.
export function buildRfc2822(email: OutgoingEmail, opts: { date?: Date; messageId?: string } = {}): string {
  const to = emailList(email.to);
  if (!to.length) throw new Error("An email needs at least one recipient.");
  const headers: string[] = [];
  if (email.from) headers.push(`From: ${formatAddress(email.from)}`);
  headers.push(`To: ${to.map(formatAddress).join(", ")}`);
  const cc = emailList(email.cc);
  if (cc.length) headers.push(`Cc: ${cc.map(formatAddress).join(", ")}`);
  const bcc = emailList(email.bcc);
  if (bcc.length) headers.push(`Bcc: ${bcc.map(formatAddress).join(", ")}`);
  headers.push(`Subject: ${encodeHeaderValue(email.subject.replace(/[\r\n]+/g, " "))}`);
  if (opts.date) headers.push(`Date: ${opts.date.toUTCString().replace("GMT", "+0000")}`);
  if (opts.messageId) headers.push(`Message-ID: ${opts.messageId}`);
  if (email.inReplyTo) headers.push(`In-Reply-To: ${email.inReplyTo}`);
  if (email.references) headers.push(`References: ${email.references}`);
  headers.push("MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64");
  const body = base64Encode(email.body.replace(/\r?\n/g, "\r\n")).replace(/.{1,76}/g, "$&\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

// What Gmail's users.messages.send takes as `raw`.
export function buildGmailRaw(email: OutgoingEmail, opts: { date?: Date; messageId?: string } = {}): string {
  return base64UrlEncode(buildRfc2822(email, opts));
}

// Strips HTML to readable text (Graph bodies are often HTML).
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
