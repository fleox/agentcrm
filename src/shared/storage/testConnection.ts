import { createRemoteGitTransport } from "../git";
import { resolveGitPagesToken, type GitPagesSettings } from "./connectors/gitPages";
import { defaultConnectorId, getStorageConfig, instantiateStorageConnector } from "./registry";
import { StorageError } from "./types";

// "Test connection" for the setup wizard and Settings → Data / Hosting.
// Proves the credentials work with as few side effects as possible:
// git targets only check repo permissions (a probe commit would trigger
// a Pages build), file targets write + read + list + delete a tiny probe
// file. Copied from cms-ia (see SHARED.md).

export const PROBE_PATH = ".agentcrm-probe.txt";

export interface ConnectionTestResult {
  ok: boolean;
  // Short technical detail for the UI (login, bucket, …) or the error.
  detail: string;
}

// Fields without which a connector can't even attempt a request.
const REQUIRED: Record<string, (s: Record<string, unknown>) => string[]> = {
  "git-pages": (s) => [...(s.provider === "gitlab" ? ["project"] : ["owner", "repo"]), "branch", "siteUrl"],
  s3: () => ["bucket", "accessKeyId", "secretAccessKey", "siteUrl"],
};

// `ignore`: fields irrelevant for the caller (a journal data location
// has no public site URL — pass ["siteUrl"]).
export function missingFields(connectorId: string, settings: Record<string, unknown>, ignore: string[] = []): string[] {
  const required = (REQUIRED[connectorId]?.(settings) ?? []).filter((k) => !ignore.includes(k));
  return required.filter((k) => typeof settings[k] !== "string" || !(settings[k] as string).trim());
}

export async function testStorageConnection(
  connectorId: string,
  settings: Record<string, unknown>,
  opts: { ignore?: string[] } = {},
): Promise<ConnectionTestResult> {
  const missing = missingFields(connectorId, settings, opts.ignore);
  if (missing.length) return { ok: false, detail: `missing: ${missing.join(", ")}` };
  try {
    if (connectorId === "git-pages") {
      const s = settings as unknown as GitPagesSettings;
      const token = resolveGitPagesToken(s);
      const transport = createRemoteGitTransport(
        s.provider === "github"
          ? { provider: "github", owner: s.owner ?? "", repo: s.repo ?? "", branch: s.branch, token, apiBaseUrl: s.apiBaseUrl }
          : { provider: "gitlab", project: s.project ?? "", branch: s.branch, token, apiBaseUrl: s.apiBaseUrl },
      );
      const perms = await transport.permissions();
      if (!perms.canWrite) return { ok: false, detail: `${perms.login}: read-only access` };
      return { ok: true, detail: `${perms.login} → ${transport.label}` };
    }
    const connector = instantiateStorageConnector(connectorId, settings);
    if (connectorId === "browser-mirror") return { ok: true, detail: "browser" };
    await connector.put({ path: PROBE_PATH, content: `AgentCRM connection test ${new Date().toISOString()}\n` });
    const echoed = await connector.get(PROBE_PATH).catch(() => null);
    // The journal backend polls with listPrefix — prove listing works too.
    const listed = connector.listPrefix ? await connector.listPrefix(".agentcrm-").catch(() => null) : [PROBE_PATH];
    await connector.delete(PROBE_PATH);
    if (echoed === null) return { ok: false, detail: "write succeeded but read-back failed" };
    if (!listed || !listed.includes(PROBE_PATH)) return { ok: false, detail: "write succeeded but listing failed (ListBucket permission / CORS)" };
    return { ok: true, detail: await connector.publicUrl("") };
  } catch (err) {
    const status = err instanceof StorageError ? ` (${err.status})` : "";
    return { ok: false, detail: `${(err as Error).message}${status}` };
  }
}

// Current hosting target as configured, for Settings to pre-fill its form.
export async function readStorageSettings(): Promise<{ connectorId: string; settings: Record<string, unknown> }> {
  const config = await getStorageConfig().catch(() => null);
  return { connectorId: config?.connectorId ?? defaultConnectorId(), settings: config?.settings ?? {} };
}
