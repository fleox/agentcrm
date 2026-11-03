// Base64 / UTF-8 helpers that work in browsers and in Node (vitest).

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked so String.fromCharCode never gets a huge argument list.
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

export function base64ToUtf8(base64: string): string {
  return new TextDecoder().decode(base64ToBytes(base64));
}

export function changeToBytes(change: { content: string; encoding?: "utf-8" | "base64" }): Uint8Array {
  return change.encoding === "base64"
    ? base64ToBytes(change.content)
    : new TextEncoder().encode(change.content);
}
