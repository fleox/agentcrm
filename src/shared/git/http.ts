import { performRequest } from "../storage/http";
import type { StorageAction } from "../storage/types";

// fetch() through the standard storage error funnel (translated toast +
// StorageError), except for statuses listed in `allow`, which are
// returned to the caller untouched — used where a 404 / 409 / 422 is an
// expected answer (missing branch, empty repo, non-fast-forward ref
// update) rather than a failure worth alerting the user about.
export async function gitFetch(
  action: StorageAction,
  url: string,
  init: RequestInit,
  allow: number[] = [],
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return performRequest(action, () => Promise.reject(err));
  }
  if (res.ok || allow.includes(res.status)) return res;
  return performRequest(action, async () => res);
}

// Runs `worker` over `items` with at most `limit` in flight — keeps
// per-file REST fallbacks from hammering the API.
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}
