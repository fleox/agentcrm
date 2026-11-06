import { describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "../../lib/runtimeConfig";
import { createFirebaseStoreWith } from "../firebase";
import { createMemoryFirebaseApi } from "../firebase/memoryApi";
import { createHttpFileStore, FileEndpointError, resolveFilesEndpoint } from "./http";
import { fileStoreOf, FileStoreUnavailableError } from "./index";

// In-memory files endpoint following the protocol of http.ts.
function fakeEndpoint(opts: { token?: string; status?: number } = {}) {
  const blobs = new Map<string, { bytes: Uint8Array; mime: string; name: string | null }>();
  const calls: { method: string; url: string; auth: string | null }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ method, url, auth: headers.get("Authorization") });
    if (opts.status) return new Response(JSON.stringify({ error: "no storage" }), { status: opts.status });
    if (headers.get("Authorization") !== `Bearer ${opts.token ?? "tok"}`) return new Response(JSON.stringify({ error: "invalid token" }), { status: 401 });
    const id = url.replace(/^https:\/\/crm\.test\/crm\/files\/?/, "");
    if (method === "PUT") {
      const name = headers.get("X-File-Name");
      blobs.set(id, { bytes: new Uint8Array(init!.body as Uint8Array), mime: headers.get("Content-Type") ?? "", name: name ? decodeURIComponent(name) : null });
      return new Response(null, { status: 204 });
    }
    if (method === "DELETE") return new Response(null, { status: blobs.delete(id) ? 204 : 404 });
    if (!id) return Response.json({ ids: [...blobs.keys()] });
    const b = blobs.get(id);
    return b ? new Response(b.bytes as BodyInit, { status: 200 }) : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { blobs, calls, fetchFn };
}

describe("http file store", () => {
  it("puts, reads, lists and deletes through the endpoint with the ID token", async () => {
    const ep = fakeEndpoint();
    const files = createHttpFileStore({ endpoint: "https://crm.test/crm/files/", token: async () => "tok", fetch: ep.fetchFn });
    await files.put("f1", new Uint8Array([1, 2, 3]), { name: "Compte rendu été.pdf", mime: "application/pdf" });
    expect(ep.blobs.get("f1")).toMatchObject({ mime: "application/pdf", name: "Compte rendu été.pdf" });
    expect([...(await files.get("f1"))!]).toEqual([1, 2, 3]);
    expect(await files.get("nope")).toBeNull();
    expect(await files.list!()).toEqual(["f1"]);
    await files.delete("f1");
    await files.delete("f1");
    expect(ep.blobs.size).toBe(0);
    expect(ep.calls.every((c) => c.auth === "Bearer tok")).toBe(true);
    expect(ep.calls[0].url).toBe("https://crm.test/crm/files/f1");
  });

  it("refuses bad ids before any request, and needs a signed-in user", async () => {
    const ep = fakeEndpoint();
    const files = createHttpFileStore({ endpoint: "https://crm.test/crm/files", token: async () => null, fetch: ep.fetchFn });
    await expect(files.get("../etc")).rejects.toThrow(/Invalid file id/);
    await expect(files.get("f1")).rejects.toBeInstanceOf(FileEndpointError);
    expect(ep.calls).toHaveLength(0);
  });

  it("reports refusals with the endpoint's message, and 503 as storage unavailable", async () => {
    const denied = createHttpFileStore({ endpoint: "https://crm.test/crm/files", token: async () => "wrong", fetch: fakeEndpoint().fetchFn });
    await expect(denied.put("f1", new Uint8Array([1]))).rejects.toThrow(/invalid token/);
    const off = createHttpFileStore({ endpoint: "https://crm.test/crm/files", token: async () => "tok", fetch: fakeEndpoint({ status: 503 }).fetchFn });
    await expect(off.get("f1")).rejects.toBeInstanceOf(FileStoreUnavailableError);
  });

  it("resolves a relative endpoint against the page only", () => {
    expect(resolveFilesEndpoint("https://crm.test/crm/files/")).toBe("https://crm.test/crm/files");
    const g = globalThis as { location?: unknown };
    const saved = g.location;
    try {
      g.location = { href: "https://hermes.test/crm/" };
      expect(resolveFilesEndpoint("files")).toBe("https://hermes.test/crm/files");
      g.location = undefined;
      expect(() => resolveFilesEndpoint("files")).toThrow(FileStoreUnavailableError);
    } finally {
      g.location = saved;
    }
  });

  it("firebase backend: the runtime config's files endpoint replaces Firebase Storage", async () => {
    const cfg = parseRuntimeConfig({ backend: "firebase", firebase: { apiKey: "k", projectId: "p" }, files: { endpoint: " files " } });
    expect(cfg).toMatchObject({ files: { endpoint: "files" } });
    expect(parseRuntimeConfig({ backend: "firebase", firebase: { apiKey: "k", projectId: "p" }, files: { endpoint: "" } })).not.toHaveProperty("files");
    const api = createMemoryFirebaseApi();
    const ep = fakeEndpoint({ token: "memory-token:u1" });
    api.signInAs({ uid: "u1", email: "ada@acme.test", displayName: "Ada", emailVerified: true });
    const store = createFirebaseStoreWith({
      api,
      files: createHttpFileStore({ endpoint: "https://crm.test/crm/files", token: () => api.auth.idToken(), fetch: ep.fetchFn }),
    });
    const files = fileStoreOf(store);
    expect(files.kind).toBe("http");
    await files.put("f2", new Uint8Array([9]));
    expect(ep.blobs.has("f2")).toBe(true);
  });
});
