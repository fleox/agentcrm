import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../../../data/memory";
import { buildConfigJsSource } from "../../../lib/runtimeConfig";
import { createOpsContext } from "../../../ops/context";
import { seedCrm } from "../../../ops/seed";
import { gitRuntime, hostingMissing, hostingTarget, journalRuntime, parseFirebaseSnippet, firebaseRuntime } from "./installers";
import { missingIndexReferences, adminUrlOn } from "./adminDeploy";
import { passphraseAcceptable, passphraseStrength } from "./passphrase";
import { transferData } from "./transfer";
import { initialWizardState } from "../steps/shared";

describe("setup installers", () => {
  it("journal runtime keeps secrets out of the config", () => {
    const { runtime, secrets } = journalRuntime({ locationId: "s3", settings: { s3Preset: "r2", endpoint: "https://a.r2.cloudflarestorage.com", bucket: "crm", accessKeyId: "AK", secretAccessKey: "SK" }, root: "/agentcrm/", encrypted: true, passphrase: "x" }, "Acme");
    expect(secrets).toEqual({ accessKeyId: "AK", secretAccessKey: "SK" });
    expect(runtime).toMatchObject({ backend: "journal", name: "Acme", journal: { connectorId: "s3", root: "agentcrm", encrypted: true, settings: { bucket: "crm", region: "auto", forcePathStyle: true } } });
    const js = buildConfigJsSource(runtime);
    expect(js).not.toContain("SK");
    expect(js).not.toContain("AK");
  });

  it("git runtime per provider", () => {
    const base = initialWizardState().git;
    expect(gitRuntime({ ...base, owner: " me ", repo: "crm", token: "t" }).git).toEqual({ provider: "github", owner: "me", repo: "crm", branch: "main", dir: "crm" });
    expect(gitRuntime({ ...base, provider: "gitlab", project: "g/crm", dir: "/" }).git).toEqual({ provider: "gitlab", project: "g/crm", branch: "main", dir: "" });
  });

  it("parses the Firebase console snippet", () => {
    const snippet = `const firebaseConfig = {\n  apiKey: "AIza123",\n  authDomain: 'p.firebaseapp.com',\n  projectId: "p",\n  appId: "1:2:web:3"\n};`;
    expect(parseFirebaseSnippet(snippet)).toEqual({ apiKey: "AIza123", authDomain: "p.firebaseapp.com", projectId: "p", appId: "1:2:web:3" });
    const rt = firebaseRuntime({ ...initialWizardState().firebase, apiKey: "k", projectId: "p", authDomain: "d", appId: "a" });
    expect(rt).toEqual({ backend: "firebase", firebase: { apiKey: "k", authDomain: "d", projectId: "p", appId: "a" }, signInMethods: ["password", "google"] });
  });

  it("hosting targets and required fields", () => {
    expect(hostingTarget({ optionId: "none", settings: {}, folder: "admin" })).toBeNull();
    expect(hostingTarget({ optionId: "gitlab-pages", settings: { project: "g/a" }, folder: "admin" })).toEqual({ connectorId: "git-pages", settings: { host: "gitlab-pages", provider: "gitlab", branch: "main", dir: "public", project: "g/a" } });
    expect(hostingMissing({ optionId: "s3", settings: { bucket: "b" }, folder: "admin" })).toEqual(["accessKeyId", "secretAccessKey", "siteUrl"]);
    expect(adminUrlOn({ siteUrl: "https://x.io/" }, "/admin/")).toBe("https://x.io/admin/");
  });

  it("detects index.html references missing from the manifest", () => {
    const html = '<script src="./assets/a.js"></script><link href="./assets/b.css"><script src="./config.js"></script>';
    expect(missingIndexReferences(html, ["assets/a.js", "index.html"])).toEqual(["assets/b.css"]);
  });
});

describe("passphrase strength", () => {
  it("scores", () => {
    expect(passphraseStrength("").score).toBe(0);
    expect(passphraseAcceptable("password123")).toBe(false);
    expect(passphraseAcceptable("short")).toBe(false);
    expect(passphraseAcceptable("correct horse battery staple")).toBe(true);
    expect(passphraseStrength("abcde-fghjk-mnpqr-stuvw-xyz23-45678").score).toBeGreaterThanOrEqual(3);
  });
});

describe("transfer", () => {
  it("copies a CRM with ids preserved, refuses a non-empty destination", async () => {
    const from = createMemoryStore();
    await from.ready();
    await seedCrm(createOpsContext(from, null), { admin: { name: "A", email: "a@x.io" }, demo: true });
    const to = createMemoryStore();
    const report = await transferData(from, to);
    expect(report.written).toBeGreaterThan(100);
    for (const c of ["objects", "records", "activities", "users", "settings"] as const) {
      expect(to.list(c).map((d) => d.id).sort()).toEqual(from.list(c).map((d) => d.id).sort());
    }
    await expect(transferData(from, to)).rejects.toThrow(/already holds/);
  });
});
