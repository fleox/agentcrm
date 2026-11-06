// HTTP FileStore: the bytes go through a files endpoint the deployment
// runs next to the admin (e.g. a gateway that encrypts them and keeps them
// on an S3 bucket), never to the browser's storage SDK. Used by the
// firebase backend when the runtime config has `files.endpoint`, instead
// of Firebase Storage.
//
// Protocol (every request carries `Authorization: Bearer <Firebase ID
// token>`; the endpoint checks it and the caller's CRM role):
//
//   PUT    <endpoint>/<id>   body = the bytes, Content-Type = the MIME,
//                            X-File-Name = the name (URI-encoded)  → 2xx
//   GET    <endpoint>/<id>   → 200 bytes | 404
//   DELETE <endpoint>/<id>   → 2xx (also when already gone) | 404
//   GET    <endpoint>/       → 200 {"ids": ["…"]} (admins; purge of orphans)
//
// 503 means the endpoint has no storage configured.

import type { FileStore } from "../types";
import { assertFileId } from "./ids";
import { FileStoreUnavailableError } from "./index";

export interface HttpFileStoreOptions {
  // Absolute URL, or relative to the page (resolved against location.href).
  endpoint: string;
  // Current ID token of the signed-in user (null when signed out).
  token(): Promise<string | null>;
  fetch?: typeof fetch;
}

export class FileEndpointError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "FileEndpointError";
  }
}

export function resolveFilesEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = typeof location !== "undefined" ? location.href : undefined;
  if (!base) throw new FileStoreUnavailableError(`The files endpoint "${endpoint}" must be an absolute URL here.`);
  return new URL(trimmed, base).toString().replace(/\/+$/, "");
}

export function createHttpFileStore(opts: HttpFileStoreOptions): FileStore {
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let base: string | null = null;
  const url = (id: string) => {
    base ??= resolveFilesEndpoint(opts.endpoint);
    return `${base}/${id}`;
  };

  async function call(method: string, id: string, init: { body?: Uint8Array; headers?: Record<string, string> } = {}): Promise<Response> {
    const token = await opts.token();
    if (!token) throw new FileEndpointError("Sign in to read or store files.", 401);
    let res: Response;
    try {
      res = await doFetch(url(id), {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
        ...(init.body ? { body: init.body as BodyInit } : {}),
        cache: "no-store",
        credentials: "same-origin",
      });
    } catch (err) {
      throw new FileEndpointError(`The files endpoint is unreachable (${(err as Error).message}).`, 0);
    }
    if (res.status === 503) throw new FileStoreUnavailableError(await message(res, "The files endpoint has no storage configured."));
    return res;
  }

  async function message(res: Response, fallback: string): Promise<string> {
    try {
      const text = await res.text();
      try {
        const body = JSON.parse(text) as { error?: string | { message?: string } };
        const e = body.error;
        if (typeof e === "string" && e) return e;
        if (e && typeof e === "object" && e.message) return e.message;
      } catch {
        // Plain text body.
      }
      return text.trim().slice(0, 300) || fallback;
    } catch {
      return fallback;
    }
  }

  async function fail(res: Response, what: string): Promise<never> {
    throw new FileEndpointError(`${what}: ${await message(res, `HTTP ${res.status}`)}`, res.status);
  }

  async function put(id: string, bytes: Uint8Array, meta?: { name?: string; mime?: string }): Promise<void> {
    assertFileId(id);
    const headers: Record<string, string> = { "Content-Type": meta?.mime || "application/octet-stream" };
    if (meta?.name) headers["X-File-Name"] = encodeURIComponent(meta.name);
    const res = await call("PUT", id, { body: bytes, headers });
    if (!res.ok) await fail(res, `Could not store file ${id}`);
  }

  return {
    kind: "http",
    put,
    async putMany(items) {
      for (const it of items) await put(it.id, it.bytes, it.meta);
    },
    async get(id) {
      assertFileId(id);
      const res = await call("GET", id);
      if (res.status === 404) return null;
      if (!res.ok) await fail(res, `Could not read file ${id}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async delete(id) {
      assertFileId(id);
      const res = await call("DELETE", id);
      if (res.status === 404 || res.ok) return;
      await fail(res, `Could not delete file ${id}`);
    },
    async list() {
      const res = await call("GET", "");
      if (!res.ok) await fail(res, "Could not list files");
      const body = (await res.json()) as { ids?: unknown };
      return Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
    },
  };
}
