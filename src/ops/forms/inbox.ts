// Inbox sources: where ingestInbox() reads pending submissions from.
//
//   connectorInboxSource(connector, prefix)   any storage connector with
//     listPrefix / get / delete / put (S3 bucket, git repo, local folder,
//     memory). Files: <prefix><formId>/<createdAt>-<rand>.json. Failed
//     submissions move to <prefix without trailing slash>-failed/….
//   firestoreInboxSource({ projectId, collection, getToken })   Firestore
//     REST API with the signed-in admin's ID token (the public form only
//     has create permission on the collection).
//
// The admin / CLI tell the engine how to open the inbox of a form with
// setInboxSourceResolver() (credentials never live in the form doc).

import type { StorageConnector } from "../../shared/storage/types";
import type { OpsContext } from "../context";
import { DEFAULT_FIREBASE_INBOX, DEFAULT_INBOX_PREFIX, type InboxSource, type InboxSubmission, type LeadFormDoc } from "./types";

export type InboxConnector = Pick<StorageConnector, "get" | "delete" | "put"> & { listPrefix?: StorageConnector["listPrefix"] };

export function normalizePrefix(prefix: string | undefined): string {
  const p = (prefix ?? DEFAULT_INBOX_PREFIX).trim().replace(/^\/+/, "");
  return p ? (p.endsWith("/") ? p : `${p}/`) : "";
}

export function failedPrefix(prefix: string): string {
  return `${prefix.replace(/\/+$/, "") || "inbox"}-failed/`;
}

// Parses one submission file / document body. Returns null when it
// isn't a submission at all.
export function parseSubmission(id: string, raw: unknown): InboxSubmission | null {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.formId !== "string" || !v.data || typeof v.data !== "object" || Array.isArray(v.data)) return null;
  const createdAt = typeof v.createdAt === "number" ? v.createdAt : typeof v.createdAt === "string" ? (/^\d+$/.test(v.createdAt) ? Number(v.createdAt) : Date.parse(v.createdAt) || 0) : 0;
  return {
    id,
    formId: v.formId,
    data: v.data as Record<string, unknown>,
    createdAt,
    ...(v.meta && typeof v.meta === "object" ? { meta: v.meta as Record<string, unknown> } : {}),
  };
}

export function connectorInboxSource(connector: InboxConnector, prefix: string = DEFAULT_INBOX_PREFIX, key = `connector:${prefix}`): InboxSource {
  const root = normalizePrefix(prefix);
  return {
    key,
    async list() {
      if (!connector.listPrefix) throw new Error("This storage can't list files: inbox ingestion needs a connector with listPrefix (S3, git, local folder).");
      const paths = (await connector.listPrefix(root)).filter((p) => p.endsWith(".json") && p.startsWith(root));
      const out: InboxSubmission[] = [];
      for (const path of paths) {
        let text: string;
        try {
          text = await connector.get(path);
        } catch {
          continue;
        }
        const sub = parseSubmission(path, text);
        // Unparseable files are surfaced as failed submissions.
        out.push(sub ?? { id: path, formId: "", data: {}, createdAt: 0, meta: { invalid: true } });
      }
      return out.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    },
    async remove(id) {
      await connector.delete(id);
    },
    async markFailed(id, error) {
      let body = "";
      try {
        body = await connector.get(id);
      } catch {
        // Gone already.
      }
      const target = failedPrefix(root) + id.slice(root.length);
      let payload: unknown;
      try {
        payload = { ...(JSON.parse(body) as object), _error: error };
      } catch {
        payload = { raw: body, _error: error };
      }
      await connector.put({ path: target, content: JSON.stringify(payload, null, 2) });
      await connector.delete(id);
    },
  };
}

// ─── Firestore (REST) ───────────────────────────────────────────────────

type FirestoreValue = Record<string, unknown>;

export function decodeFirestoreValue(v: FirestoreValue | undefined): unknown {
  if (!v || typeof v !== "object") return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("timestampValue" in v) return Date.parse(String(v.timestampValue));
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (((v.arrayValue as { values?: FirestoreValue[] })?.values ?? []) as FirestoreValue[]).map(decodeFirestoreValue);
  if ("mapValue" in v) return decodeFirestoreFields((v.mapValue as { fields?: Record<string, FirestoreValue> })?.fields ?? {});
  return undefined;
}

export function decodeFirestoreFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeFirestoreValue(v)]));
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface FirestoreInboxOptions {
  projectId: string;
  collection?: string;
  // ID token of the signed-in admin (Firebase Auth).
  getToken(): Promise<string | null>;
  fetch?: FetchLike;
}

export function firestoreInboxSource(opts: FirestoreInboxOptions): InboxSource {
  const collection = opts.collection || DEFAULT_FIREBASE_INBOX;
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(opts.projectId)}/databases/(default)/documents`;
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);
  async function call(url: string, init: { method?: string; body?: string } = {}) {
    const token = await opts.getToken();
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await doFetch(url, { ...init, headers });
    if (!res.ok && res.status !== 404) {
      let message = `Firestore answered HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body?.error?.message) message += `: ${body.error.message}`;
      } catch {
        // Not JSON.
      }
      throw new Error(message);
    }
    return res;
  }
  return {
    key: `firestore:${opts.projectId}/${collection}`,
    async list() {
      const out: InboxSubmission[] = [];
      let pageToken = "";
      for (let guard = 0; guard < 50; guard++) {
        const res = await call(`${base}/${encodeURIComponent(collection)}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
        if (res.status === 404) break;
        const body = (await res.json()) as { documents?: { name: string; fields?: Record<string, FirestoreValue> }[]; nextPageToken?: string };
        for (const doc of body.documents ?? []) {
          const fields = decodeFirestoreFields(doc.fields ?? {});
          if (fields.status === "failed") continue;
          const sub = parseSubmission(doc.name, fields);
          out.push(sub ?? { id: doc.name, formId: "", data: {}, createdAt: 0, meta: { invalid: true } });
        }
        pageToken = body.nextPageToken ?? "";
        if (!pageToken) break;
      }
      return out.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    },
    async remove(id) {
      await call(`https://firestore.googleapis.com/v1/${id}`, { method: "DELETE" });
    },
    async markFailed(id, error) {
      try {
        await call(`https://firestore.googleapis.com/v1/${id}?updateMask.fieldPaths=status&updateMask.fieldPaths=error`, {
          method: "PATCH",
          body: JSON.stringify({ fields: { status: { stringValue: "failed" }, error: { stringValue: error.slice(0, 500) } } }),
        });
      } catch {
        // Rules may forbid updates: drop it rather than retrying forever.
        await call(`https://firestore.googleapis.com/v1/${id}`, { method: "DELETE" });
      }
    },
  };
}

// ─── Resolver ───────────────────────────────────────────────────────────

export type InboxSourceResolver = (ctx: OpsContext, form: LeadFormDoc) => Promise<InboxSource | null> | InboxSource | null;

let resolver: InboxSourceResolver | null = null;

// Set by the admin (forms feature) / the CLI: how to open a form's inbox
// with this environment's credentials. Returns null when it can't.
export function setInboxSourceResolver(fn: InboxSourceResolver | null): void {
  resolver = fn;
}

export async function resolveInboxSource(ctx: OpsContext, form: LeadFormDoc): Promise<InboxSource | null> {
  if (form.inbox.kind === "webhook") return null;
  return resolver ? await resolver(ctx, form) : null;
}

// In-memory inbox (tests, demos, JSON imports).
export function memoryInboxSource(submissions: InboxSubmission[], key = "memory"): InboxSource & { failed: { id: string; error: string }[]; items: InboxSubmission[] } {
  const items = [...submissions];
  const failed: { id: string; error: string }[] = [];
  return {
    key,
    items,
    failed,
    async list() {
      return [...items];
    },
    async remove(id) {
      const i = items.findIndex((s) => s.id === id);
      if (i >= 0) items.splice(i, 1);
    },
    async markFailed(id, error) {
      failed.push({ id, error });
      const i = items.findIndex((s) => s.id === id);
      if (i >= 0) items.splice(i, 1);
    },
  };
}
