// Uniform auth state for every backend. The signed-in CrmUser comes from
// store.identity() mapped by ./auth.ts. Backends with accounts register a
// sign-out handler (registerAuthAdapter) from their own files; the login
// screen is the `loginScreen` slot of a feature (setup).

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { CrmUser, UserRole } from "../core/types";
import type { StoreIdentity } from "../data/types";
import type { RuntimeBackendKind } from "../lib/runtimeConfig";

export interface AuthAdapter {
  signOut(): Promise<void>;
}

const adapters = new Map<string, AuthAdapter>();

// Called by backend modules (e.g. src/data/firebase.ts) at import time.
export function registerAuthAdapter(backend: RuntimeBackendKind | (string & {}), adapter: AuthAdapter): void {
  adapters.set(backend, adapter);
}

export function getAuthAdapter(backend: string): AuthAdapter | undefined {
  return adapters.get(backend);
}

export interface AuthValue {
  backend: RuntimeBackendKind;
  identity: StoreIdentity;
  user: CrmUser;
  role: UserRole;
  isAdmin: boolean;
  // Backends without accounts (local, journal) have no sign-out button;
  // journal offers "lock" (forget this browser's passphrase) instead.
  canSignOut: boolean;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({
  backend,
  identity,
  user,
  onSignOut,
  children,
}: {
  backend: RuntimeBackendKind;
  identity: StoreIdentity;
  user: CrmUser;
  onSignOut(): Promise<void>;
  children: ReactNode;
}) {
  const value = useMemo<AuthValue>(
    () => ({
      backend,
      identity,
      user,
      role: user.role,
      isAdmin: user.role === "admin",
      canSignOut: backend !== "local",
      signOut: onSignOut,
    }),
    [backend, identity, user, onSignOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function useOptionalAuth(): AuthValue | null {
  return useContext(AuthContext);
}
