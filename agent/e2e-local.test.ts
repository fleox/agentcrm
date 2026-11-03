import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installBrowserEnv } from "./browserEnv";
import { cli, fakeDist, siteCli, writePlan } from "./testing/cli";

// No network at all: an encrypted journal in a folder of this computer,
// the admin copied to another folder. Schema, views, users, settings,
// dedupe / merge, automations and forms commands, locking.

const root = mkdtempSync(join(tmpdir(), "agentcrm-e2e-local-"));

beforeAll(() => {
  installBrowserEnv();
  process.env.AGENTCRM_HOME = join(root, "home");
  process.env.AGENTCRM_DIST = fakeDist(root);
  process.env.AGENTCRM_KDF_ITERATIONS = "1000";
});

afterAll(() => {
  delete process.env.AGENTCRM_DIST;
});

describe("journal CRM in a local folder", () => {
  it("installs with demo data and runs the admin commands", async () => {
    const plan = writePlan(root, "local", {
      alias: "local",
      owner: { name: "Owner", email: "owner@example.com" },
      data: { backend: "journal", location: { type: "local-folder", settings: { path: join(root, "data") } } },
      hosting: { type: "local-folder", settings: { path: join(root, "site"), siteUrl: "http://localhost:4173" } },
      demo: true,
    });
    const res = await cli(["install", "--plan", plan]);
    expect(res.code).toBe(0);
    expect(res.body.data.seed.demo.companies).toBe(30);
    expect(existsSync(join(root, "data", "agentcrm", "keyinfo.json"))).toBe(true);
    expect(readFileSync(join(root, "site", "admin", "config.js"), "utf8")).toContain('"connectorId": "local-folder"');
    expect(readFileSync(join(root, "site", "admin", "config.js"), "utf8")).not.toContain(root);

    const crm = siteCli("local");
    // Schema.
    const objects = await crm.ok(["objects", "list"]);
    expect(objects.map((o: { id: string }) => o.id)).toEqual(expect.arrayContaining(["companies", "people", "deals"]));
    const obj = await crm.ok(["objects", "create", "--singular", "Project", "--plural", "Projects"]);
    const field = await crm.ok(["fields", "add", "--object", obj.id, "--label", "Phase", "--type", "select", "--options", "Scoping,Build,Done"]);
    expect(field.options.map((o: { label: string }) => o.label)).toEqual(["Scoping", "Build", "Done"]);
    await crm.ok(["fields", "add", "--object", obj.id, "--label", "Client", "--type", "relation", "--relation-object", "companies"]);
    const project = await crm.ok(["records", "create", "--object", obj.id, "--set", "name=Website", "--set", "phase=Build"]);
    expect(project.fields.phase).toBeTruthy();
    expect((await crm.ok(["fields", "delete", field.id, "--object", obj.id])).needsConfirmation).toBe(true);
    await crm.ok(["fields", "delete", field.id, "--object", obj.id, "--yes"]);
    expect((await crm.ok(["objects", "get", obj.id])).objects?.[0]?.fields ?? []).not.toContainEqual(expect.objectContaining({ id: field.id }));
    expect((await crm.ok(["objects", "delete", obj.id])).needsConfirmation).toBe(true);
    await crm.ok(["objects", "delete", obj.id, "--yes"]);

    // Pipelines, views, users, settings.
    const pipelines = await crm.ok(["pipelines", "list"]);
    expect(pipelines[0].stages.length).toBeGreaterThanOrEqual(6);
    const view = await crm.ok(["views", "create", "--object", "deals", "--name", "Big deals", "--filter", "amount:gte:50000", "--sort", "amount:desc", "--shared"]);
    expect((await crm.ok(["records", "list", "--object", "deals", "--view", view.id])).records.every((r: { fields: { amount: number } }) => r.fields.amount >= 50000)).toBe(true);
    await crm.ok(["views", "delete", view.id, "--yes"]);
    const user = await crm.ok(["users", "add", "--email", "new@example.com", "--name", "New Rep"]);
    expect(user.role).toBe("member");
    expect((await crm.ok(["users", "role", "new@example.com", "viewer"])).role).toBe("viewer");
    expect((await crm.ok(["users", "disable", user.id])).disabled).toBe(true);
    // Acting as a viewer: writes are refused by the engine.
    await crm.ok(["users", "disable", user.id, "--enable"]);
    const forbidden = await crm.run(["records", "create", "--object", "companies", "--set", "name=X", "--as", "new@example.com"]);
    expect(forbidden.body.error?.code).toBe("forbidden");
    expect((await crm.ok(["settings", "set", "--set", "staleDealDays=21"])).staleDealDays).toBe(21);
    expect((await crm.ok(["settings", "get"])).staleDealDays).toBe(21);

    // Dedupe + merge.
    const a = await crm.ok(["records", "create", "--object", "people", "--set", "firstName=Dup", "--set", "lastName=Licate", "--set", "email=dup@x.test"]);
    const b = await crm.ok(["records", "create", "--object", "people", "--set", "firstName=Dup", "--set", "lastName=Licate", "--set", "phone=+1 555 0100"]);
    const dups = await crm.ok(["records", "duplicates", "--object", "people", "--by", "name"]);
    expect(JSON.stringify(dups.duplicates)).toContain(b.id);
    expect((await crm.ok(["records", "merge", a.id, b.id])).needsConfirmation).toBe(true);
    const merged = await crm.ok(["records", "merge", a.id, b.id, "--yes"]);
    expect(merged.record.fields.phone).toBe("+1 555 0100");

    // Automations / forms commands answer (engine owned elsewhere).
    expect(Array.isArray(await crm.ok(["automations", "list"]))).toBe(true);
    expect((await crm.ok(["automations", "run"])).needsConfirmation).toBe(true);
    expect(Array.isArray(await crm.ok(["forms", "list"]))).toBe(true);
    expect((await crm.ok(["forms", "ingest"])).needsConfirmation).toBe(true);

    // Every report runs.
    for (const name of ["pipeline", "forecast", "won-lost", "activity", "lead-sources", "stale", "conversion"]) {
      expect((await crm.ok(["report", name])).report).toBe(name);
    }
    expect((await crm.run(["report", "nope"])).body.error?.code).toBe("notFound");

    // Export → CSV file → re-import (updates by id, dry run).
    const out = join(root, "companies.csv");
    await crm.ok(["export", "csv", "--object", "companies", "--out", out]);
    const reimport = await crm.ok(["import", "csv", out, "--object", "companies"]);
    expect(reimport.created).toBe(0);
    expect(reimport.updated).toBeGreaterThan(0);
    writeFileSync(join(root, "bad.csv"), "Name;Employees\nAcme;lots\n");
    const bad = await crm.ok(["import", "csv", join(root, "bad.csv"), "--object", "companies", "--map", "Name=name,Employees=employees"]);
    expect(bad.failed + bad.skipped + bad.created + bad.updated).toBe(1);

    const doctor = await cli(["doctor", "--site", "local"]);
    expect(doctor.body.data.checks.find((c: { id: string }) => c.id === "dataset").status).toBe("ok");
  }, 120_000);
});
