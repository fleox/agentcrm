import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installBrowserEnv } from "./browserEnv";
import { main } from "./cli";
import { fitWidths, table } from "./commands/util";
import { wrapText } from "./commands/human";
import type { Io } from "./output";
import { cli, fakeDist, siteCli, writePlan } from "./testing/cli";

// The human (non --json) output: tables and one-line confirmations instead
// of raw JSON. The --json answers are covered by the other e2e files.

const root = mkdtempSync(join(tmpdir(), "agentcrm-e2e-human-"));

async function human(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { json: false, out: (t) => void out.push(t), err: (t) => void err.push(t) };
  const code = await main([...args, "--site", "human"], io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

beforeAll(async () => {
  installBrowserEnv();
  process.env.AGENTCRM_HOME = join(root, "home");
  process.env.AGENTCRM_DIST = fakeDist(root);
  process.env.AGENTCRM_KDF_ITERATIONS = "1000";
  const plan = writePlan(root, "human", {
    alias: "human",
    owner: { name: "Owner", email: "owner@example.com" },
    data: { backend: "journal", location: { type: "local-folder", settings: { path: join(root, "data") } } },
    hosting: { type: "local-folder", settings: { path: join(root, "site") } },
    demo: true,
  });
  expect((await cli(["install", "--plan", plan])).code).toBe(0);
}, 60_000);

afterAll(() => {
  delete process.env.AGENTCRM_DIST;
});

describe("table()", () => {
  const rows = [{ id: "0abc123def456", name: "A rather long company name that goes on", note: "short" }];

  it("is unchanged without a width limit", () => {
    expect(table(rows, ["id", "name", "note"])).toBe(
      ["id             name                                     note", "-------------  ---------------------------------------  -----", "0abc123def456  A rather long company name that goes on  short"].join("\n"),
    );
  });

  it("shrinks the widest column with an ellipsis to fit, ids kept", () => {
    const out = table(rows, ["id", "name", "note"], { maxWidth: 40 });
    for (const line of out.split("\n")) expect(line.length).toBeLessThanOrEqual(40);
    expect(out).toContain("0abc123def456");
    expect(out).toContain("A rather long com…");
  });

  it("fitWidths shrinks the widest columns, never below 4", () => {
    expect(fitWidths([10, 10], 20)).toEqual([9, 9]);
    expect(fitWidths([10, 12], 20)).toEqual([9, 9]);
    expect(fitWidths([10, 10], 5)).toEqual([4, 4]);
    expect(fitWidths([20, 5], 20, [0])).toEqual([14, 4]);
    expect(fitWidths([20, 12], 30, [0])).toEqual([20, 8]);
    expect(fitWidths([3, 4], undefined)).toEqual([3, 4]);
  });

  it("right-aligns the given columns", () => {
    expect(table([{ n: 5, s: "x" }, { n: 123, s: "y" }], ["n", "s"], { right: ["n"] }).split("\n")).toEqual(["  n  s", "---  -", "  5  x", "123  y"]);
  });

  it("wrapText breaks long sentences", () => {
    const text = wrapText("one two three four five six seven eight nine ten", 20, "  ");
    expect(text.split("\n").every((l) => l.length <= 20 && l.startsWith("  "))).toBe(true);
    expect(text.replace(/\s+/g, " ").trim()).toBe("one two three four five six seven eight nine ten");
  });
});

describe("human output", () => {
  it("report pipeline prints a table with formatted amounts", async () => {
    const r = await human(["report", "pipeline"]);
    expect(r.code).toBe(0);
    const lines = r.out.split("\n");
    expect(lines[0]).toMatch(/^Stage\s+Kind\s+Deals\s+Amount\s+Weighted$/);
    expect(r.out).toMatch(/\nNew\s+open\s+\d+\s+\$[\d,]+/);
    expect(r.out).toMatch(/\nOpen: \d+ deal\(s\), \$[\d,]+ \(weighted \$[\d,]+\)$/);
    expect(r.out).not.toContain("{");
  });

  it("every report renders without JSON", async () => {
    for (const name of ["forecast", "won-lost", "activity", "lead-sources", "stale", "conversion"]) {
      const r = await human(["report", name]);
      expect(r.code, name).toBe(0);
      expect(r.out, name).not.toMatch(/^\s*[{[]/);
    }
  });

  it("records search prints kind / object / label / id", async () => {
    const crm = siteCli("human");
    const company = (await crm.ok(["records", "list", "--object", "companies", "--limit", "1"])).records[0];
    const r = await human(["records", "search", company.label]);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[1]).toMatch(/^kind\s+object\s+label\s+sub\s+id$/);
    expect(r.out).toMatch(new RegExp(`record\\s+companies\\s+${company.label}.*${company.id}`));
  });

  it("records list --columns uses the requested fields, formatted", async () => {
    const r = await human(["records", "list", "--object", "deals", "--columns", "name,amount,company", "--limit", "3"]);
    expect(r.code).toBe(0);
    const [count, header, , first] = r.out.split("\n");
    expect(count).toMatch(/^\d+ record\(s\)/);
    expect(header).toMatch(/^id\s+Name\s+Amount\s+Company$/);
    expect(first).toMatch(/\$[\d,]+/);
    // Relations by label, not by id.
    const crm = siteCli("human");
    const deal = (await crm.ok(["records", "list", "--object", "deals", "--columns", "company", "--limit", "1"])).records[0];
    expect(first).not.toContain(String(deal.fields.company));
    // Default columns unchanged.
    expect((await human(["records", "list", "--object", "deals", "--limit", "1"])).out.split("\n")[1]).toMatch(/^id\s+label\s+updatedAt$/);
  });

  it("records get lists the fields by label", async () => {
    const crm = siteCli("human");
    const deal = (await crm.ok(["records", "list", "--object", "deals", "--limit", "1"])).records[0];
    const r = await human(["records", "get", deal.id]);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toBe(`${deal.label}  (deals ${deal.id})`);
    expect(r.out).toMatch(/\n {2}Amount: +\$[\d,]+/);
    expect(r.out).toMatch(/\n {2}Created: +\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
  });

  it("pipelines move and tasks add print one-line confirmations", async () => {
    const crm = siteCli("human");
    const deal = (await crm.ok(["records", "list", "--object", "deals", "--filter", "stage:eq:proposal", "--limit", "1"])).records[0];
    const moved = await human(["pipelines", "move", deal.id, "Won"]);
    expect(moved.code).toBe(0);
    expect(moved.out).toBe(`Moved deal ${deal.label}: Proposal → Won (probability 100 %)`);
    const task = await human(["tasks", "add", "--title", "Call back", "--due", "2030-01-15", "--record", deal.id]);
    expect(task.code).toBe(0);
    expect(task.out).toMatch(new RegExp(`^Created task \\S+ "Call back" due 2030-01-15, assigned to Owner, on ${deal.label}$`));
  });

  it("plans end with the short footer", async () => {
    const crm = siteCli("human");
    const deal = (await crm.ok(["records", "list", "--object", "deals", "--limit", "1"])).records[0];
    const r = await human(["records", "delete", deal.id]);
    expect(r.out.split("\n").at(-1)).toBe("Nothing changed. Re-run with --yes to apply.");
  });
});
