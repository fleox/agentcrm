// Browser OAuth for the integrations (no server of ours):
// - Google: Google Identity Services token client (implicit access token,
//   ~1 h, no refresh token). The user's own Web OAuth client id.
// - Microsoft: authorization code + PKCE in a popup, code exchanged at
//   /token as a SPA public client; the refresh token stays in
//   sessionStorage with the access token.
// The redirect URI / authorized origin is the admin URL itself.

import {
  buildMicrosoftAuthorizeUrl,
  createPkcePair,
  exchangeMicrosoftCode,
  gmailProfile,
  GOOGLE_SCOPES,
  graphMe,
  IntegrationApiError,
  refreshMicrosoftToken,
  type IntegrationProvider,
} from "../../ops/integrations";
import { getStoredToken, setStoredToken, STORAGE_PREFIX, type IntegrationSettings, type StoredToken } from "./state";

export const OAUTH_MESSAGE_TYPE = "agentcrm.integrations.oauth";
export const STATE_PREFIX = "acrm_";
const PENDING_KEY = `${STORAGE_PREFIX}pending`;

// The admin URL (origin + path, no query / hash): Microsoft redirect URI.
export function adminRedirectUri(loc: Pick<Location, "origin" | "pathname"> = window.location): string {
  return `${loc.origin}${loc.pathname}`;
}

export class NotConnectedError extends Error {
  constructor(readonly provider: IntegrationProvider) {
    super(`${provider === "google" ? "Google" : "Microsoft"} is not connected.`);
    this.name = "NotConnectedError";
  }
}

// ─── Popup callback (runs at module init in the popup window) ───────────

export interface OAuthCallbackMessage {
  type: typeof OAUTH_MESSAGE_TYPE;
  state: string;
  code?: string;
  error?: string;
  errorDescription?: string;
}

// When this window is our Microsoft popup coming back to the admin URL
// with ?code=…&state=…, hand the result to the opener and close. Returns
// true when it did (the caller may skip booting). Safe to call anywhere.
export function handleOAuthPopupCallback(win: Window | undefined = typeof window === "undefined" ? undefined : window): boolean {
  try {
    if (!win || !win.opener || win.opener === win) return false;
    const params = new URLSearchParams(win.location.search);
    const state = params.get("state");
    if (!state || !state.startsWith(STATE_PREFIX) || (!params.has("code") && !params.has("error"))) return false;
    let pending: string | null = null;
    try {
      pending = win.sessionStorage.getItem(PENDING_KEY);
    } catch {
      pending = null;
    }
    // sessionStorage is copied into popups; when present it must match.
    if (pending && pending !== state) return false;
    const message: OAuthCallbackMessage = {
      type: OAUTH_MESSAGE_TYPE,
      state,
      ...(params.get("code") ? { code: params.get("code")! } : {}),
      ...(params.get("error") ? { error: params.get("error")! } : {}),
      ...(params.get("error_description") ? { errorDescription: params.get("error_description")! } : {}),
    };
    (win.opener as Window).postMessage(message, win.location.origin);
    win.close();
    return true;
  } catch {
    return false;
  }
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return STATE_PREFIX + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Opens the popup synchronously (call from a click handler), then waits
// for ?code (postMessage from the popup, or polling its location once it
// is back on our origin).
function waitForPopupCode(popup: Window, state: string, timeoutMs = 5 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      window.clearInterval(timer);
      window.clearTimeout(timeout);
      try {
        popup.close();
      } catch {
        // ignore
      }
      fn();
    };
    const handle = (params: { state?: string | null; code?: string | null; error?: string | null; errorDescription?: string | null }) => {
      if (params.state !== state) return;
      if (params.error) finish(() => reject(new Error(params.errorDescription || params.error || "Sign-in failed.")));
      else if (params.code) finish(() => resolve(params.code!));
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as Partial<OAuthCallbackMessage> | null;
      if (!data || data.type !== OAUTH_MESSAGE_TYPE) return;
      handle(data);
    };
    window.addEventListener("message", onMessage);
    const timer = window.setInterval(() => {
      if (popup.closed) {
        finish(() => reject(new Error("The sign-in window was closed.")));
        return;
      }
      try {
        if (popup.location.origin !== window.location.origin) return;
        const p = new URLSearchParams(popup.location.search);
        handle({ state: p.get("state"), code: p.get("code"), error: p.get("error"), errorDescription: p.get("error_description") });
      } catch {
        // cross-origin while on login.microsoftonline.com
      }
    }, 300);
    const timeout = window.setTimeout(() => finish(() => reject(new Error("Sign-in timed out."))), timeoutMs);
  });
}

// ─── Microsoft ───────────────────────────────────────────────────────────

export async function connectMicrosoft(settings: Pick<IntegrationSettings, "microsoftClientId" | "microsoftTenant">): Promise<StoredToken> {
  const clientId = settings.microsoftClientId.trim();
  if (!clientId) throw new Error("Set your Microsoft application (client) id first.");
  // Open first, synchronously with the click, to dodge popup blockers.
  const popup = window.open("about:blank", "agentcrm-microsoft-signin", "width=520,height=680");
  if (!popup) throw new Error("The sign-in popup was blocked. Allow popups for this site.");
  const state = randomState();
  try {
    window.sessionStorage.setItem(PENDING_KEY, state);
  } catch {
    // ignore
  }
  try {
    const pkce = await createPkcePair();
    const redirectUri = adminRedirectUri();
    popup.location.href = buildMicrosoftAuthorizeUrl({ clientId, tenant: settings.microsoftTenant, redirectUri, state, codeChallenge: pkce.challenge });
    const code = await waitForPopupCode(popup, state);
    const tokens = await exchangeMicrosoftCode({ clientId, tenant: settings.microsoftTenant, redirectUri, code, codeVerifier: pkce.verifier });
    let account: string | undefined;
    try {
      account = (await graphMe(tokens.accessToken)).email || undefined;
    } catch {
      account = undefined;
    }
    const stored: StoredToken = { provider: "microsoft", ...tokens, ...(account ? { account } : {}) };
    setStoredToken("microsoft", stored);
    return stored;
  } catch (err) {
    try {
      popup.close();
    } catch {
      // ignore
    }
    throw err;
  } finally {
    try {
      window.sessionStorage.removeItem(PENDING_KEY);
    } catch {
      // ignore
    }
  }
}

// ─── Google (GIS token client) ───────────────────────────────────────────

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
}
interface GisGoogle {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        prompt?: string;
        login_hint?: string;
        callback: (r: GisTokenResponse) => void;
        error_callback?: (e: { type?: string; message?: string }) => void;
      }): GisTokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}

const GIS_SRC = "https://accounts.google.com/gsi/client";
let gisPromise: Promise<GisGoogle> | null = null;

export function loadGoogleIdentity(): Promise<GisGoogle> {
  const existing = (window as unknown as { google?: GisGoogle }).google;
  if (existing?.accounts?.oauth2) return Promise.resolve(existing);
  if (gisPromise) return gisPromise;
  gisPromise = new Promise<GisGoogle>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const g = (window as unknown as { google?: GisGoogle }).google;
      if (g?.accounts?.oauth2) resolve(g);
      else reject(new Error("Google Identity Services failed to initialise."));
    };
    script.onerror = () => {
      gisPromise = null;
      reject(new Error("Could not load Google Identity Services (blocked by an extension or offline?)."));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

export async function connectGoogle(settings: Pick<IntegrationSettings, "googleClientId">, opts: { prompt?: "" | "consent" | "select_account"; loginHint?: string } = {}): Promise<StoredToken> {
  const clientId = settings.googleClientId.trim();
  if (!clientId) throw new Error("Set your Google OAuth client id first.");
  const google = await loadGoogleIdentity();
  const response = await new Promise<GisTokenResponse>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES.join(" "),
      callback: (r) => (r.error ? reject(new Error(r.error_description || r.error)) : resolve(r)),
      error_callback: (e) => reject(new Error(e.message || e.type || "Google sign-in was cancelled.")),
    });
    client.requestAccessToken({ prompt: opts.prompt ?? "consent", ...(opts.loginHint ? { login_hint: opts.loginHint } : {}) });
  });
  if (!response.access_token) throw new Error("Google returned no access token.");
  const accessToken = response.access_token;
  let account: string | undefined;
  try {
    account = (await gmailProfile(accessToken)).emailAddress?.toLowerCase();
  } catch {
    account = undefined;
  }
  const stored: StoredToken = {
    provider: "google",
    accessToken,
    expiresAt: Date.now() + (Number(response.expires_in) || 3600) * 1000,
    ...(response.scope ? { scope: response.scope } : {}),
    ...(account ? { account } : {}),
  };
  setStoredToken("google", stored);
  return stored;
}

// ─── Tokens for API calls ────────────────────────────────────────────────

const SKEW_MS = 60_000;

// A valid access token: Microsoft refreshes silently; Google re-asks GIS
// (no consent prompt if already granted — may flash a popup, so only
// call this from a user action).
export async function getAccessToken(provider: IntegrationProvider, settings: IntegrationSettings): Promise<string> {
  const token = getStoredToken(provider);
  if (!token) throw new NotConnectedError(provider);
  if (token.expiresAt - SKEW_MS > Date.now()) return token.accessToken;
  if (provider === "microsoft" && token.refreshToken && settings.microsoftClientId) {
    try {
      const next = await refreshMicrosoftToken({ clientId: settings.microsoftClientId, tenant: settings.microsoftTenant, refreshToken: token.refreshToken });
      setStoredToken("microsoft", { ...token, ...next });
      return next.accessToken;
    } catch {
      setStoredToken("microsoft", null);
      throw new NotConnectedError(provider);
    }
  }
  if (provider === "google" && settings.googleClientId) {
    const next = await connectGoogle(settings, { prompt: "", loginHint: token.account });
    return next.accessToken;
  }
  setStoredToken(provider, null);
  throw new NotConnectedError(provider);
}

// Runs an API call with a fresh token; a 401 disconnects the provider.
export async function withToken<T>(provider: IntegrationProvider, settings: IntegrationSettings, fn: (token: string) => Promise<T>): Promise<T> {
  const token = await getAccessToken(provider, settings);
  try {
    return await fn(token);
  } catch (err) {
    if (err instanceof IntegrationApiError && err.unauthorized) {
      setStoredToken(provider, null);
      throw new NotConnectedError(provider);
    }
    throw err;
  }
}

export async function disconnect(provider: IntegrationProvider): Promise<void> {
  const token = getStoredToken(provider);
  setStoredToken(provider, null);
  if (provider === "google" && token) {
    const g = (window as unknown as { google?: GisGoogle }).google;
    try {
      g?.accounts.oauth2.revoke(token.accessToken);
    } catch {
      // ignore
    }
  }
}

// True when calling the provider now would need a popup (Google token
// expired): don't do it without a user gesture.
export function needsInteraction(provider: IntegrationProvider): boolean {
  const token = getStoredToken(provider);
  if (!token) return true;
  if (token.expiresAt - SKEW_MS > Date.now()) return false;
  return provider === "google" || !token.refreshToken;
}
