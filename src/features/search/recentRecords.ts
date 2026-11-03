// Recently visited records (most recent first), persisted per browser in
// localStorage "agentcrm.recentRecords". Storage failures are ignored.

export interface RecentRecord {
  object: string;
  id: string;
  at: number;
}

export const RECENT_KEY = "agentcrm.recentRecords";
export const RECENT_MAX = 8;

const RECORD_PATH = /^\/objects\/([^/?#]+)\/([^/?#]+)\/?$/;

// "/objects/companies/abc" → { object, id }.
export function parseRecordPath(pathname: string): { object: string; id: string } | null {
  const m = RECORD_PATH.exec(pathname);
  if (!m) return null;
  try {
    return { object: decodeURIComponent(m[1]), id: decodeURIComponent(m[2]) };
  } catch {
    return null;
  }
}

export function readRecent(): RecentRecord[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is RecentRecord => !!x && typeof x === "object" && typeof (x as RecentRecord).object === "string" && typeof (x as RecentRecord).id === "string")
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export function pushRecent(entry: { object: string; id: string }, now = Date.now()): RecentRecord[] {
  const next = [{ object: entry.object, id: entry.id, at: now }, ...readRecent().filter((r) => r.id !== entry.id)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Not persisted.
  }
  return next;
}
