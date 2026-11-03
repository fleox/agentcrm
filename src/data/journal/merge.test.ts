import { describe, expect, it } from "vitest";
import { applyOp, emptyMergeState, materializeDoc, mergeStates, purgeState, type JournalOp, type MergeState } from "./merge";

const t = (n: number, node = "a") => `${String(n).padStart(13, "0")}-0000-${node}`;

function replay(ops: JournalOp[]): MergeState {
  const s = emptyMergeState();
  for (const op of ops) applyOp(s, op);
  return s;
}

function doc(s: MergeState, id = "r1") {
  const ds = s.records.get(id);
  return ds ? materializeDoc(id, ds) : null;
}

// Every permutation of a small op list must converge.
function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

describe("journal merge", () => {
  const set: JournalOp = { t: t(1), op: "set", c: "records", doc: { id: "r1", object: "people", fields: { name: "Ada", email: "a@x.io" } } };

  it("per-field LWW: concurrent edits of different fields both survive", () => {
    const a: JournalOp = { t: t(2, "a"), op: "patch", c: "records", id: "r1", f: [["fields.name", "Ada L."]] };
    const b: JournalOp = { t: t(3, "b"), op: "patch", c: "records", id: "r1", f: [["fields.email", "ada@x.io"]] };
    for (const order of permutations([set, a, b])) {
      expect(doc(replay(order))!.fields).toEqual({ name: "Ada L.", email: "ada@x.io" });
    }
  });

  it("same field: the newest stamp wins in any order", () => {
    const a: JournalOp = { t: t(5, "a"), op: "patch", c: "records", id: "r1", f: [["fields.name", "from A"]] };
    const b: JournalOp = { t: t(5, "b"), op: "patch", c: "records", id: "r1", f: [["fields.name", "from B"]] };
    for (const order of permutations([set, a, b])) expect(doc(replay(order))!.fields).toMatchObject({ name: "from B" });
  });

  it("a newer set replaces older values; older sets are ignored", () => {
    const patch: JournalOp = { t: t(2), op: "patch", c: "records", id: "r1", f: [["fields.email", "old@x.io"]] };
    const reset: JournalOp = { t: t(3), op: "set", c: "records", doc: { id: "r1", object: "people", fields: { name: "New" } } };
    const late: JournalOp = { t: t(4), op: "patch", c: "records", id: "r1", f: [["fields.city", "Paris"]] };
    for (const order of permutations([set, patch, reset, late])) {
      expect(doc(replay(order))).toEqual({ id: "r1", object: "people", fields: { name: "New", city: "Paris" } });
    }
  });

  it("removal entries and parent / child paths", () => {
    const rm: JournalOp = { t: t(2), op: "patch", c: "records", id: "r1", f: [["fields.email"]] };
    const whole: JournalOp = { t: t(3), op: "patch", c: "records", id: "r1", f: [["fields", { name: "Whole" }]] };
    const child: JournalOp = { t: t(4), op: "patch", c: "records", id: "r1", f: [["fields.tags", ["vip"]]] };
    for (const order of permutations([set, rm, whole, child])) {
      expect(doc(replay(order))!.fields).toEqual({ name: "Whole", tags: ["vip"] });
    }
    expect(doc(replay([set, rm]))!.fields).toEqual({ name: "Ada" });
  });

  it("delete wins over older writes and patches never resurrect; a newer set restores", () => {
    const del: JournalOp = { t: t(5), op: "delete", c: "records", id: "r1" };
    const latePatch: JournalOp = { t: t(6), op: "patch", c: "records", id: "r1", f: [["fields.name", "Zombie"]] };
    for (const order of permutations([set, del, latePatch])) expect(doc(replay(order))).toBeNull();
    const restore: JournalOp = { t: t(7), op: "set", c: "records", doc: { id: "r1", object: "people", fields: { name: "Back" } } };
    for (const order of permutations([set, del, restore])) expect(doc(replay(order))!.fields).toEqual({ name: "Back" });
  });

  it("ops are idempotent and states merge like a replay", () => {
    const a: JournalOp = { t: t(2, "a"), op: "patch", c: "records", id: "r1", f: [["fields.name", "A"]] };
    const b: JournalOp = { t: t(3, "b"), op: "patch", c: "records", id: "r1", f: [["fields.city", "B"]] };
    const once = replay([set, a, b]);
    const twice = replay([set, a, b, a, set, b]);
    expect(doc(twice)).toEqual(doc(once));
    const left = replay([set, a]);
    const right = replay([b]);
    mergeStates(left, right);
    expect(doc(left)).toEqual(doc(once));
  });

  it("purge drops deleted data but keeps a tombstone", () => {
    const s = replay([set, { t: t(5), op: "delete", c: "records", id: "r1" }, { t: t(1), op: "set", c: "records", doc: { id: "r2", v: 1 } }]);
    expect(purgeState(s)).toBe(1);
    expect(s.records.get("r1")).toEqual({ del: t(5), e: {} });
    expect(JSON.stringify(s.records.get("r1"))).not.toContain("Ada");
    // A lagging old segment can't bring it back.
    applyOp(s, set);
    expect(doc(s)).toBeNull();
    expect(doc(s, "r2")).toEqual({ id: "r2", v: 1 });
  });
});
