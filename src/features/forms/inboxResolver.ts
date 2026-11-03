// How the admin opens a form's inbox with this browser's credentials
// (registered on the engine with setInboxSourceResolver in index.ts).
//
//   s3, source "hosting" (default)  the hosting connector of the admin
//                                   (Settings → hosting: bucket + keys)
//   s3, source "data"               the journal backend's connector
//                                   (same bucket as the encrypted data)
//   firebase                        Firestore REST with the signed-in
//                                   user's Firebase ID token
//   webhook                         nothing to read (null)

import { connectorInboxSource, firestoreInboxSource, type InboxSource, type LeadFormDoc } from "../../ops/forms";
import { getConnectorSecrets, getRuntimeConfig } from "../../lib/runtimeConfig";
import { getActiveStorageConnector, instantiateStorageConnector } from "../../shared/storage/registry";

async function firebaseToken(): Promise<string | null> {
  try {
    const { getApps } = await import("firebase/app");
    const app = getApps()[0];
    if (!app) return null;
    const { getAuth } = await import("firebase/auth");
    const user = getAuth(app).currentUser;
    return user ? await user.getIdToken() : null;
  } catch {
    return null;
  }
}

export async function browserInboxSource(form: LeadFormDoc): Promise<InboxSource | null> {
  const s = form.inbox.settings ?? {};
  if (form.inbox.kind === "s3") {
    const prefix = s.prefix || "inbox/";
    if (s.source === "data") {
      const config = getRuntimeConfig();
      if (config?.backend !== "journal") return null;
      const connector = instantiateStorageConnector(config.journal.connectorId, { ...config.journal.settings, ...getConnectorSecrets(config) });
      return connectorInboxSource(connector, prefix, `data:${prefix}`);
    }
    const connector = await getActiveStorageConnector();
    if (!connector.listPrefix || connector.id === "browser-mirror") return null;
    return connectorInboxSource(connector, prefix, `hosting:${prefix}`);
  }
  if (form.inbox.kind === "firebase") {
    const config = getRuntimeConfig();
    const projectId = s.projectId || (config?.backend === "firebase" ? config.firebase.projectId : "");
    if (!projectId) return null;
    if (!(await firebaseToken())) return null;
    return firestoreInboxSource({ projectId, collection: s.collection || "inbox", getToken: firebaseToken });
  }
  return null;
}
