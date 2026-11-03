// Passphrase strength estimate for the setup wizard / Settings (rough
// entropy: character classes × length, penalising repeats and very
// common choices). 0 = too weak … 4 = strong.

const COMMON = ["password", "passphrase", "agentcrm", "123456", "azerty", "qwerty", "letmein", "admin", "welcome", "secret"];

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4;
  bits: number;
}

export function passphraseStrength(value: string): Strength {
  const v = value.trim();
  if (!v) return { score: 0, bits: 0 };
  let pool = 0;
  if (/[a-z]/.test(v)) pool += 26;
  if (/[A-Z]/.test(v)) pool += 26;
  if (/[0-9]/.test(v)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(v)) pool += 33;
  const unique = new Set(v.toLowerCase()).size;
  // Repeated characters add little.
  const effectiveLength = Math.min(v.length, unique * 2.5);
  let bits = Math.log2(Math.max(pool, 2)) * effectiveLength;
  // Word-based passphrases ("correct horse battery staple").
  const words = v.split(/[\s\-_.]+/).filter((w) => w.length >= 3);
  if (words.length >= 4) bits = Math.max(bits, words.length * 12);
  if (COMMON.some((c) => v.toLowerCase().includes(c))) bits -= 20;
  bits = Math.max(0, Math.round(bits));
  const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { score: score as Strength["score"], bits };
}

// Minimum accepted by the wizard (a weak passphrase is refused).
export const MIN_PASSPHRASE_SCORE = 2;
export const MIN_PASSPHRASE_LENGTH = 10;

export function passphraseAcceptable(value: string): boolean {
  return value.trim().length >= MIN_PASSPHRASE_LENGTH && passphraseStrength(value).score >= MIN_PASSPHRASE_SCORE;
}
