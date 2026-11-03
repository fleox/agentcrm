// Browser state of the integrations feature.
//
// - Settings (client ids, tenant, toggles) are NOT secrets: they live per
//   browser in localStorage under `agentcrm.integrations.settings`. An
//   admin can also share the client ids with the team through the
//   `config/integrations` doc (public values only); a local value wins.
// - OAuth tokens live in sessionStorage only (`agentcrm.integrations.token.<provider>`)
//   + memory: they die with the tab and are never written to the CRM data.

import { useSyncExternalStore } from "react";
import type { IntegrationProvider } from "../../ops/integrations";

export const STORAGE_PREFIX = "agentcrm.integrations.";
const SETTINGS_KEY = `${STORAGE_PREFIX}settings`;
const tokenKey = (p: IntegrationProvider) => `${STORAGE_PREFIX}token.${p}`;

export interface IntegrationSettings {
  googleClientId: string;
  microsoftClientId: string;
  microsoftTenant: string;
  // Log emails sent from the record composer to the timeline.
  autoLog: boolean;
  // Sync meetings (past 30 / next 30 days) once per session when connected.
  autoSyncMeetings: boolean;
}

// Shape of the shared `config/integrations` doc (public values only).
export interface SharedIntegrationConfig {
  googleClientId?: string;
  microsoftClientId?: string;
  microsoftTenant?: string;
}

export const DEFAULT_INTEGRATION_SETTINGS: IntegrationSettings = {
  googleClientId: "",
  microsoftClientId: "",
  microsoftTenant: "",
  autoLog: true,
  autoSyncMeetings: false,
};

export interface StoredToken {
  provider: IntegrationProvider;
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  // Mailbox address of the connected account.
  account?: string;
  scope?: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
function notify(): void {
  version++;
  for (const l of listeners) l();
}
function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function safeGet(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}
function safeSet(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // storage unavailable (private mode…): memory only
  }
}
const local = () => window.localStorage;
const session = () => window.sessionStorage;

// ─── Settings ────────────────────────────────────────────────────────────

let settingsCache: IntegrationSettings | null = null;

export function getIntegrationSettings(): IntegrationSettings {
  if (settingsCache) return settingsCache;
  let parsed: Partial<IntegrationSettings> = {};
  try {
    parsed = JSON.parse(safeGet(local, SETTINGS_KEY) ?? "{}") as Partial<IntegrationSettings>;
  } catch {
    parsed = {};
  }
  settingsCache = { ...DEFAULT_INTEGRATION_SETTINGS, ...parsed };
  return settingsCache;
}

export function saveIntegrationSettings(patch: Partial<IntegrationSettings>): IntegrationSettings {
  const next = { ...getIntegrationSettings(), ...patch };
  for (const k of ["googleClientId", "microsoftClientId", "microsoftTenant"] as const) next[k] = next[k].trim();
  settingsCache = next;
  safeSet(local, SETTINGS_KEY, JSON.stringify(next));
  notify();
  return next;
}

// Local value, else the team-shared one.
export function effectiveSettings(shared?: SharedIntegrationConfig | null): IntegrationSettings {
  const s = getIntegrationSettings();
  return {
    ...s,
    googleClientId: s.googleClientId || shared?.googleClientId?.trim() || "",
    microsoftClientId: s.microsoftClientId || shared?.microsoftClientId?.trim() || "",
    microsoftTenant: s.microsoftTenant || shared?.microsoftTenant?.trim() || "",
  };
}

// ─── Tokens (sessionStorage + memory) ────────────────────────────────────

const tokens = new Map<IntegrationProvider, StoredToken | null>();

export function getStoredToken(provider: IntegrationProvider): StoredToken | null {
  if (!tokens.has(provider)) {
    let t: StoredToken | null = null;
    try {
      t = JSON.parse(safeGet(session, tokenKey(provider)) ?? "null") as StoredToken | null;
    } catch {
      t = null;
    }
    tokens.set(provider, t);
  }
  return tokens.get(provider) ?? null;
}

export function setStoredToken(provider: IntegrationProvider, token: StoredToken | null): void {
  tokens.set(provider, token);
  safeSet(session, tokenKey(provider), token ? JSON.stringify(token) : null);
  notify();
}

// Connected = a token exists (it may be expired; Microsoft refreshes,
// Google asks again).
export function isConnected(provider: IntegrationProvider): boolean {
  return !!getStoredToken(provider);
}

export function connectedProviders(): IntegrationProvider[] {
  return (["google", "microsoft"] as const).filter(isConnected);
}

// ─── React bindings ──────────────────────────────────────────────────────

export function useIntegrationState(): { settings: IntegrationSettings; google: StoredToken | null; microsoft: StoredToken | null; connected: IntegrationProvider[]; version: number } {
  const v = useSyncExternalStore(subscribe, () => version, () => version);
  return { settings: getIntegrationSettings(), google: getStoredToken("google"), microsoft: getStoredToken("microsoft"), connected: connectedProviders(), version: v };
}

// Tests only.
export function resetIntegrationStateForTests(): void {
  settingsCache = null;
  tokens.clear();
  notify();
}
