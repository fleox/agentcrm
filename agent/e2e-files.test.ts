import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installBrowserEnv } from "./browserEnv";
import { cli, fakeDist, siteCli, writePlan } from "./testing/cli";
import { demoChartPng } from "../src/ops/demoFiles";

// Files from the CLI on an encrypted journal in a local folder: upload to
// records / activities, --attach, record images, get, delete + compact
// (bytes gone), ZIP backup — and no plaintext file bytes on the storage.

const root = mkdtempSync(join(tmpdir(), "agentcrm-e2e-files-"));

beforeAll(() => {
  installBrowserEnv();
  process.env.AGENTCRM_HOME = join(root, "home");
  process.env.AGENTCRM_DIST = fakeDist(root);
  process.env.AGENTCRM_KDF_ITERATIONS = "1000";
});

afterAll(() => {
  delete process.env.AGENTCRM_DIST;
});

describe("files CLI", () => {
  it("uploads, attaches, sets images, downloads, deletes and purges", async () => {
    const plan = writePlan(root, "files", {
      alias: "files",
      owner: { name: "Owner", email: "owner@example.com" },
      data: { backend: "journal", location: { type: "local-folder", settings: { path: join(root, "data") } } },
      hosting: { type: "local-folder", settings: { path: join(root, "site"), siteUrl: "http://localhost:4173" } },
    });
    expect((await cli(["install", "--plan", plan])).code).toBe(0);
    const crm = siteCli("files");
    const person = await crm.ok(["records", "create", "--object", "people", "--set", "name=Ada Lovelace"]);
    const doc = join(root, "contract.txt");
    writeFileSync(doc, "CONFIDENTIAL CONTRACT TERMS");
    const png = join(root, "ada.png");
    writeFileSync(png, demoChartPng().bytes);

    const up = await crm.ok(["files", "upload", doc, "--record", person.id]);
    expect(up.uploaded[0]).toMatchObject({ name: "contract.txt", mime: "text/plain", size: 27 });
    const note = await crm.ok(["notes", "add", person.id, "--body", "Signed today", "--attach", png]);
    expect(note.attachments).toHaveLength(1);
    const task = await crm.ok(["tasks", "add", "--title", "Countersign", "--record", person.id, "--attach", doc]);
    expect(task.attachments).toHaveLength(1);
    const act = await crm.ok(["activities", "add", "--type", "call", "--title", "Call", "--record", person.id, "--attach", doc]);
    expect(act.attachments).toHaveLength(1);
    const listed = await crm.ok(["files", "list", "--record", person.id]);
    expect(listed.total).toBe(4);
    const imgs = await crm.ok(["files", "list", "--record", person.id, "--kind", "image"]);
    expect(imgs.files[0]).toMatchObject({ width: 360, height: 200 });

    const img = await crm.ok(["records", "image", person.id, png]);
    expect(img.image.mime).toBe("image/png");
    expect((await crm.ok(["records", "get", person.id])).record?.fields?.avatar ?? (await crm.ok(["records", "get", person.id])).fields?.avatar).toBe(img.image.id);

    const out = join(root, "out.txt");
    await crm.ok(["files", "get", up.uploaded[0].id, "--out", out]);
    expect(readFileSync(out, "utf8")).toBe("CONFIDENTIAL CONTRACT TERMS");

    // Encrypted at rest.
    const filesDir = join(root, "data", "agentcrm", "files");
    expect(readdirSync(filesDir).length).toBeGreaterThanOrEqual(5);
    for (const f of readdirSync(filesDir)) expect(readFileSync(join(filesDir, f)).includes(Buffer.from("CONFIDENTIAL"))).toBe(false);

    // Backup ZIP.
    const zip = join(root, "backup.zip");
    const backup = await crm.ok(["export", "zip", "--out", zip]);
    expect(backup.files).toBe(5);
    expect(existsSync(zip)).toBe(true);
    expect((await crm.ok(["import", "zip", zip])).needsConfirmation).toBe(true);

    // Delete → plan, then --yes; compact purges the bytes.
    expect((await crm.ok(["files", "delete", up.uploaded[0].id])).needsConfirmation).toBe(true);
    await crm.ok(["files", "delete", up.uploaded[0].id, "--yes"]);
    const compact = await crm.ok(["compact", "--yes"]);
    expect(compact.purgedFiles).toBe(1);
    expect(existsSync(join(filesDir, `${up.uploaded[0].id}.bin`))).toBe(false);
    expect((await crm.ok(["records", "image", person.id, "--remove"])).image).toBeNull();
    expect((await crm.ok(["files", "usage"])).count).toBe(3);
    // Usage errors.
    expect((await crm.run(["files", "upload", join(root, "missing.bin"), "--record", person.id])).code).toBe(2);
    expect((await crm.run(["files", "upload", doc])).code).toBe(2);
  }, 60_000);
});
