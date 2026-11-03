// Full-text search over records (label, email, domain, phone, plus every
// text-ish field) and activities (title), with MiniSearch. Built from the
// in-memory dataset; updated incrementally by callers that track changes
// (CrmDataContext rebuilds on change — it's fast for tens of thousands).

import MiniSearch from "minisearch";
import type { Activity, CrmRecord, ObjectDef } from "./types";
import { normalizeDomain, recordLabel } from "./fields";

export interface SearchHit {
  kind: "record" | "activity";
  id: string;
  // Record object id, or "activities".
  object: string;
  label: string;
  // Secondary line (email / domain / activity type).
  sub?: string;
  score: number;
}

export interface SearchOptions {
  // Restrict to these object ids (records) — "activities" includes activities.
  objects?: string[];
  limit?: number;
  // Include soft-deleted records (default false).
  includeDeleted?: boolean;
}

interface IndexedDoc {
  key: string;
  kind: "record" | "activity";
  id: string;
  object: string;
  label: string;
  email: string;
  domain: string;
  phone: string;
  text: string;
  sub: string;
  deleted: boolean;
}

const TEXT_TYPES = new Set(["text", "email", "phone", "url", "tags", "select", "multiSelect"]);

function recordDoc(object: ObjectDef | undefined, r: CrmRecord): IndexedDoc {
  const f = r.fields;
  const email = typeof f.email === "string" ? f.email : "";
  const domainRaw = typeof f.domain === "string" ? f.domain : "";
  const phone = typeof f.phone === "string" ? f.phone : "";
  const extra: string[] = [];
  for (const field of object?.fields ?? []) {
    if (!TEXT_TYPES.has(field.type)) continue;
    const v = f[field.id];
    if (field.type === "select") {
      const o = field.options?.find((x) => x.id === v);
      if (o) extra.push(o.label);
    } else if (Array.isArray(v)) extra.push(...v.map(String));
    else if (typeof v === "string") extra.push(v);
  }
  const domain = normalizeDomain(domainRaw);
  return {
    key: `r:${r.id}`,
    kind: "record",
    id: r.id,
    object: r.object,
    label: recordLabel(object, r),
    email,
    // "acme.com" + "acme" so a search for the brand finds the domain.
    domain: domain ? `${domain} ${domain.split(".")[0]}` : "",
    phone: phone.replace(/[^\d+]/g, ""),
    text: extra.join(" "),
    sub: email || domain || "",
    deleted: !!r.deletedAt,
  };
}

function activityDoc(a: Activity): IndexedDoc {
  return {
    key: `a:${a.id}`,
    kind: "activity",
    id: a.id,
    object: "activities",
    label: a.title,
    email: "",
    domain: "",
    phone: "",
    text: (a.body ?? "").slice(0, 500),
    sub: a.type,
    deleted: !!a.deletedAt,
  };
}

export interface CrmSearchIndex {
  search(query: string, opts?: SearchOptions): SearchHit[];
  upsertRecord(record: CrmRecord): void;
  removeRecord(id: string): void;
  upsertActivity(activity: Activity): void;
  removeActivity(id: string): void;
  readonly size: number;
}

export function buildSearchIndex(input: { objects: ObjectDef[]; records: CrmRecord[]; activities?: Activity[] }): CrmSearchIndex {
  const objects = new Map(input.objects.map((o) => [o.id, o]));
  const mini = new MiniSearch<IndexedDoc>({
    idField: "key",
    fields: ["label", "email", "domain", "phone", "text"],
    storeFields: ["kind", "id", "object", "label", "sub", "deleted"],
    searchOptions: {
      boost: { label: 3, email: 2, domain: 2, phone: 1.5, text: 0.5 },
      prefix: true,
      fuzzy: (term) => (term.length > 3 ? 0.2 : false),
      combineWith: "AND",
    },
    // Accent-insensitive.
    processTerm: (term) =>
      term
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase(),
  });
  mini.addAll([...input.records.map((r) => recordDoc(objects.get(r.object), r)), ...(input.activities ?? []).map(activityDoc)]);

  function upsert(doc: IndexedDoc) {
    if (mini.has(doc.key)) mini.replace(doc);
    else mini.add(doc);
  }

  return {
    get size() {
      return mini.documentCount;
    },
    search(query, opts = {}) {
      const q = query.trim();
      if (!q) return [];
      const phoneDigits = q.replace(/[^\d+]/g, "");
      const queryText = /^[+\d\s().-]{4,}$/.test(q) ? phoneDigits : q;
      const results = mini.search(queryText, {
        filter: (r) =>
          (opts.includeDeleted || !r.deleted) &&
          (!opts.objects || opts.objects.includes(r.object as string)),
      });
      return results.slice(0, opts.limit ?? 20).map((r) => ({
        kind: r.kind as SearchHit["kind"],
        id: r.id as string,
        object: r.object as string,
        label: r.label as string,
        sub: (r.sub as string) || undefined,
        score: r.score,
      }));
    },
    upsertRecord(record) {
      upsert(recordDoc(objects.get(record.object), record));
    },
    removeRecord(id) {
      if (mini.has(`r:${id}`)) mini.discard(`r:${id}`);
    },
    upsertActivity(activity) {
      upsert(activityDoc(activity));
    },
    removeActivity(id) {
      if (mini.has(`a:${id}`)) mini.discard(`a:${id}`);
    },
  };
}
