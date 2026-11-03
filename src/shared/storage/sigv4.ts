// AWS Signature Version 4 over WebCrypto — enough for S3-compatible
// APIs called from the browser (AWS S3, Cloudflare R2, Backblaze B2,
// OVH, Scaleway, MinIO…). No SDK: the whole signer is ~60 lines.

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

const enc = new TextEncoder();

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(data)));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
}

// RFC 3986 encoding as SigV4 expects it (unreserved chars kept).
export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function amzDates(date: Date): { amzDate: string; dateStamp: string } {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

// Returns the headers to send: the caller's headers plus x-amz-date and
// Authorization. `url` must already have its path encoded the way it
// will be sent; the query string is re-canonicalised here.
export async function signRequest(args: {
  method: string;
  url: string;
  headers: Record<string, string>;
  payloadHash: string;
  credentials: SigV4Credentials;
  date?: Date;
}): Promise<Record<string, string>> {
  const url = new URL(args.url);
  const { amzDate, dateStamp } = amzDates(args.date ?? new Date());
  const headers: Record<string, string> = { ...args.headers, "x-amz-date": amzDate };

  const signed: Record<string, string> = { host: url.host };
  for (const [k, v] of Object.entries(headers)) signed[k.toLowerCase()] = String(v).trim().replace(/\s+/g, " ");
  const names = Object.keys(signed).sort();
  const canonicalHeaders = names.map((n) => `${n}:${signed[n]}\n`).join("");
  const signedHeaders = names.join(";");

  const query = [...url.searchParams.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    args.method.toUpperCase(),
    url.pathname || "/",
    query,
    canonicalHeaders,
    signedHeaders,
    args.payloadHash,
  ].join("\n");

  const { accessKeyId, secretAccessKey, region, service } = args.credentials;
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");

  let key = await hmac(enc.encode(`AWS4${secretAccessKey}`), dateStamp);
  key = await hmac(key, region);
  key = await hmac(key, service);
  key = await hmac(key, "aws4_request");
  const signature = hex(await hmac(key, stringToSign));

  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
