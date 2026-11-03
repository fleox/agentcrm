// File encoding of the journal backend: JSON → gzip → (AES-GCM, when the
// dataset is encrypted). Works in browsers (CompressionStream) and Node
// (CompressionStream since Node 18; node:zlib as a fallback, loaded
// lazily so the admin bundle never references it).

import { decryptBytes, encryptBytes, isEncrypted, type EncryptionParams } from "../../shared/crypto";

const GZIP_MAGIC = [0x1f, 0x8b];

function hasCompressionStream(): boolean {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
}

async function nodeZlib(): Promise<{ gzipSync(b: Uint8Array): Uint8Array; gunzipSync(b: Uint8Array): Uint8Array }> {
  const specifier = "node:zlib";
  return (await import(/* @vite-ignore */ specifier)) as { gzipSync(b: Uint8Array): Uint8Array; gunzipSync(b: Uint8Array): Uint8Array };
}

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (hasCompressionStream()) return pipe(bytes, new CompressionStream("gzip"));
  return new Uint8Array((await nodeZlib()).gzipSync(bytes));
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (hasCompressionStream()) return pipe(bytes, new DecompressionStream("gzip"));
  return new Uint8Array((await nodeZlib()).gunzipSync(bytes));
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
}

export interface CodecKey {
  passphrase: string;
  params: EncryptionParams;
}

// `key` null → plain gzip (unencrypted dataset).
export async function encodeJson(value: unknown, key: CodecKey | null): Promise<Uint8Array> {
  const compressed = await gzip(new TextEncoder().encode(JSON.stringify(value)));
  return key ? encryptBytes(compressed, key.passphrase, key.params) : compressed;
}

// Accepts encrypted, gzip or plain JSON bytes (whatever the dataset's
// current mode, older files may differ).
export async function decodeJson<T>(bytes: Uint8Array, passphrase: string | null): Promise<T> {
  let data = bytes;
  if (isEncrypted(data)) data = await decryptBytes(data, passphrase);
  if (isGzip(data)) data = await gunzip(data);
  return JSON.parse(new TextDecoder().decode(data)) as T;
}
