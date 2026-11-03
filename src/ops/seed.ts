// Install-time seeding: standard objects, the Sales pipeline, default
// views, settings and the first admin user — plus an optional
// deterministic demo dataset (~30 companies, 80 people, 40 deals, ~150
// activities). Idempotent: only what's missing is written.

import { normalizeEmail } from "../core/fields";
import { seededId } from "../core/ids";
import { defaultPipeline, defaultViews, standardObjects } from "../core/schema/standardObjects";
import type { Activity, ActivityType, CrmRecord, CrmSettings, CrmUser } from "../core/types";
import type { DocMutation } from "../data/types";
import { assertCan, type OpsContext } from "./context";
import { DEFAULT_SETTINGS } from "./settings";
import { asDoc, objectOf, settingsDoc, usersOf } from "./store";

export interface SeedOptions {
  name?: string;
  currency?: string;
  locale?: string;
  admin?: { id?: string; name: string; email: string };
  demo?: boolean;
}

export interface SeedReport {
  objects: string[];
  pipelines: string[];
  views: string[];
  adminUserId: string | null;
  demo: { companies: number; people: number; deals: number; activities: number; users: number } | null;
}

export const DEFAULT_ADMIN_ID = "owner";

export async function seedCrm(ctx: OpsContext, opts: SeedOptions = {}): Promise<SeedReport> {
  assertCan(ctx, "schema.write");
  const now = ctx.now();
  const mutations: DocMutation[] = [];
  const report: SeedReport = { objects: [], pipelines: [], views: [], adminUserId: null, demo: null };
  const currency = (opts.currency ?? DEFAULT_SETTINGS.defaultCurrency).toUpperCase();

  for (const o of standardObjects(now)) {
    if (objectOf(ctx.store, o.id)) continue;
    const obj = {
      ...o,
      fields: o.fields.map((f) => (f.type === "currency" ? { ...f, currency } : f)),
    };
    mutations.push({ op: "set", collection: "objects", doc: asDoc(obj) });
    report.objects.push(o.id);
  }
  const pipeline = defaultPipeline();
  if (!ctx.store.get("pipelines", pipeline.id)) {
    mutations.push({ op: "set", collection: "pipelines", doc: asDoc(pipeline) });
    report.pipelines.push(pipeline.id);
  }
  for (const v of defaultViews()) {
    if (ctx.store.get("views", v.id)) continue;
    mutations.push({ op: "set", collection: "views", doc: asDoc(v) });
    report.views.push(v.id);
  }

  let adminId: string | null = null;
  if (opts.admin) {
    const email = normalizeEmail(opts.admin.email);
    const existing = usersOf(ctx.store).find((u) => normalizeEmail(u.email) === email);
    adminId = existing?.id ?? opts.admin.id ?? (usersOf(ctx.store).length === 0 ? DEFAULT_ADMIN_ID : seededId(`user:${email}`));
    if (!existing) {
      const admin: CrmUser = { id: adminId, email, name: opts.admin.name.trim() || email.split("@")[0], role: "admin" };
      mutations.push({ op: "set", collection: "users", doc: asDoc(admin) });
    }
  }
  report.adminUserId = adminId;

  const current = settingsDoc(ctx.store);
  if (!current) {
    const settings: CrmSettings = {
      ...DEFAULT_SETTINGS,
      name: opts.name?.trim() || DEFAULT_SETTINGS.name,
      defaultCurrency: currency,
      locale: opts.locale ?? DEFAULT_SETTINGS.locale,
      ...(adminId ? { ownerUserId: adminId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    mutations.push({ op: "set", collection: "settings", doc: asDoc(settings) });
  } else if (adminId && !current.ownerUserId) {
    mutations.push({ op: "patch", collection: "settings", id: "general", fields: { ownerUserId: adminId, updatedAt: now } });
  }

  if (mutations.length) await ctx.store.write(mutations, { message: "Install AgentCRM" });

  if (opts.demo) report.demo = await seedDemoData(ctx, { ownerId: adminId ?? undefined, currency });
  return report;
}

// ─── Demo dataset ───────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMPANIES: [string, string, string, number][] = [
  ["Acme Robotics", "acmerobotics.com", "manufacturing", 420],
  ["Globex", "globex.io", "software", 1200],
  ["Initech", "initech.com", "software", 230],
  ["Umbrella Health", "umbrellahealth.com", "healthcare", 3100],
  ["Stark Logistics", "starklogistics.com", "other", 850],
  ["Wayne Capital", "waynecapital.com", "finance", 640],
  ["Hooli", "hooli.xyz", "software", 5400],
  ["Pied Piper", "piedpiper.com", "software", 45],
  ["Vandelay Imports", "vandelay.com", "retail", 75],
  ["Soylent Foods", "soylent.co", "retail", 310],
  ["Cyberdyne Systems", "cyberdyne.ai", "software", 980],
  ["Tyrell Corp", "tyrell.com", "manufacturing", 2200],
  ["Massive Dynamic", "massivedynamic.com", "consulting", 1600],
  ["Wonka Industries", "wonka.com", "manufacturing", 520],
  ["Aperture Labs", "aperture.io", "education", 190],
  ["Oscorp", "oscorp.com", "healthcare", 1450],
  ["Nakatomi Trading", "nakatomi.co.jp", "finance", 760],
  ["Gringotts Bank", "gringotts.bank", "finance", 300],
  ["Dunder Mifflin", "dundermifflin.com", "retail", 120],
  ["Prestige Worldwide", "prestigeworldwide.com", "media", 12],
  ["Bluth Company", "bluth.com", "real-estate", 85],
  ["Sterling Cooper", "sterlingcooper.com", "media", 260],
  ["Monarch Solutions", "monarch.solutions", "consulting", 58],
  ["Northwind Traders", "northwind.com", "retail", 410],
  ["Contoso", "contoso.com", "software", 3600],
  ["Fabrikam", "fabrikam.com", "manufacturing", 900],
  ["Lumon Industries", "lumon.com", "other", 1300],
  ["Rekall", "rekall.com", "healthcare", 95],
  ["Blue Sun", "bluesun.com", "media", 700],
  ["Octan Energy", "octan.energy", "other", 2600],
];

const FIRST = ["Ada", "Alan", "Grace", "Linus", "Margaret", "Dennis", "Barbara", "Ken", "Frances", "Tim", "Radia", "Vint", "Hedy", "John", "Katherine", "Guido", "Sophie", "Lucas", "Emma", "Hugo", "Léa", "Nathan", "Chloé", "Louis", "Camille", "Jules", "Inès", "Arthur", "Zoé", "Paul", "Mia", "Noah", "Olivia", "Liam", "Ava", "Ethan", "Isabella", "Mason", "Amelia", "Logan"];
const LAST = ["Lovelace", "Turing", "Hopper", "Torvalds", "Hamilton", "Ritchie", "Liskov", "Thompson", "Allen", "Berners-Lee", "Perlman", "Cerf", "Lamarr", "McCarthy", "Johnson", "van Rossum", "Martin", "Bernard", "Dubois", "Durand", "Lefebvre", "Moreau", "Laurent", "Simon", "Michel", "Garcia", "Roux", "Fournier", "Girard", "Bonnet", "Smith", "Brown", "Wilson", "Taylor", "Clark", "Lewis", "Walker", "Young", "King", "Wright"];
const TITLES = ["CEO", "CTO", "VP Sales", "Head of Marketing", "Procurement Manager", "Operations Director", "Product Manager", "Engineering Manager", "CFO", "Office Manager", "Account Executive", "Data Analyst"];
const CITIES = ["Paris", "London", "New York", "Berlin", "Lyon", "Madrid", "Amsterdam", "Montréal", "San Francisco", "Lisbon", "Brussels", "Toronto"];
const DEAL_KINDS = ["Annual license", "Pilot", "Expansion", "Renewal", "Onboarding package", "Enterprise plan", "Support contract", "Consulting retainer"];
const LIFECYCLE = ["subscriber", "lead", "lead", "mql", "sql", "opportunity", "customer", "customer", "evangelist"];
const SOURCES = ["website", "referral", "event", "outbound", "partner", "ads", "social"];
const STAGES: [string, number][] = [
  ["new", 8],
  ["qualified", 9],
  ["proposal", 7],
  ["negotiation", 5],
  ["won", 7],
  ["lost", 4],
];
const LOST_REASONS = ["Budget", "Went with a competitor", "No decision", "Timing"];

const DAY = 86_400_000;

export interface DemoReport {
  companies: number;
  people: number;
  deals: number;
  activities: number;
  users: number;
}

// Deterministic for a given `now` (ctx.now()).
export async function seedDemoData(ctx: OpsContext, opts: { ownerId?: string; currency?: string } = {}): Promise<DemoReport> {
  assertCan(ctx, "records.write");
  const rand = mulberry32(42);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const now = ctx.now();
  const today = new Date(now);
  const isoDay = (offsetDays: number) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const mutations: DocMutation[] = [];
  const firstCompanyId = seededId("demo:company:0");
  if (ctx.store.get("records", firstCompanyId)) return { companies: 0, people: 0, deals: 0, activities: 0, users: 0 };

  // A couple of teammates so ownership / assignment look real.
  const teammates: CrmUser[] = ([
    { id: seededId("demo:user:sam"), email: "sam@example.com", name: "Sam Rivera", role: "member" },
    { id: seededId("demo:user:alex"), email: "alex@example.com", name: "Alex Chen", role: "member" },
  ] satisfies CrmUser[]).filter((u) => !usersOf(ctx.store).some((x) => normalizeEmail(x.email) === u.email));
  for (const u of teammates) mutations.push({ op: "set", collection: "users", doc: asDoc(u) });
  const owners = [opts.ownerId, ...teammates.map((u) => u.id), ...usersOf(ctx.store).map((u) => u.id)].filter((x): x is string => !!x);
  const ownerAt = (i: number) => (owners.length ? owners[i % owners.length] : undefined);

  const stamp = (daysAgo: number) => now - Math.round(daysAgo * DAY);
  const rec = (id: string, object: string, fields: Record<string, unknown>, i: number, daysAgo: number): CrmRecord => ({
    id,
    object,
    fields,
    ...(ownerAt(i) ? { ownerId: ownerAt(i) } : {}),
    createdAt: stamp(daysAgo),
    updatedAt: stamp(Math.max(0, daysAgo - rand() * daysAgo)),
    ...(opts.ownerId ? { createdBy: opts.ownerId } : {}),
  });

  const companies: CrmRecord[] = COMPANIES.map(([name, domain, industry, employees], i) =>
    rec(seededId(`demo:company:${i}`), "companies", {
      name,
      domain: `https://${domain}`,
      industry,
      employees,
      annualRevenue: Math.round(employees * (60_000 + rand() * 140_000) / 1000) * 1000,
      address: { city: pick(CITIES), country: pick(["France", "United Kingdom", "United States", "Germany", "Canada", "Spain"]) },
      linkedin: `https://www.linkedin.com/company/${domain.split(".")[0]}`,
      phone: `+33 1 ${String(10 + i).padStart(2, "0")} ${String(Math.floor(rand() * 90) + 10)} ${String(Math.floor(rand() * 90) + 10)} ${String(Math.floor(rand() * 90) + 10)}`,
      ...(rand() < 0.3 ? { tags: [pick(["vip", "partner", "strategic", "smb", "enterprise"])] } : {}),
    }, i, 30 + rand() * 300),
  );

  const people: CrmRecord[] = [];
  for (let i = 0; i < 80; i++) {
    const firstName = FIRST[i % FIRST.length];
    const lastName = LAST[(i * 7 + Math.floor(i / FIRST.length)) % LAST.length];
    const company = companies[i % companies.length];
    const domain = String(company.fields.domain).replace(/^https:\/\//, "");
    const slug = `${firstName}.${lastName}`.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z.]/g, "");
    people.push(
      rec(seededId(`demo:person:${i}`), "people", {
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        email: `${slug}@${domain}`,
        phone: `+1 555 ${String(100 + i).padStart(3, "0")} ${String(1000 + Math.floor(rand() * 8999))}`,
        jobTitle: pick(TITLES),
        company: company.id,
        city: pick(CITIES),
        lifecycleStage: pick(LIFECYCLE),
        leadSource: pick(SOURCES),
        ...(rand() < 0.2 ? { tags: [pick(["decision-maker", "champion", "newsletter", "event-2024"])] } : {}),
      }, i, 10 + rand() * 240),
    );
  }

  const deals: CrmRecord[] = [];
  let d = 0;
  for (const [stage, count] of STAGES) {
    for (let k = 0; k < count; k++, d++) {
      const company = companies[(d * 3) % companies.length];
      const contacts = people.filter((p) => p.fields.company === company.id).slice(0, 1 + (d % 2));
      const prob = { new: 10, qualified: 25, proposal: 50, negotiation: 75, won: 100, lost: 0 }[stage]!;
      const closeOffset = stage === "won" || stage === "lost" ? -Math.round(5 + rand() * 170) : Math.round(5 + rand() * 120);
      deals.push(
        rec(seededId(`demo:deal:${d}`), "deals", {
          name: `${company.fields.name} — ${pick(DEAL_KINDS)}`,
          amount: Math.round((2 + rand() * 98) * 1000),
          stage,
          pipeline: "sales",
          closeDate: isoDay(closeOffset),
          probability: prob,
          company: company.id,
          ...(contacts.length ? { contacts: contacts.map((c) => c.id) } : {}),
          ...(stage === "lost" ? { lostReason: pick(LOST_REASONS) } : {}),
        }, d, 5 + rand() * 150),
      );
    }
  }

  const activities: Activity[] = [];
  const titles: Record<ActivityType, string[]> = {
    note: ["Discovery notes", "Pricing feedback", "Org chart", "Next steps", "Competitor mentioned"],
    call: ["Intro call", "Follow-up call", "Pricing call", "Check-in"],
    email: ["Sent proposal", "Follow-up email", "Shared case study", "Contract sent"],
    meeting: ["Demo", "Kick-off meeting", "Quarterly business review", "On-site visit"],
    task: ["Send proposal", "Schedule demo", "Follow up on contract", "Prepare QBR deck", "Call back", "Update pricing"],
  };
  const types: ActivityType[] = ["note", "call", "email", "meeting", "task"];
  for (let i = 0; i < 150; i++) {
    const type = types[i % types.length];
    const deal = deals[i % deals.length];
    const company = companies.find((c) => c.id === deal.fields.company)!;
    const contactId = (deal.fields.contacts as string[] | undefined)?.[0];
    const targets = [
      { object: "deals", id: deal.id },
      { object: "companies", id: company.id },
      ...(contactId ? [{ object: "people", id: contactId }] : []),
    ];
    const daysAgo = rand() * 90;
    const createdAt = stamp(daysAgo);
    const a: Activity = {
      id: seededId(`demo:activity:${i}`),
      type,
      title: pick(titles[type]),
      ...(type === "note" || rand() < 0.4 ? { body: `${pick(["Talked with", "Met", "Emailed"])} the team at ${company.fields.name}. ${pick(["Interested in the annual plan.", "Needs approval from finance.", "Asked for a security review.", "Comparing with two vendors.", "Wants to start next quarter."])}` } : {}),
      targets,
      createdAt,
      updatedAt: createdAt,
      ...(opts.ownerId ? { createdBy: ownerAt(i) ?? opts.ownerId } : {}),
    };
    if (type === "task") {
      const due = Math.round(-10 + rand() * 30);
      a.dueAt = new Date(today.getFullYear(), today.getMonth(), today.getDate() + due, 9 + (i % 8)).getTime();
      if (due < -3 && rand() < 0.7) a.doneAt = a.dueAt + DAY / 2;
      if (ownerAt(i)) a.assigneeId = ownerAt(i);
    }
    if (type === "call") a.meta = { durationMin: 5 + Math.floor(rand() * 40) };
    if (type === "meeting") a.meta = { startAt: createdAt, endAt: createdAt + 3_600_000 };
    activities.push(a);
  }

  for (const r of [...companies, ...people, ...deals]) mutations.push({ op: "set", collection: "records", doc: asDoc(r) });
  for (const a of activities) mutations.push({ op: "set", collection: "activities", doc: asDoc(a) });
  await ctx.store.write(mutations, { message: "Add demo data" });
  return { companies: companies.length, people: people.length, deals: deals.length, activities: activities.length, users: teammates.length };
}
