# Email & calendar integrations

AgentCRM connects to **Gmail + Google Calendar** and **Outlook + Microsoft 365 calendar** entirely from the browser. There is no AgentCRM server: you register your **own** OAuth app with Google and/or Microsoft, paste its public client id in *Settings → Integrations*, and each user signs in with their own account.

What you get:

- **Emails tab** on people and companies: recent emails exchanged with the contact (people: their email address; companies: anyone at the company domain, free-mail domains such as gmail.com are ignored). Each email can be **logged to the timeline** (once — logging is idempotent).
- **Compose**: send an email from a record through Gmail or Outlook; it is logged automatically when *auto-log* is on.
- **Upcoming meetings** card + **Sync meetings**: calendar events from the past 30 days and the next 30 days whose attendees match CRM contacts become *meeting* activities (re-syncing updates times / titles, never duplicates).

The values to register are shown (with copy buttons) at the top of *Settings → Integrations*:

- **Authorized JavaScript origin** = the admin's origin, e.g. `https://crm.example.com` (or `http://localhost:5173` in dev).
- **Redirect URI** = the full admin URL without `#…`, e.g. `https://crm.example.com/admin/`.

## Google (Gmail + Calendar)

1. Open <https://console.cloud.google.com/> and **create a project** (or pick one).
2. *APIs & Services → Library*: **enable the Gmail API** and the **Google Calendar API**.
3. *APIs & Services → OAuth consent screen* (Google Auth Platform → Branding / Audience / Data access):
   - User type **External** (or *Internal* for a Google Workspace organisation).
   - App name, support email, developer contact.
   - Scopes: `openid`, `email`, `.../auth/gmail.readonly`, `.../auth/gmail.send`, `.../auth/calendar.readonly`.
   - While the app is in **Testing**, add every user as a **test user** (up to 100). Gmail scopes are *restricted*: publishing the app to everyone requires Google's verification — for an internal CRM, keep it in Testing or use an *Internal* Workspace app.
4. *APIs & Services → Credentials → Create credentials → OAuth client ID*:
   - Application type **Web application**.
   - **Authorized JavaScript origins**: the admin origin (`https://crm.example.com`, plus `http://localhost:5173` for dev). No redirect URI is needed (the Google Identity Services token client uses a popup).
5. Copy the **Client ID** (`…apps.googleusercontent.com`) into *Settings → Integrations → Google OAuth client id*, then **Connect Google**.

Google access tokens last about one hour and there is no refresh token in the browser flow: when it expires, the next action you trigger re-opens the Google popup (no consent screen the second time).

## Microsoft (Outlook + Calendar, Entra ID)

1. Open <https://entra.microsoft.com/> (or the Azure portal) → *Identity → Applications → App registrations* → **New registration**.
   - Supported account types: your organisation only (single tenant), or *any organisation + personal Microsoft accounts* for `common`.
   - Redirect URI: platform **Single-page application (SPA)**, value = the **admin URL** shown in AgentCRM (e.g. `https://crm.example.com/admin/`; add `http://localhost:5173/` for dev). It must be the *SPA* platform — the *Web* platform would require a client secret and refuse the browser token exchange.
2. *API permissions → Add a permission → Microsoft Graph → Delegated*: `User.Read`, `Mail.Read`, `Mail.Send`, `Calendars.Read`, plus `openid`, `profile`, `email` and (optional, recommended) `offline_access` so the session refreshes silently. Grant admin consent if your tenant requires it.
3. No client secret, no certificate: AgentCRM is a *public client* using the authorization code flow with **PKCE**.
4. Copy the **Application (client) ID** into *Settings → Integrations*. Optionally set the **tenant** (directory id or domain, e.g. `contoso.onmicrosoft.com`; empty = `common`). Click **Connect Microsoft**.

The sign-in happens in a popup: Microsoft redirects it back to the admin URL with `?code=…&state=…`; the popup hands the code to the main window and closes itself, and the main window exchanges it (with the PKCE verifier) for tokens.

## Sharing client ids with the team

Client ids, origins and tenants are **public** identifiers, not secrets. Each browser keeps its own values in `localStorage` (`agentcrm.integrations.settings`, along with the auto-log / auto-sync toggles). An admin can click **Share client ids with the team**: they are written to the `config/integrations` document of the CRM data, and teammates fall back to them when they have no local value. Every user still signs in with their own mailbox.

## Security model

- **Tokens never leave the browser tab.** Access tokens (and the Microsoft refresh token) are kept in memory + `sessionStorage` (`agentcrm.integrations.token.google|microsoft`). They are never written to `localStorage`, `config.js`, the CRM data, or git. Closing the tab ends the session; *Disconnect* removes them (and revokes the Google token).
- **Least privilege**: read mail metadata/snippets, send mail, read calendars. No delete/modify scope, no contacts scope.
- **Requests go directly** from the browser to `gmail.googleapis.com`, `www.googleapis.com/calendar`, `graph.microsoft.com` and `login.microsoftonline.com`. Nothing is proxied.
- **What is stored in the CRM**: only what you log — an *email* activity (subject, snippet or body you sent, from / to / cc addresses, date, provider + message id, direction) or a *meeting* activity (title, description, start / end, attendee addresses, location, provider + event id). These are personal data: they follow the CRM's encryption and purge rules like any other activity.
- The OAuth `state` is random per sign-in and checked by the main window; the PKCE verifier never leaves the main window.

## Limitations

- Only works while the admin is open in a browser: there is no background mailbox sync (the CLI cannot reuse browser tokens). *Auto-sync meetings* runs at most every 30 minutes while a tab is open.
- Received emails are not logged automatically — use *Log to timeline* (sent emails from the composer are, when auto-log is on).
- Search returns the 20 most recent matching messages per provider; Gmail `from:*@domain` / Graph `participants:` searches are best-effort.
- Plain-text emails only in the composer (no attachments, no HTML, no signatures).
- Google tokens expire after ~1 h and need a click to renew; Microsoft refresh tokens for SPAs expire after 24 h.
- Popups must be allowed for the admin's site.
- Meetings without any attendee matching a CRM contact are not imported.
