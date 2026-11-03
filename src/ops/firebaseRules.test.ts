import { describe, expect, it } from "vitest";
import { COLLECTIONS } from "../data/types";
import { buildFirestoreIndexes, buildFirestoreRules, buildInboxSubmission, INBOX_LIMITS, normalizeRulesOptions, parseInboxSubmission, RULED_COLLECTIONS } from "./firebaseRules";

function block(rules: string, match: string): string {
  const start = rules.indexOf(`match ${match} {`);
  expect(start, `no block for ${match}`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = rules.indexOf("{", start + `match ${match}`.length); i < rules.length; i++) {
    if (rules[i] === "{") depth++;
    if (rules[i] === "}" && --depth === 0) return rules.slice(start, i + 1);
  }
  throw new Error("unbalanced");
}

describe("firestore rules generator", () => {
  const rules = buildFirestoreRules({ adminEmail: " Boss@Acme.IO " });

  it("pins the bootstrap admin email (lower-cased) and requires a verified address", () => {
    expect(rules).toContain('return "boss@acme.io";');
    expect(rules).toContain("request.auth.token.email_verified == true");
    expect(rules.startsWith("rules_version = '2';")).toBe(true);
  });

  it("is balanced and covers every CRM collection + invites + inbox, closed by default", () => {
    expect(rules.split("{").length).toBe(rules.split("}").length);
    for (const c of COLLECTIONS) expect(RULED_COLLECTIONS).toContain(c);
    for (const c of [...COLLECTIONS, "invites", "inbox"]) block(rules, `/${c}/{${c === "users" ? "uid" : c === "invites" ? "email" : "id"}}`);
    expect(block(rules, "/{document=**}")).toContain("allow read, write: if false;");
  });

  it("viewers read only; members write records/activities; admins write config", () => {
    expect(block(rules, "/records/{id}")).toContain("allow create, update, delete: if isMember();");
    expect(block(rules, "/activities/{id}")).toContain("allow read: if isActive();");
    for (const c of ["objects", "pipelines", "settings", "config", "forms"]) expect(block(rules, `/${c}/{id}`)).toContain("allow write: if isAdmin();");
    expect(rules).toContain("role() in ['admin', 'member', 'viewer']");
  });

  it("users can't escalate: self updates limited to profile keys", () => {
    const users = block(rules, "/users/{uid}");
    expect(users).toContain("affectedKeys().hasOnly(['name', 'avatarUrl', 'updatedAt'])");
    expect(users).toContain("allow delete: if isAdmin();");
    expect(rules).toContain("(isBootstrapAdmin() && d.role == 'admin')");
  });

  it("members only touch their own private views", () => {
    const views = block(rules, "/views/{id}");
    expect(views).toContain("request.resource.data.get('ownerId', '') == request.auth.uid");
    expect(views).toContain("request.resource.data.get('shared', false) == false");
  });

  it("inbox: public create with shape + size validation, no public read", () => {
    const inbox = block(rules, "/inbox/{id}");
    expect(inbox).toContain("allow create: if validSubmission(request.resource.data);");
    expect(inbox).toContain("allow read, delete: if isMember();");
    expect(rules).toContain(`d.data is map && d.data.size() <= ${INBOX_LIMITS.maxFields}`);
    expect(rules).toContain("d.keys().hasOnly(['formId', 'data', 'createdAt', 'meta'])");
    expect(rules).toContain("d.createdAt is int");
    expect(inbox).toContain("affectedKeys().hasOnly(['status', 'error'])");
    expect(rules).toContain("exists(/databases/$(database)/documents/forms/$(d.formId))");
  });

  it("sign-up modes", () => {
    expect(rules).toMatch(/function signupAllowed\(\) \{\n\s+return false;/);
    expect(buildFirestoreRules({ adminEmail: "a@b.io", signup: "open" })).toMatch(/function signupAllowed\(\) \{\n\s+return true;/);
    const domain = buildFirestoreRules({ adminEmail: "a@b.io", allowedDomains: ["acme.io", "@Foo.com"] });
    expect(domain).toContain("callerEmail().matches('^[^@]+@(acme[.]io|foo[.]com)$')");
    expect(buildFirestoreRules({ adminEmail: "a@b.io", requireVerifiedEmail: false })).not.toContain("email_verified");
  });

  it("rejects values that would break out of the rules source", () => {
    expect(() => buildFirestoreRules({ adminEmail: 'x"; allow write: if true; //@a.io' })).toThrow();
    expect(() => normalizeRulesOptions({ adminEmail: "a@b.io", allowedDomains: ["a.io')||true||('"] })).toThrow();
    expect(() => normalizeRulesOptions({ adminEmail: "a@b.io", signup: "domain" })).toThrow();
  });

  it("indexes file + inbox submission helpers", () => {
    expect(JSON.parse(buildFirestoreIndexes())).toEqual({ indexes: [], fieldOverrides: [] });
    const sub = buildInboxSubmission("contact-us", { email: "a@b.io" }, { now: 5, meta: { page: "https://x.io/" } });
    expect(sub).toEqual({ formId: "contact-us", data: { email: "a@b.io" }, createdAt: 5, meta: { page: "https://x.io/" } });
    expect(parseInboxSubmission(sub as unknown as Record<string, unknown>)).toEqual(sub);
    expect(() => buildInboxSubmission("bad id!", {})).toThrow();
    expect(() => buildInboxSubmission("f", Object.fromEntries(Array.from({ length: INBOX_LIMITS.maxFields + 1 }, (_, i) => [`f${i}`, 1])))).toThrow();
  });
});
