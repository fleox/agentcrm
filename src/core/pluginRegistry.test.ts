import { describe, expect, it, vi } from "vitest";
import { createPluginRegistry } from "./pluginRegistry";
import type { CrmRecord } from "./types";

const ctx = { user: null, now: () => 0 };
const record: CrmRecord = { id: "r1", object: "deals", fields: {}, createdAt: 0, updatedAt: 0 };

describe("pluginRegistry", () => {
  it("runs actions by priority then registration order and isolates failures", async () => {
    const onError = vi.fn();
    const reg = createPluginRegistry(onError);
    const calls: string[] = [];
    reg.addAction("record.created", () => void calls.push("b"), 20);
    reg.addAction("record.created", () => {
      calls.push("a");
      throw new Error("boom");
    }, 5);
    reg.addAction("record.created", (_c, p) => void calls.push(`c:${p.record.id}`), 20);
    await reg.doAction("record.created", ctx, { record });
    expect(calls).toEqual(["a", "b", "c:r1"]);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("composes filters and supports unsubscribe", async () => {
    const reg = createPluginRegistry();
    const off = reg.addFilter<number>("score", (v) => v * 2);
    reg.addFilter<number>("score", (v) => v + 1, 1);
    expect(await reg.applyFilters("score", 3)).toBe(8);
    off();
    expect(reg.applyFiltersSync("score", 3)).toBe(4);
    expect(reg.listHooks().filters).toEqual(["score"]);
  });

  it("rejects async filters in sync mode and resets", () => {
    const reg = createPluginRegistry();
    reg.addFilter("x", async (v) => v);
    expect(() => reg.applyFiltersSync("x", 1)).toThrow(/synchronous/);
    reg.reset();
    expect(reg.hasAction("record.created")).toBe(false);
    expect(reg.listHooks()).toEqual({ filters: [], actions: [] });
  });
});
