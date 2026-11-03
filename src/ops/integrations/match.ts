// Matches email addresses to CRM contacts: people by any email field
// (normalized), companies by their domain field — free-mail domains
// (gmail.com, outlook.com…) never match a company.

import { normalizeDomain, normalizeEmail } from "../../core/fields";
import type { CrmRecord } from "../../core/types";
import { assertCan, type OpsContext } from "../context";
import { objectOf, recordsOf } from "../store";

export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.fr", "hotmail.com", "hotmail.fr", "hotmail.co.uk", "live.com", "live.fr",
  "msn.com", "yahoo.com", "yahoo.fr", "yahoo.co.uk", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me",
  "protonmail.com", "pm.me", "gmx.com", "gmx.de", "gmx.fr", "web.de", "mail.com", "zoho.com", "yandex.com", "yandex.ru",
  "orange.fr", "wanadoo.fr", "free.fr", "laposte.net", "sfr.fr", "neuf.fr", "bbox.fr", "fastmail.com", "hey.com", "qq.com", "163.com",
]);

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(normalizeDomain(domain));
}

export function emailDomain(email: string): string {
  const e = normalizeEmail(email);
  const at = e.lastIndexOf("@");
  return at >= 0 ? normalizeDomain(e.slice(at + 1)) : "";
}

// Email field ids of an object (the standard `email` + custom email fields).
export function emailFieldIds(ctx: OpsContext, objectId: string): string[] {
  const object = objectOf(ctx.store, objectId);
  const ids = object?.fields.filter((f) => f.type === "email").map((f) => f.id) ?? [];
  return ids.length ? ids : ["email"];
}

// All email addresses stored on a record (any email field).
export function recordEmails(ctx: OpsContext, record: CrmRecord): string[] {
  const out = new Set<string>();
  for (const id of emailFieldIds(ctx, record.object)) {
    const v = record.fields[id];
    for (const x of Array.isArray(v) ? v : [v]) {
      const e = normalizeEmail(x);
      if (e.includes("@")) out.add(e);
    }
  }
  return [...out];
}

// Non-free-mail domain of a company record ("" when none).
export function recordDomain(record: CrmRecord): string {
  const d = normalizeDomain(record.fields.domain);
  return d && !isFreeMailDomain(d) ? d : "";
}

export interface ContactMatch {
  people: CrmRecord[];
  companies: CrmRecord[];
  // Per address: matched record ids.
  byEmail: Record<string, { people: string[]; companies: string[] }>;
}

export function matchContacts(ctx: OpsContext, emails: Iterable<string>): ContactMatch {
  assertCan(ctx, "records.read");
  const wanted = new Set<string>();
  for (const e of emails) {
    const n = normalizeEmail(e);
    if (n.includes("@")) wanted.add(n);
  }
  const byEmail: ContactMatch["byEmail"] = {};
  for (const e of wanted) byEmail[e] = { people: [], companies: [] };
  if (!wanted.size) return { people: [], companies: [], byEmail };

  const people = new Map<string, CrmRecord>();
  for (const p of recordsOf(ctx.store, "people")) {
    for (const e of recordEmails(ctx, p)) {
      if (!wanted.has(e)) continue;
      people.set(p.id, p);
      byEmail[e].people.push(p.id);
    }
  }

  const domains = new Map<string, string[]>();
  for (const e of wanted) {
    const d = emailDomain(e);
    if (!d || isFreeMailDomain(d)) continue;
    domains.set(d, [...(domains.get(d) ?? []), e]);
  }
  const companies = new Map<string, CrmRecord>();
  if (domains.size) {
    for (const c of recordsOf(ctx.store, "companies")) {
      const d = recordDomain(c);
      const hits = d ? domains.get(d) : undefined;
      if (!hits) continue;
      companies.set(c.id, c);
      for (const e of hits) byEmail[e].companies.push(c.id);
    }
  }
  return { people: [...people.values()], companies: [...companies.values()], byEmail };
}
