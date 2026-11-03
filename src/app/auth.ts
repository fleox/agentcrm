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

const ROLE_RANK: Record<CrmUser["role"], number> = { viewer: 0, member: 1, admin: 2 };

// git-json: the repo permission is a ceiling — a CRM "admin" whose token
// only has write access acts as a member (their commits could not do
// more anyway). Firebase roles come from the same users doc, no cap.
function capRole(store: DataStore, identity: StoreIdentity, user: CrmUser): CrmUser {
  if (store.kind !== "git-json") return user;
  return ROLE_RANK[identity.role] < ROLE_RANK[user.role] ? { ...user, role: identity.role } : user;
}

export function resolveCrmUser(store: DataStore, identity: StoreIdentity | null): CrmUser | null {
  if (!identity) return null;
  const users = store.list("users") as unknown as CrmUser[];
  const byId = users.find((u) => u.id === identity.uid);
  if (byId) return capRole(store, identity, byId);
  const email = normalizeEmail(identity.email);
  if (email) {
    const byEmail = users.find((u) => normalizeEmail(u.email) === email);
    if (byEmail) return capRole(store, identity, byEmail);
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
