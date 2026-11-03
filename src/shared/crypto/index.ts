// Symmetric encryption of AgentCRM data files (journal snapshot and
// segments, exports). On a bucket / repo / synced folder the files are
// as reachable as the storage credentials allow, and they hold personal
// data, so they are encrypted by default: AES-256-GCM with a key derived
// from a passphrase (PBKDF2-SHA256). The passphrase never leaves the
// browsers (localStorage) and the agentcrm credentials file that use it.
//
// Adapted from cms-ia src/services/docstore/sqliteCrypto.ts (see
// SHARED.md) — magic renamed, API generalised to any bytes.
//
// File layout:  "ACRMENC1" | iterations (u32 BE) | salt (16) | iv (12) | ciphertext + GCM tag
// The salt is shared by every file of one dataset (stored in the public
// keyinfo.json, so one key derivation per session); the IV is fresh for
// every encryption.

export const MAGIC = new TextEncoder().encode("ACRMENC1");
export const HEADER_LENGTH = MAGIC.length + 4 + 16 + 12;
export const PBKDF2_ITERATIONS = 600_000;

export class PassphraseError extends Error {
  constructor(readonly reason: "missing" | "wrong") {
    super(reason === "missing" ? "This data is encrypted: enter its passphrase." : "Wrong passphrase: the data could not be decrypted.");
    this.name = "PassphraseError";
  }
}

export function isEncrypted(bytes: Uint8Array | null | undefined): boolean {
  return !!bytes && bytes.length >= HEADER_LENGTH && MAGIC.every((b, i) => bytes[i] === b);
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const id = `${iterations}:${hex(salt)}:${passphrase}`;
  let key = keyCache.get(id);
  if (!key) {
    key = (async () => {
      const material = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(passphrase.normalize("NFC")),
        "PBKDF2",
        false,
        ["deriveKey"],
      );
      return crypto.subtle.deriveKey(
        { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    })();
    key.catch(() => keyCache.delete(id));
    keyCache.set(id, key);
  }
  return key;
}

export interface EncryptionParams {
  salt: Uint8Array;
  iterations: number;
}

export function newEncryptionParams(iterations = PBKDF2_ITERATIONS): EncryptionParams {
  return { salt: crypto.getRandomValues(new Uint8Array(16)), iterations };
}

// Salt + iteration count of an encrypted file.
export function encryptionParams(bytes: Uint8Array): EncryptionParams {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    iterations: view.getUint32(MAGIC.length),
    salt: bytes.slice(MAGIC.length + 4, MAGIC.length + 20),
  };
}

export async function encryptBytes(plain: Uint8Array, passphrase: string, params?: EncryptionParams): Promise<Uint8Array> {
  if (!passphrase) throw new PassphraseError("missing");
  const { salt, iterations } = params ?? newEncryptionParams();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain as BufferSource));
  const out = new Uint8Array(HEADER_LENGTH + cipher.length);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(MAGIC.length, iterations);
  out.set(salt, MAGIC.length + 4);
  out.set(iv, MAGIC.length + 20);
  out.set(cipher, HEADER_LENGTH);
  return out;
}

export async function decryptBytes(bytes: Uint8Array, passphrase: string | null | undefined): Promise<Uint8Array> {
  if (!passphrase) throw new PassphraseError("missing");
  if (!isEncrypted(bytes)) throw new Error("Not an AgentCRM encrypted file (bad magic).");
  const { salt, iterations } = encryptionParams(bytes);
  const iv = bytes.slice(MAGIC.length + 20, HEADER_LENGTH);
  const key = await deriveKey(passphrase, salt, iterations);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, bytes.slice(HEADER_LENGTH) as BufferSource));
  } catch {
    throw new PassphraseError("wrong");
  }
}

export async function encryptText(text: string, passphrase: string, params?: EncryptionParams): Promise<Uint8Array> {
  return encryptBytes(new TextEncoder().encode(text), passphrase, params);
}

export async function decryptText(bytes: Uint8Array, passphrase: string | null | undefined): Promise<string> {
  return new TextDecoder().decode(await decryptBytes(bytes, passphrase));
}

// Readable random passphrase: 6 groups of 5 characters from a 31-symbol
// alphabet without look-alikes (~148 bits).
export function generatePassphrase(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const pick = crypto.getRandomValues(new Uint8Array(30));
  const chars = [...pick].map((b) => alphabet[b % alphabet.length]);
  return Array.from({ length: 6 }, (_, i) => chars.slice(i * 5, i * 5 + 5).join("")).join("-");
}
