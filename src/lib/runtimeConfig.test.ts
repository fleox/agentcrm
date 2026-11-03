// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  buildConfigJsSource,
  getConnectorSecrets,
  getPassphrase,
  getRuntimeConfig,
  LOCAL_RUNTIME_CONFIG_KEY,
  parseRuntimeConfig,
  resetRuntimeConfigCache,
  saveLocalRuntimeConfig,
  setConnectorSecrets,
  setPassphrase,
  splitSecretSettings,
  type RuntimeConfig,
} from "./runtimeConfig";

const journal: RuntimeConfig = {
  backend: "journal",
  journal: { connectorId: "s3", settings: { bucket: "crm", region: "eu-west-3" }, root: "agentcrm", encrypted: true },
};

afterEach(() => {
  window.__AGENTCRM_CONFIG__ = undefined;
  localStorage.clear();
  resetRuntimeConfigCache();
});

describe("runtimeConfig", () => {
  it("prefers config.js over localStorage", () => {
    saveLocalRuntimeConfig({ backend: "local" });
    expect(getRuntimeConfig()?.backend).toBe("local");
    window.__AGENTCRM_CONFIG__ = journal;
    resetRuntimeConfigCache();
    expect(getRuntimeConfig()?.backend).toBe("journal");
  });

  it("rejects incomplete configs", () => {
    expect(parseRuntimeConfig({ backend: "journal", journal: { settings: {} } })).toBeNull();
    expect(parseRuntimeConfig({ backend: "git-json", git: { provider: "github", owner: "a" } })).toBeNull();
    expect(parseRuntimeConfig({ backend: "firebase", firebase: { apiKey: "k" } })).toBeNull();
    expect(parseRuntimeConfig({ backend: "nope" })).toBeNull();
    expect(parseRuntimeConfig(null)).toBeNull();
  });

  it("normalises the journal root and defaults encryption on", () => {
    const c = parseRuntimeConfig({ backend: "journal", journal: { connectorId: "s3", settings: {}, root: "/crm/" } });
    expect(c).toEqual({ backend: "journal", journal: { connectorId: "s3", settings: {}, root: "crm", encrypted: true } });
  });

  it("never serialises secrets into config.js or localStorage", () => {
    const leaky: RuntimeConfig = {
      ...journal,
      journal: { ...journal.journal, settings: { bucket: "crm", accessKeyId: "AK", secretAccessKey: "SK" } },
    } as RuntimeConfig;
    const src = buildConfigJsSource(leaky);
    expect(src).toContain("window.__AGENTCRM_CONFIG__ =");
    expect(src).not.toContain("SK");
    expect(src).not.toContain("AK");
    saveLocalRuntimeConfig(leaky);
    expect(localStorage.getItem(LOCAL_RUNTIME_CONFIG_KEY)).not.toContain("SK");
    expect(splitSecretSettings({ bucket: "b", token: "t" })).toEqual({ publicSettings: { bucket: "b" }, secrets: { token: "t" } });
  });

  it("scopes secrets per dataset", () => {
    setConnectorSecrets(journal, { secretAccessKey: "SK" });
    setPassphrase(journal, "pw");
    expect(getConnectorSecrets(journal)).toEqual({ secretAccessKey: "SK" });
    expect(getPassphrase(journal)).toBe("pw");
    const other = { ...journal, journal: { ...journal.journal, root: "other" } } as RuntimeConfig;
    expect(getPassphrase(other)).toBeNull();
    expect([...Object.keys(localStorage)].every((k) => k.startsWith("agentcrm.secrets:"))).toBe(true);
  });
});
