import { describe, expect, it } from "vitest";
import { compareHlc, createHlcClock, formatHlc, maxHlc, parseHlc } from "./hlc";

describe("hlc", () => {
  it("formats and parses", () => {
    const s = formatHlc({ wall: 1730620800000, counter: 37, node: "abc" });
    expect(s).toBe("1730620800000-0011-abc");
    expect(parseHlc(s)).toEqual({ wall: 1730620800000, counter: 37, node: "abc" });
    expect(() => parseHlc("garbage")).toThrow();
  });

  it("is strictly monotonic even when the wall clock stalls or goes back", () => {
    let t = 1000;
    const clock = createHlcClock("a", () => t);
    const a = clock.now();
    const b = clock.now();
    t = 500;
    const c = clock.now();
    t = 2000;
    const d = clock.now();
    expect([a, b, c, d]).toEqual([...[a, b, c, d]].sort());
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it("orders after received remote stamps (skewed clocks)", () => {
    const fast = createHlcClock("fast", () => 10_000);
    const slow = createHlcClock("slow", () => 1_000);
    const remote = fast.now();
    slow.receive(remote);
    const local = slow.now();
    expect(compareHlc(local, remote)).toBe(1);
  });

  it("ignores absurd future stamps", () => {
    const clock = createHlcClock("a", () => 1_000);
    clock.receive(formatHlc({ wall: 1_000 + 10 * 24 * 3600_000, counter: 0, node: "evil" }));
    expect(parseHlc(clock.now()).wall).toBe(1_000);
  });

  it("maxHlc", () => {
    expect(maxHlc(undefined, "b")).toBe("b");
    expect(maxHlc("1", "2")).toBe("2");
  });
});
