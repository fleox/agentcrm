// Short, URL-safe, lexicographically sortable ids: 9 chars of base36
// millisecond time + 7 random chars = 16 chars, e.g. "0m3a8k2xq4f8q2m0".
// Sorting by id ≈ sorting by creation time (monotonic within one process).

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function randomChars(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 36];
  return out;
}

let lastTime = 0;
let lastRandom = "";

export function newId(now: number = Date.now()): string {
  const time = Math.max(0, Math.floor(now)).toString(36).padStart(9, "0").slice(-9);
  // Monotonic within the same millisecond: bump the random part so ids
  // generated in a tight loop stay sorted.
  if (now === lastTime && lastRandom) {
    lastRandom = increment(lastRandom);
  } else {
    lastTime = now;
    lastRandom = randomChars(7);
  }
  return time + lastRandom;
}

function increment(s: string): string {
  const chars = s.split("");
  for (let i = chars.length - 1; i >= 0; i--) {
    const idx = ALPHABET.indexOf(chars[i]);
    if (idx < 35) {
      chars[i] = ALPHABET[idx + 1];
      return chars.join("");
    }
    chars[i] = "0";
  }
  return chars.join("") + "0";
}

// Deterministic id from a seed (demo data, tests): same seed → same id.
export function seededId(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).padStart(14, "0");
}

export function isId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-z_-]{4,64}$/i.test(value);
}

// Slug-like ids for objects / fields / options: "lead-source".
export function slugId(label: string, taken: Iterable<string> = []): string {
  const base =
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}
