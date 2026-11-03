import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installBrowserEnv } from "./browserEnv";
import { getCredential } from "./credentials";
import { cli, fakeDist, siteCli, writePlan } from "./testing/cli";
import { createFakeS3 } from "./testing/fakeS3";

// The full CLI journey on an in-memory S3: install an encrypted journal
// dataset in a private bucket with the admin on a public one → doctor →
// records CRUD → import csv (dry run, then apply) → reports → AI tools →
// compact (physical purge). Every secret stays off the buckets.

const s3 = createFakeS3({ accessKeyId: "AKID" });
const root = mkdtempSync(join(tmpdir(), "agentcrm-e2e-s3-"));
const ADMIN = s3.websiteUrl("crm-admin");
const checks = (data: { checks: { id: string; status: string }[] }) => Object.fromEntries(data.checks.map((c) => [c.id, c.status]));

const plan = {
  alias: "acme",
  name: "Acme CRM",
  owner: { name: "Ada Lovelace", email: "ada@acme.test" },
  data: { backend: "journal", location: { type: "s3", settings: { endpoint: s3.endpoint, region: "fake-1", bucket: "crm-data" }, credential: "s3:main" }, root: "agentcrm" },
  hosting: { type: "s3", settings: { endpoint: s3.endpoint, region: "fake-1", bucket: "crm-admin", siteUrl: ADMIN }, credential: "s3:main" },
};

beforeAll(async () => {
  installBrowserEnv();
  vi.stubGlobal("fetch", s3.fetch);
  process.env.AGENTCRM_HOME = join(root, "home");
  process.env.AGENTCRM_DIST = fakeDist(root);
  process.env.AGENTCRM_KDF_ITERATIONS = "1000";
  process.env.E2E_AK = "AKID";
  process.env.E2E_SK = "SECRET-KEY-123";
  s3.createBucket("crm-data", { corsOrigins: [ADMIN] });
  s3.createBucket("crm-admin", { public: true });
  expect((await cli(["credentials", "set", "s3:main", "--from-env", "E2E_AK,E2E_SK"])).code).toBe(0);
});

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.AGENTCRM_DIST;
});

describe("journal CRM on S3 (fake S3)", () => {
  it("installs, checks, edits, imports, reports, calls tools and compacts", async () => {
    const file = writePlan(root, "acme", plan);

    // Dry run: checks only, nothing written, no passphrase generated yet.
    const dry = await cli(["install", "--plan", file, "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.body.data).toMatchObject({ dryRun: true, encrypted: true, checks: { data: { ok: true }, hosting: { ok: true } } });
    expect(getCredential("passphrase:acme")).toBeNull();
    expect(s3.keys("crm-data")).toEqual([]);

    const res = await cli(["install", "--plan", file]);
    expect(res.code).toBe(0);
    expect(res.body.data).toMatchObject({ installed: true, credentials: { data: "s3:main", hosting: "s3:main", passphrase: "passphrase:acme" }, adminUrl: `${ADMIN}/admin/` });
    expect(res.body.data.savePassphrase.account).toBe("passphrase:acme");
    const passphrase = getCredential("passphrase:acme")!.values.passphrase;
    expect(passphrase.length).toBeGreaterThan(20);

    // Data: encrypted journal; admin: build + version.json + config.js without secrets.
    expect(s3.keys("crm-data").some((k) => k.startsWith("agentcrm/journal/"))).toBe(true);
    expect(s3.text("crm-data", "agentcrm/keyinfo.json")).toContain('"encrypted": true');
    expect(s3.keys("crm-admin")).toEqual(["admin/assets/index-abc.js", "admin/config.js", "admin/index.html", "admin/version.json"]);
    const configJs = s3.text("crm-admin", "admin/config.js")!;
    expect(configJs).toContain('"backend": "journal"');
    for (const bucket of ["crm-data", "crm-admin"]) {
      for (const key of s3.keys(bucket)) {
        const text = Buffer.from(s3.object(bucket, key)!.body).toString("latin1");
        expect(text).not.toContain("SECRET-KEY-123");
        expect(text).not.toContain(passphrase);
        expect(text).not.toContain("Lovelace"); // personal data is encrypted
      }
    }

    const doctor = await cli(["doctor", "--site", "acme"]);
    expect(doctor.code).toBe(0);
    expect(checks(doctor.body.data)).toMatchObject({ "credential-data": "ok", "credential-passphrase": "ok", "data-access": "ok", dataset: "ok", admin: "ok", "admin-version": "ok", "config-js": "ok", "cors-data": "ok", https: "ok" });

    const crm = siteCli("acme");
    // Records CRUD.
    const company = await crm.ok(["records", "create", "--object", "companies", "--set", "name=Globex", "--set", "domain=globex.test", "--set", "employees=120"]);
    expect(company).toMatchObject({ object: "companies", label: "Globex", fields: { employees: 120 } });
    const person = await crm.ok(["records", "create", "--object", "people", "--fields", JSON.stringify({ firstName: "Grace", lastName: "Hopper", email: "grace@globex.test", company: company.id })]);
    expect(person.label).toBe("Grace Hopper");
    const updated = await crm.ok(["records", "update", person.id, "--set", "jobTitle=CTO", "--set", "phone=0612345678"]);
    expect(updated.fields).toMatchObject({ jobTitle: "CTO", phone: "0612345678" });
    const list = await crm.ok(["records", "list", "--object", "people", "--filter", "email:contains:globex", "--sort", "lastName"]);
    expect(list.total).toBe(1);
    const got = await crm.ok(["records", "get", company.id]);
    expect(JSON.stringify(got.related)).toContain(person.id);
    expect((await crm.ok(["records", "search", "Hopper"])).length ?? (await crm.ok(["records", "search", "Hopper"])).results?.length).toBeGreaterThan(0);

    // Deals + pipeline.
    const deal = await crm.ok(["records", "create", "--object", "deals", "--set", "name=Globex pilot", "--set", "amount=12000", "--set", `company=${company.id}`]);
    const moved = await crm.ok(["pipelines", "move", deal.id, "Proposal"]);
    expect(moved.fields.stage).toBe("proposal");

    // Activities, notes, tasks.
    await crm.ok(["notes", "add", person.id, "--body", "Met at the expo, wants a demo."]);
    await crm.ok(["activities", "add", "--type", "call", "--title", "Discovery call", "--record", person.id, "--meta", '{"durationMin":20}']);
    const task = await crm.ok(["tasks", "add", "--title", "Send proposal", "--due", "2030-01-15", "--record", deal.id, "--assignee", "me"]);
    expect((await crm.ok(["tasks", "list"])).total).toBe(1);
    await crm.ok(["tasks", "done", task.id]);
    expect((await crm.ok(["tasks", "list"])).total).toBe(0);
    expect((await crm.ok(["activities", "list", "--record", person.id])).total).toBe(2);

    // Delete = plan unless --yes; then soft delete + restore.
    const plan1 = await crm.ok(["records", "delete", deal.id]);
    expect(plan1).toMatchObject({ needsConfirmation: true, plan: { delete: [{ id: deal.id, label: "Globex pilot" }] } });
    await crm.ok(["records", "delete", deal.id, "--yes"]);
    expect((await crm.ok(["records", "list", "--object", "deals"])).total).toBe(0);
    await crm.ok(["records", "restore", deal.id]);
    expect((await crm.ok(["records", "list", "--object", "deals"])).total).toBe(1);

    // Import CSV: dry run by default, then apply; dedupe on email.
    const csv = join(root, "expo.csv");
    writeFileSync(csv, "First name,Last name,Email,Company\nGrace,Hopper,grace@globex.test,Globex\nAlan,Turing,alan@initech.test,Initech\nKatherine,Johnson,kj@nasa.test,\n");
    const dryImport = await crm.ok(["import", "csv", csv, "--object", "people"]);
    expect(dryImport).toMatchObject({ dryRun: true, needsConfirmation: true, total: 3, created: 2, updated: 1 });
    expect((await crm.ok(["records", "list", "--object", "people"])).total).toBe(1);
    const applied = await crm.ok(["import", "csv", csv, "--object", "people", "--yes"]);
    expect(applied).toMatchObject({ dryRun: false, created: 2, updated: 1 });
    expect((await crm.ok(["records", "list", "--object", "people"])).total).toBe(3);

    // Reports + stats.
    const pipeline = await crm.ok(["report", "pipeline"]);
    expect(JSON.stringify(pipeline.data)).toContain("proposal");
    expect((await crm.ok(["report", "stale", "--days", "0"])).report).toBe("stale");
    const stats = await crm.ok(["stats"]);
    expect(stats.objects.find((o: { id: string }) => o.id === "people").count).toBe(3);
    expect(stats.journal.segments).toBeGreaterThan(0);

    // AI tool catalog (same as MCP).
    const tools = await crm.ok(["tools", "list"]);
    expect(tools.tools.map((t: { name: string }) => t.name)).toContain("search_records");
    const called = await crm.ok(["tools", "call", "search_records", "--input", '{"query":"Turing"}']);
    expect(JSON.stringify(called.result)).toContain("Alan Turing");
    const viaTool = await crm.ok(["tools", "call", "create_record", "--input", JSON.stringify({ object: "companies", fields: { name: "Hooli" } })]);
    expect(viaTool.result.label).toBe("Hooli");

    // Export.
    const exported = await crm.ok(["export", "csv", "--object", "people"]);
    expect(exported.content).toContain("Alan");
    const out = join(root, "backup.json");
    expect((await crm.ok(["export", "json", "--out", out])).file).toBe(out);

    // Compact: plan, then physical purge of a hard-to-recover deleted record.
    await crm.ok(["records", "delete", viaTool.result.id, "--yes"]);
    const compactPlan = await crm.ok(["compact"]);
    expect(compactPlan).toMatchObject({ needsConfirmation: true, plan: { purgedRecords: [viaTool.result.id] } });
    const before = s3.keys("crm-data").filter((k) => k.includes("/journal/")).length;
    const compacted = await crm.ok(["compact", "--yes"]);
    expect(compacted).toMatchObject({ purgedRecords: [viaTool.result.id], storageCompacted: true });
    expect(s3.keys("crm-data").filter((k) => k.includes("/journal/")).length).toBeLessThan(before);
    expect(s3.keys("crm-data")).toContain("agentcrm/snapshot.bin");
    expect((await crm.ok(["records", "get", company.id])).label).toBe("Globex");
    expect((await crm.run(["records", "get", viaTool.result.id])).body.error?.code).toBe("notFound");

    // Status: hosted admin current; an older one proposes deploy-admin.
    expect((await cli(["status", "--site", "acme"])).body.data.sites[0].state).toBe("current");
    s3.object("crm-admin", "admin/version.json")!.body = new TextEncoder().encode('{"version":"0.0.1","dataSchema":1}');
    expect((await cli(["status", "--site", "acme"])).body.data.sites[0].state).toBe("update");
    expect((await cli(["deploy-admin", "--site", "acme"])).body.data.needsConfirmation).toBe(true);
    expect((await cli(["deploy-admin", "--site", "acme", "--yes"])).code).toBe(0);
    expect((await cli(["status", "--site", "acme"])).body.data.sites[0].state).toBe("current");
  }, 120_000);

  it("refuses a wrong passphrase and registers the CRM from its admin URL", async () => {
    process.env.E2E_WRONG = "definitely-not-it";
    await cli(["credentials", "set", "passphrase:wrong", "--from-env", "E2E_WRONG"]);
    const admin = `${ADMIN}/admin/`;
    const noPass = await cli(["site", "add", "acme2", "--admin-url", admin, "--data-credential", "s3:main"]);
    expect(noPass.body.error?.code).toBe("passphrase-required");
    const wrong = await cli(["site", "add", "acme2", "--admin-url", admin, "--data-credential", "s3:main", "--passphrase-credential", "passphrase:wrong"]);
    expect(wrong.body.error?.code).toBe("passphrase-wrong");
    const added = await cli(["site", "add", "acme2", "--admin-url", admin, "--data-credential", "s3:main", "--passphrase-credential", "passphrase:acme", "--hosting-credential", "s3:main"]);
    expect(added.code).toBe(0);
    expect(added.body.data).toMatchObject({ hosting: { type: "s3", connectorId: "s3", folder: "admin" }, warnings: [] });
    // Several sites, nothing chosen → site-required (exit 2).
    const ambiguous = await cli(["records", "list", "--object", "people"]);
    expect(ambiguous).toMatchObject({ code: 2, body: { error: { code: "site-required" } } });
    expect((await cli(["records", "list", "--object", "people", "--site", "acme2"])).body.data.total).toBe(3);
    await cli(["site", "forget", "acme2"]);
  }, 60_000);
});
