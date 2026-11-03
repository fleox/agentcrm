import { describe, expect, it } from "vitest";
import { main } from "./cli";
import type { Io } from "./output";

function io(json = true) {
  const out: string[] = [];
  const err: string[] = [];
  const value: Io = { json, out: (t) => void out.push(t), err: (t) => void err.push(t) };
  return { value, out, err };
}

describe("cli skeleton", () => {
  it("prints help and version as JSON", async () => {
    const a = io();
    expect(await main(["help", "--json"], a.value)).toBe(0);
    expect(JSON.parse(a.out[0]).data.commands.map((c: { name: string }) => c.name)).toContain("version");
    const b = io();
    await main(["version", "--json"], b.value);
    expect(JSON.parse(b.out[0])).toMatchObject({ ok: true, data: { version: "0.1.0" } });
  });

  it("exits 2 on unknown commands and usage errors", async () => {
    const a = io();
    expect(await main(["nope", "--json"], a.value)).toBe(2);
    expect(JSON.parse(a.out[0]).error.code).toBe("unknown-command");
    const b = io();
    expect(await main(["help", "--bogus", "--json"], b.value)).toBe(2);
  });
});
