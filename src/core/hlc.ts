// Hybrid logical clock (Kulkarni et al.) — timestamps that respect
// causality across clients with skewed wall clocks. Used by the journal
// backend for per-field last-writer-wins.
//
// Serialised form (lexicographically sortable, fixed width):
//   <wall ms, 13 digits>-<counter, 4 base36 digits>-<node id>
//   e.g. "1730620800000-0000-k3j9x2"
// Two stamps from different nodes never compare equal (the node id
// breaks ties), so merges are deterministic.

export interface Hlc {
  wall: number;
  counter: number;
  node: string;
}

const MAX_COUNTER = 36 ** 4 - 1;
// Refuse to adopt remote clocks further than this in the future.
export const MAX_DRIFT_MS = 24 * 3600_000;

export function formatHlc(h: Hlc): string {
  return `${String(Math.floor(h.wall)).padStart(13, "0")}-${h.counter.toString(36).padStart(4, "0")}-${h.node}`;
}

export function parseHlc(s: string): Hlc {
  const m = /^(\d{13})-([0-9a-z]{4})-(.+)$/.exec(s);
  if (!m) throw new Error(`Invalid HLC timestamp "${s}"`);
  return { wall: Number(m[1]), counter: parseInt(m[2], 36), node: m[3] };
}

export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxHlc(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export interface HlcClock {
  readonly node: string;
  // A new stamp, strictly greater than every stamp issued or received.
  now(): string;
  // Merge a remote stamp (call for every stamp read from other clients).
  receive(stamp: string): void;
  // Last stamp issued or received ("" before any).
  last(): string;
}

export function createHlcClock(node: string, wallClock: () => number = Date.now): HlcClock {
  if (!/^[0-9a-z]+$/i.test(node)) throw new Error(`Invalid HLC node id "${node}"`);
  let state: Hlc = { wall: 0, counter: 0, node };
  let issued = false;

  function bump(wall: number, counter: number): void {
    if (counter > MAX_COUNTER) {
      // Counter overflow: move the logical wall forward by 1 ms.
      state = { wall: wall + 1, counter: 0, node };
    } else {
      state = { wall, counter, node };
    }
  }

  return {
    node,
    now() {
      const physical = wallClock();
      if (physical > state.wall) bump(physical, 0);
      else bump(state.wall, state.counter + 1);
      issued = true;
      return formatHlc(state);
    },
    receive(stamp) {
      const remote = parseHlc(stamp);
      const physical = wallClock();
      if (remote.wall > physical + MAX_DRIFT_MS) return;
      if (remote.wall > state.wall) bump(remote.wall, remote.counter + 1);
      else if (remote.wall === state.wall && remote.counter >= state.counter) bump(state.wall, remote.counter + 1);
      issued = true;
    },
    last() {
      return issued ? formatHlc(state) : "";
    },
  };
}
