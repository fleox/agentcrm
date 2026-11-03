import { describe, expect, it } from "vitest";
import {
  decryptBytes,
  decryptText,
  encryptBytes,
  encryptText,
  encryptionParams,
  generatePassphrase,
  isEncrypted,
  newEncryptionParams,
  PassphraseError,
} from "./index";

// Low iteration count: the format is what's under test, not PBKDF2 cost.
const params = newEncryptionParams(1000);

describe("crypto", () => {
  it("round-trips bytes and text with the ACRMENC1 header", async () => {
    const enc = await encryptText("héllo CRM", "pass", params);
    expect(new TextDecoder().decode(enc.slice(0, 8))).toBe("ACRMENC1");
    expect(isEncrypted(enc)).toBe(true);
    expect(encryptionParams(enc).iterations).toBe(1000);
    expect(await decryptText(enc, "pass")).toBe("héllo CRM");
    const bytes = new Uint8Array([1, 2, 3, 250]);
    expect([...(await decryptBytes(await encryptBytes(bytes, "p", params), "p"))]).toEqual([1, 2, 3, 250]);
  });

  it("uses a fresh IV for every encryption", async () => {
    const a = await encryptText("same", "pass", params);
    const b = await encryptText("same", "pass", params);
    expect(Buffer.from(a).toString("hex")).not.toBe(Buffer.from(b).toString("hex"));
  });

  it("reports missing and wrong passphrases", async () => {
    const enc = await encryptText("x", "right", params);
    await expect(decryptText(enc, "wrong")).rejects.toMatchObject({ name: "PassphraseError", reason: "wrong" });
    await expect(decryptText(enc, null)).rejects.toBeInstanceOf(PassphraseError);
    await expect(encryptText("x", "")).rejects.toMatchObject({ reason: "missing" });
  });

  it("rejects plain data and generates readable passphrases", async () => {
    expect(isEncrypted(new TextEncoder().encode("plain text, not encrypted"))).toBe(false);
    expect(generatePassphrase()).toMatch(/^([a-z2-9]{5}-){5}[a-z2-9]{5}$/);
  });
});
