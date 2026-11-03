// In-memory S3-compatible service for tests (adapted from cms-ia
// agent/testing/fakeS3.ts): path-style API at
// https://s3.fake.test/<bucket>/<key> (signature checked for the access
// key id only), CORS preflights answered from each bucket's rule, and
// static website hosting of PUBLIC buckets at
// https://<bucket>.website.fake.test/ (index.html for folders). Install
// as `fetch` in tests.

interface StoredObject {
  body: Uint8Array;
  contentType: string;
}

interface Bucket {
  public: boolean;
  cors: string[];
  objects: Map<string, StoredObject>;
}

export interface FakeS3 {
  fetch: typeof fetch;
  createBucket(name: string, opts?: { public?: boolean; corsOrigins?: string[] }): void;
  object(bucket: string, key: string): StoredObject | undefined;
  text(bucket: string, key: string): string | null;
  keys(bucket: string): string[];
  endpoint: string;
  websiteUrl(bucket: string): string;
  requests: string[];
}

async function bodyBytes(body: unknown): Promise<Uint8Array> {
  if (body == null) return new Uint8Array();
  if (body instanceof Uint8Array) return new Uint8Array(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof Blob !== "undefined" && body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  return new TextEncoder().encode(String(body));
}

export function createFakeS3(opts: { accessKeyId: string }): FakeS3 {
  const buckets = new Map<string, Bucket>();
  const requests: string[] = [];
  const xml = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "application/xml" } });
  const error = (code: string, status: number) => xml(`<?xml version="1.0"?><Error><Code>${code}</Code></Error>`, status);

  const impl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    requests.push(`${method} ${url.hostname}${url.pathname}`);

    const site = /^(.+)\.website\.fake\.test$/.exec(url.hostname);
    if (site) {
      const bucket = buckets.get(site[1]);
      if (!bucket?.public) return error("AccessDenied", 403);
      let key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      if (key === "" || key.endsWith("/")) key += "index.html";
      const obj = bucket.objects.get(key);
      return obj ? new Response(obj.body.slice(), { headers: { "content-type": obj.contentType } }) : error("NoSuchKey", 404);
    }

    if (url.hostname !== "s3.fake.test") throw new TypeError(`fake s3: unexpected host ${url.hostname}`);
    const [, bucketName, ...rest] = url.pathname.split("/");
    const bucket = buckets.get(bucketName);
    if (method === "OPTIONS") {
      const origin = new Headers(init.headers).get("origin") ?? "";
      if (bucket && (bucket.cors.includes(origin) || bucket.cors.includes("*"))) {
        return new Response(null, { status: 200, headers: { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, PUT, DELETE, HEAD" } });
      }
      return error("CORSResponse", 403);
    }
    const auth = new Headers(init.headers).get("authorization") ?? "";
    if (!auth.startsWith(`AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/`)) return error("InvalidAccessKeyId", 403);
    if (!bucket) return error("NoSuchBucket", 404);
    const key = rest.map(decodeURIComponent).join("/");

    if (method === "GET" && !key) {
      const prefix = url.searchParams.get("prefix") ?? "";
      const items = [...bucket.objects].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1));
      return xml(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated><KeyCount>${items.length}</KeyCount>${items.map(([k, o]) => `<Contents><Key>${k}</Key><Size>${o.body.length}</Size></Contents>`).join("")}</ListBucketResult>`);
    }
    if (method === "PUT") {
      bucket.objects.set(key, { body: await bodyBytes(init.body), contentType: new Headers(init.headers).get("content-type") ?? "application/octet-stream" });
      return new Response(null, { status: 200 });
    }
    if (method === "GET" || method === "HEAD") {
      const obj = bucket.objects.get(key);
      if (!obj) return error("NoSuchKey", 404);
      return new Response(method === "HEAD" ? null : obj.body.slice(), { headers: { "content-type": obj.contentType } });
    }
    if (method === "DELETE") {
      bucket.objects.delete(key);
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && url.searchParams.has("delete")) {
      const text = new TextDecoder().decode(await bodyBytes(init.body));
      for (const m of text.matchAll(/<Key>([^<]+)<\/Key>/g)) bucket.objects.delete(m[1]);
      return xml(`<?xml version="1.0"?><DeleteResult></DeleteResult>`);
    }
    return error("NotImplemented", 501);
  };

  return {
    fetch: impl as typeof fetch,
    endpoint: "https://s3.fake.test",
    websiteUrl: (bucket) => `https://${bucket}.website.fake.test`,
    requests,
    createBucket(name, o = {}) {
      buckets.set(name, { public: !!o.public, cors: o.corsOrigins ?? [], objects: new Map() });
    },
    object: (bucket, key) => buckets.get(bucket)?.objects.get(key),
    text: (bucket, key) => {
      const o = buckets.get(bucket)?.objects.get(key);
      return o ? new TextDecoder().decode(o.body) : null;
    },
    keys: (bucket) => [...(buckets.get(bucket)?.objects.keys() ?? [])].sort(),
  };
}
