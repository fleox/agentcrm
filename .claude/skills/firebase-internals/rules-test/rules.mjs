// Loads the rules generators of the repository (src/ops/firebaseRules.ts),
// so the emulator always tests what the setup wizard and
// `agentcrm options --firebase-rules` hand out. esbuild comes from the
// repository's own node_modules (a Vite dependency): run `npm install
// --legacy-peer-deps` at the repo root first.
import { build } from "esbuild";

const entry = new URL("../../../../src/ops/firebaseRules.ts", import.meta.url).pathname;
const out = await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", write: false, logLevel: "silent" });
const mod = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

export const { buildFirestoreRules, buildStorageRules, INBOX_LIMITS } = mod;
export const ADMIN = "boss@example.com";
export const PROJECT = "agentcrm-rules-test";
export const FIRESTORE = { host: "127.0.0.1", port: 8180 };
export const STORAGE = { host: "127.0.0.1", port: 9299 };

let pass = 0;
let fail = 0;
export async function t(name, promise) {
  try {
    await promise;
    pass++;
    console.log("ok  ", name);
  } catch (e) {
    fail++;
    console.log("FAIL", name, "-", String(e?.message ?? e).split("\n")[0]);
  }
}
export function summary(label) {
  console.log(`\n${label}: ${pass} passed, ${fail} failed`);
  return fail;
}
