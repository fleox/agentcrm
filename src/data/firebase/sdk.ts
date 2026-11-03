// FirebaseApi over the Firebase JS SDK (modular v11). One named app per
// project, so the setup wizard can try a config without clobbering the
// running one. Firestore Timestamps read back as epoch ms (AgentCRM
// stores dates as numbers; the inbox `createdAt` uses request.time).

import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  type Auth,
  type User,
} from "firebase/auth";
import {
  Timestamp,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  initializeFirestore,
  onSnapshot,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { DELETE_FIELD, type FirebaseApi, type FirebaseAuthUser, type FirebaseStorageApi, type FirestoreDocData, type FirestoreWriteOp } from "./api";

// Firebase Storage, loaded on first use (its SDK chunk only ships to
// those who upload / view files). Reading needs the bucket's CORS
// configured for the admin's origin (docs/files.md).
function sdkStorage(app: FirebaseApp): FirebaseStorageApi {
  const mod = () => import("firebase/storage");
  const code = (err: unknown) => (err as { code?: string } | null)?.code ?? "";
  return {
    async put(path, bytes, contentType) {
      const m = await mod();
      await m.uploadBytes(m.ref(m.getStorage(app), path), bytes, contentType ? { contentType } : undefined);
    },
    async get(path) {
      const m = await mod();
      try {
        return new Uint8Array(await m.getBytes(m.ref(m.getStorage(app), path)));
      } catch (err) {
        if (code(err) === "storage/object-not-found") return null;
        throw err;
      }
    },
    async delete(path) {
      const m = await mod();
      try {
        await m.deleteObject(m.ref(m.getStorage(app), path));
      } catch (err) {
        if (code(err) !== "storage/object-not-found") throw err;
      }
    },
  };
}

function appName(options: FirebaseOptions): string {
  return `agentcrm-${options.projectId ?? "default"}`;
}

export function getFirebaseApp(options: FirebaseOptions): FirebaseApp {
  const name = appName(options);
  return getApps().find((a) => a.name === name) ?? initializeApp(options, name);
}

const dbs = new WeakMap<FirebaseApp, Firestore>();

function getDb(app: FirebaseApp): Firestore {
  let db = dbs.get(app);
  if (!db) {
    try {
      // Same semantics as the other backends, which drop undefined keys.
      db = initializeFirestore(app, { ignoreUndefinedProperties: true });
    } catch {
      db = getFirestore(app);
    }
    dbs.set(app, db);
  }
  return db;
}

function fromFirestore(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toMillis();
  if (Array.isArray(value)) return value.map(fromFirestore);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = fromFirestore(v);
    return out;
  }
  return value;
}

function toUser(u: User | null): FirebaseAuthUser | null {
  return u ? { uid: u.uid, email: u.email, displayName: u.displayName, emailVerified: u.emailVerified, photoURL: u.photoURL } : null;
}

export function createSdkFirebaseApi(options: FirebaseOptions): FirebaseApi {
  const app = getFirebaseApp(options);
  const db = getDb(app);
  const auth: Auth = getAuth(app);
  const restored = new Promise<void>((resolve) => {
    const off = onAuthStateChanged(auth, () => {
      off();
      resolve();
    });
  });

  return {
    ...(options.storageBucket ? { storage: sdkStorage(app) } : {}),
    async listCollection(name) {
      const snap = await getDocs(collection(db, name));
      return snap.docs.map((d) => ({ id: d.id, data: fromFirestore(d.data()) as Record<string, unknown> }));
    },
    watchCollection(name, onDocs, onError) {
      return onSnapshot(
        collection(db, name),
        (snap) => onDocs(snap.docs.map((d): FirestoreDocData => ({ id: d.id, data: fromFirestore(d.data()) as Record<string, unknown> }))),
        onError,
      );
    },
    async getDoc(name, id) {
      const snap = await getDoc(doc(db, name, id));
      return snap.exists() ? (fromFirestore(snap.data()) as Record<string, unknown>) : null;
    },
    async commit(ops: FirestoreWriteOp[]) {
      const batch = writeBatch(db);
      for (const op of ops) {
        const ref = doc(db, op.collection, op.id);
        if (op.type === "set") batch.set(ref, op.data);
        else if (op.type === "delete") batch.delete(ref);
        else {
          const data: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(op.data)) data[k] = v === DELETE_FIELD ? deleteField() : v;
          batch.update(ref, data);
        }
      }
      await batch.commit();
    },
    auth: {
      async currentUser() {
        await restored;
        return toUser(auth.currentUser);
      },
      onChange(listener) {
        return onAuthStateChanged(auth, (u) => listener(toUser(u)));
      },
      async signInWithPassword(email, password) {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        return toUser(cred.user)!;
      },
      async signInWithGoogle() {
        // A popup: redirects lose their state when the browser blocks
        // third-party storage.
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        const cred = await signInWithPopup(auth, provider);
        return toUser(cred.user)!;
      },
      async sendPasswordReset(email) {
        await sendPasswordResetEmail(auth, email.trim());
      },
      async sendVerificationEmail() {
        if (auth.currentUser) await sendEmailVerification(auth.currentUser, { url: `${window.location.origin}${window.location.pathname}` });
      },
      async reload() {
        const u = auth.currentUser;
        if (!u) return null;
        await u.reload();
        // Fresh ID token so the rules see email_verified right away.
        await u.getIdToken(true);
        return toUser(auth.currentUser);
      },
      async signOut() {
        await fbSignOut(auth);
      },
    },
  };
}
