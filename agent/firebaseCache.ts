import { existsSync, rmSync } from "node:fs";
import type { FirebaseCache, FirebaseCacheState } from "../src/data/firebase/cache";
import { homePath, readJsonFile, writeJsonFile } from "./home";

// The CLI's copy of a Firebase dataset (see src/data/firebase/cache.ts):
// ~/.agentcrm/cache/firebase-<project>-<uid>.json, mode 0600 like the
// credentials — it holds CRM data. A command then reads only what changed
// since the previous one instead of the whole dataset (Firestore bills
// every document read; the free plan allows 50k a day).

function cacheFile(key: string): string {
  return homePath("cache", `firebase-${key.replace(/[^a-z0-9._-]+/gi, "_")}.json`);
}

export function fileFirebaseCache(): FirebaseCache {
  return {
    async read(key) {
      try {
        return readJsonFile<FirebaseCacheState | null>(cacheFile(key), null);
      } catch {
        return null; // corrupt: read everything again
      }
    },
    async write(key, state) {
      writeJsonFile(cacheFile(key), state, 0o600);
    },
    async clear(key) {
      const f = cacheFile(key);
      if (existsSync(f)) rmSync(f, { force: true });
    },
  };
}
