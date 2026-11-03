import { base64ToBytes } from "../../git/encoding";
import { mapLimit } from "../../git/http";
import { performRequest } from "../http";
import { cacheControlFor, contentTypeFor } from "../mime";
import type { StorageConnectorFactory } from "../registry";
import { rfc3986, signRequest } from "../sigv4";
import { StorageError, type ListItem, type StorageConnector } from "../types";

// S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2, OVHcloud,
// Scaleway, Wasabi, MinIO…), SigV4-signed from the browser. Copied from
// cms-ia (see SHARED.md); listPrefix() added for the journal backend.
//
// Prerequisites on the bucket:
//   - a CORS rule allowing the admin's origin with GET / PUT / DELETE
//     and the `authorization`, `content-type`, `cache-control`,
//     `x-amz-*` headers;
//   - an access key restricted to this bucket (incl. ListBucket — the
//     journal backend lists its segments);
//   - for hosting the admin / forms: static website hosting (or a CDN
//     rule) so `/forms/x/` serves `/forms/x/index.html`.

export interface S3Settings {
  // e.g. https://s3.eu-west-3.amazonaws.com, https://<account>.r2.cloudflarestorage.com
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  // Key prefix inside the bucket ("" = bucket root).
  prefix?: string;
  // Public URL the bucket / CDN serves files at ("" for a private data
  // bucket used only by the journal backend).
  siteUrl?: string;
  // Send `x-amz-acl: public-read` on uploads, for buckets that aren't
  // public through a bucket policy (common on OVHcloud / Scaleway).
  // Leave off on AWS buckets with "Object Ownership: bucket owner
  // enforced", which reject ACL headers.
  publicRead?: boolean;
  // Path-style (https://endpoint/bucket/key) vs virtual-hosted
  // (https://bucket.endpoint/key). Defaults: virtual-hosted on AWS,
  // path-style elsewhere (R2, MinIO and most compatibles expect it).
  forcePathStyle?: boolean;
}

// Unsigned payloads are accepted over HTTPS by S3 and compatibles, and
// spare hashing every uploaded image in the browser.
const UNSIGNED = "UNSIGNED-PAYLOAD";

function encodeKey(key: string): string {
  return key.split("/").map(rfc3986).join("/");
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function createS3Connector(settings: S3Settings): StorageConnector {
  const endpoint = (settings.endpoint || `https://s3.${settings.region}.amazonaws.com`).replace(/\/+$/, "");
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new StorageError(`Invalid S3 endpoint: ${endpoint}`, 400);
  }
  const pathStyle = settings.forcePathStyle ?? !endpointUrl.hostname.endsWith("amazonaws.com");
  const bucketBase = pathStyle
    ? `${endpoint}/${rfc3986(settings.bucket)}`
    : `${endpointUrl.protocol}//${settings.bucket}.${endpointUrl.host}`;
  const prefix = (settings.prefix ?? "").replace(/^\/+|\/+$/g, "");
  const siteUrl = (settings.siteUrl ?? "").replace(/\/+$/, "");
  const credentials = {
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    region: settings.region || "us-east-1",
    service: "s3",
  };

  const keyFor = (path: string) => (prefix ? `${prefix}/${path.replace(/^\/+/, "")}` : path.replace(/^\/+/, ""));
  const pathFor = (key: string) => (prefix ? key.slice(prefix.length + 1) : key);

  async function send(
    action: "upload" | "get" | "delete" | "list" | "deleteFolder",
    method: string,
    url: string,
    init: { headers?: Record<string, string>; body?: BodyInit; signal?: AbortSignal; cache?: RequestCache } = {},
  ): Promise<Response> {
    const headers = await signRequest({
      method,
      url,
      headers: { "x-amz-content-sha256": UNSIGNED, ...(init.headers ?? {}) },
      payloadHash: UNSIGNED,
      credentials,
    });
    return performRequest(action, () =>
      fetch(url, { method, headers, body: init.body, signal: init.signal, cache: init.cache }),
    );
  }

  async function listKeys(under: string): Promise<Array<{ key: string; size: number }>> {
    const out: Array<{ key: string; size: number }> = [];
    let token: string | undefined;
    do {
      const params = new URLSearchParams({ "list-type": "2", "max-keys": "1000" });
      if (under) params.set("prefix", under);
      if (token) params.set("continuation-token", token);
      const res = await send("list", "GET", `${bucketBase}/?${params}`, { cache: "no-store" });
      const xml = await res.text();
      for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
        const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
        const size = Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0);
        if (key) out.push({ key: decodeXml(key), size });
      }
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      token = truncated ? decodeXml(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? "") : undefined;
    } while (token);
    return out;
  }

  async function deleteKey(key: string, signal?: AbortSignal): Promise<void> {
    try {
      await send("delete", "DELETE", `${bucketBase}/${encodeKey(key)}`, { signal });
    } catch (err) {
      // S3 answers 204 for missing keys; some compatibles answer 404.
      if (err instanceof StorageError && err.status === 404) return;
      throw err;
    }
  }

  return {
    id: "s3",
    model: "files",
    capabilities: {
      list: true,
      rename: false,
      renameFolder: false,
      folders: false,
      deletePrefix: true,
    },

    async put(input, signal) {
      const body = input.encoding === "base64" ? base64ToBytes(input.content) : input.content;
      await send("upload", "PUT", `${bucketBase}/${encodeKey(keyFor(input.path))}`, {
        headers: {
          "content-type": contentTypeFor(input.path),
          "cache-control": cacheControlFor(input.path),
          ...(settings.publicRead ? { "x-amz-acl": "public-read" } : {}),
        },
        body: body as BodyInit,
        signal,
      });
    },

    async get(path) {
      const res = await send("get", "GET", `${bucketBase}/${encodeKey(keyFor(path))}`, { cache: "no-store" });
      return res.text();
    },

    async getBytes(path) {
      const url = `${bucketBase}/${encodeKey(keyFor(path))}`;
      const headers = await signRequest({
        method: "GET",
        url,
        headers: { "x-amz-content-sha256": UNSIGNED },
        payloadHash: UNSIGNED,
        credentials,
      });
      const res = await fetch(url, { headers, cache: "no-store" }).catch((err) =>
        performRequest("get", () => Promise.reject(err)),
      );
      if (res.status === 404 || res.status === 403) {
        // S3 answers 403 for a missing key when the credentials lack
        // ListBucket — treat both as "not there yet".
        return null;
      }
      const ok = res.ok ? res : await performRequest("get", async () => res);
      return new Uint8Array(await ok.arrayBuffer());
    },

    delete: (path, signal) => deleteKey(keyFor(path), signal),

    async deletePrefix(path) {
      const keys = await listKeys(keyFor(path).replace(/\/+$/, "") + "/");
      await mapLimit(keys, 6, (k) => deleteKey(k.key));
    },

    async list(page, perPage) {
      const all: ListItem[] = (await listKeys(prefix ? `${prefix}/` : ""))
        .map((k) => ({ path: pathFor(k.key), type: "file" as const, size: k.size, url: `${siteUrl}/${pathFor(k.key)}` }));
      return { items: all.slice((page - 1) * perPage, page * perPage), page, per_page: perPage, total: all.length };
    },

    async listPrefix(under) {
      const clean = under.replace(/^\/+/, "");
      return (await listKeys(keyFor(clean)))
        .map((k) => pathFor(k.key))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    },

    async publicUrl(path) {
      return `${siteUrl}/${path.replace(/^\/+/, "")}`;
    },
  };
}

export const s3Factory: StorageConnectorFactory<S3Settings> = {
  id: "s3",
  create: createS3Connector,
};
