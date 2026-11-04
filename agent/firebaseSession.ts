import { existsSync, rmSync } from "node:fs";
import type { FirebaseOptions } from "firebase/app";
import { homePath, readJsonFile, writeJsonFile } from "./home";

// Firebase session of a `firebase:<name>` login, kept between CLI runs
// (mirror of cms-ia agent/firebaseSession.ts): ~/.agentcrm/sessions/
// <account>.json (mode 0600, like credentials.json) holds what the SDK
// would keep in a browser (the user record + its refresh token). The next
// command restores it and at most refreshes its ID token instead of
// signing in again — Firebase rate-limits password sign-ins
// (auth/quota-exceeded after a few dozen quick commands).

interface SavedSession {
  email: string;
  items: Record<string, unknown>;
}

function sessionFile(account: string): string {
  return homePath("sessions", `${account.replace(/[^a-z0-9._-]+/gi, "_")}.json`);
}

export function forgetFirebaseSession(account: string): void {
  const f = sessionFile(account);
  if (existsSync(f)) rmSync(f, { force: true });
}

// A Firebase Auth persistence backed by the session file — the shape of
// the SDK's own persistences. The Node build only offers in-memory.
function filePersistence(account: string, email: string) {
  const file = sessionFile(account);
  const saved = readJsonFile<SavedSession | null>(file, null);
  const items: Record<string, unknown> = saved && saved.email === email ? { ...saved.items } : {};
  const flush = () => {
    if (Object.keys(items).length) writeJsonFile(file, { email, items } satisfies SavedSession, 0o600);
    else forgetFirebaseSession(account);
  };
  return class FileSessionPersistence {
    static type = "LOCAL" as const;
    readonly type = "LOCAL" as const;
    async _isAvailable(): Promise<boolean> {
      return true;
    }
    async _set(key: string, value: unknown): Promise<void> {
      items[key] = value;
      flush();
    }
    async _get<T>(key: string): Promise<T | null> {
      return (items[key] as T | undefined) ?? null;
    }
    async _remove(key: string): Promise<void> {
      delete items[key];
      flush();
    }
    _addListener(): void {}
    _removeListener(): void {}
  };
}

// Gives the project's Firebase app (the one src/data/firebase/sdk.ts
// uses) a file-backed Auth before the store is created: getAuth() then
// returns this instance, and signInWithSecrets() reuses a restored session
// of the same address. No-op when Auth already exists in this process.
export async function prepareFirebaseSession(account: string, options: FirebaseOptions, email: string): Promise<void> {
  const { getFirebaseApp } = await import("../src/data/firebase/sdk");
  const { initializeAuth } = await import("firebase/auth");
  type Persistence = NonNullable<Parameters<typeof initializeAuth>[1]>["persistence"];
  try {
    initializeAuth(getFirebaseApp(options), { persistence: filePersistence(account, email.trim().toLowerCase()) as unknown as Persistence });
  } catch {
    // Already initialised in this process (getAuth or an earlier call).
  }
}
