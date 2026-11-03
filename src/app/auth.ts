// Maps a backend identity (DataStore.identity()) onto a CrmUser — pure,
// shared by the admin (AuthContext) and the CLI.
//
//   - local & journal (no accounts): identity uid "local" / "owner" → the
//     settings' ownerUserId user, else the first admin;
//   - firebase & git-json: the user doc whose id is the identity uid, else
//     whose email matches; unknown identities get a synthesized user with
//     the identity's role (the backend decides it: repo permission, rules).

import { normalizeEmail } from "../core/fields";
import type { CrmSettings, CrmUser } from "../core/types";
import type { DataStore, StoreIdentity } from "../data/types";

const SINGLE_USER_UIDS = new Set(["local", "owner"]);

export function resolveCrmUser(store: DataStore, identity: StoreIdentity | null): CrmUser | null {
  if (!identity) return null;
  const users = store.list("users") as unknown as CrmUser[];
  const byId = users.find((u) => u.id === identity.uid);
  if (byId) return byId;
  const email = normalizeEmail(identity.email);
  if (email) {
    const byEmail = users.find((u) => normalizeEmail(u.email) === email);
    if (byEmail) return byEmail;
  }
  if (SINGLE_USER_UIDS.has(identity.uid)) {
    const settings = store.get("settings", "general") as unknown as CrmSettings | undefined;
    const owner = settings?.ownerUserId ? users.find((u) => u.id === settings.ownerUserId) : undefined;
    const admin = owner ?? users.find((u) => u.role === "admin" && !u.disabled);
    if (admin) return admin;
  }
  return {
    id: identity.uid,
    email: identity.email,
    name: identity.displayName || identity.email || "Owner",
    role: identity.role,
  };
}
