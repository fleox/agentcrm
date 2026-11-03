// Where things live: storage choices for the journal data backend, the
// admin hosting targets, and the per-connector form fields. Mirrors cms-ia
// src/components/connectors/hostingOptions.ts + PublishTargetForm FIELDS.
// Users pick WHERE (an R2 bucket, a GitHub repo…); each choice maps to a
// storage connector + preset settings.

import { CONNECTOR_SECRET_FIELDS } from "../../../data/journal/access";

export interface FieldDef {
  key: string;
  type: "text" | "password" | "select" | "checkbox";
  options?: string[];
  placeholder?: string;
  // Has a help text (setup:fields.<key>Help).
  help?: boolean;
  required?: boolean;
  show?: (s: Record<string, unknown>) => boolean;
}

// ─── Journal data locations ──────────────────────────────────────────────

export type S3PresetId = "aws" | "r2" | "ovh" | "scaleway" | "minio" | "other";

export interface S3Preset {
  id: S3PresetId;
  settings: Record<string, unknown>;
  endpointPlaceholder: string;
  regionPlaceholder: string;
  consoleUrl?: string;
}

export const S3_PRESETS: S3Preset[] = [
  { id: "aws", settings: { endpoint: "", region: "eu-west-3", forcePathStyle: false }, endpointPlaceholder: "(derived from the region)", regionPlaceholder: "eu-west-3", consoleUrl: "https://console.aws.amazon.com/s3/" },
  { id: "r2", settings: { endpoint: "", region: "auto", forcePathStyle: true }, endpointPlaceholder: "https://<ACCOUNT_ID>.r2.cloudflarestorage.com", regionPlaceholder: "auto", consoleUrl: "https://dash.cloudflare.com/?to=/:account/r2" },
  { id: "ovh", settings: { endpoint: "https://s3.gra.io.cloud.ovh.net", region: "gra", forcePathStyle: true }, endpointPlaceholder: "https://s3.<region>.io.cloud.ovh.net", regionPlaceholder: "gra", consoleUrl: "https://www.ovh.com/manager/#/public-cloud" },
  { id: "scaleway", settings: { endpoint: "https://s3.fr-par.scw.cloud", region: "fr-par", forcePathStyle: true }, endpointPlaceholder: "https://s3.<region>.scw.cloud", regionPlaceholder: "fr-par", consoleUrl: "https://console.scaleway.com/object-storage/buckets" },
  { id: "minio", settings: { endpoint: "http://localhost:9000", region: "us-east-1", forcePathStyle: true }, endpointPlaceholder: "http://localhost:9000", regionPlaceholder: "us-east-1" },
  { id: "other", settings: { endpoint: "", region: "us-east-1", forcePathStyle: true }, endpointPlaceholder: "https://s3.example.com", regionPlaceholder: "us-east-1" },
];

export function s3Preset(id: string): S3Preset {
  return S3_PRESETS.find((p) => p.id === id) ?? S3_PRESETS[0];
}

export type DataLocationId = "s3" | "github" | "gitlab" | "local-folder";

export interface DataLocation {
  id: DataLocationId;
  connectorId: string;
  preset: Record<string, unknown>;
}

export const DATA_LOCATIONS: DataLocation[] = [
  { id: "s3", connectorId: "s3", preset: { ...s3Preset("r2").settings, s3Preset: "r2" } },
  { id: "github", connectorId: "git-pages", preset: { provider: "github", branch: "main" } },
  { id: "gitlab", connectorId: "git-pages", preset: { provider: "gitlab", branch: "main" } },
  { id: "local-folder", connectorId: "local-folder", preset: { handleKey: "data-folder" } },
];

export function dataLocation(id: string): DataLocation {
  return DATA_LOCATIONS.find((l) => l.id === id) ?? DATA_LOCATIONS[0];
}

export function dataLocationFor(connectorId: string, settings: Record<string, unknown>): DataLocation {
  if (connectorId === "git-pages") return dataLocation(settings.provider === "gitlab" ? "gitlab" : "github");
  return DATA_LOCATIONS.find((l) => l.connectorId === connectorId) ?? DATA_LOCATIONS[0];
}

// Fields of a DATA location (no siteUrl / hosting fields).
export const DATA_FIELDS: Record<DataLocationId, FieldDef[]> = {
  s3: [
    { key: "endpoint", type: "text", help: true, required: true, show: (s) => s.s3Preset !== "aws" },
    { key: "region", type: "text", required: true },
    { key: "bucket", type: "text", required: true, help: true },
    { key: "accessKeyId", type: "text", required: true },
    { key: "secretAccessKey", type: "password", required: true },
    { key: "forcePathStyle", type: "checkbox", help: true },
  ],
  github: [
    { key: "owner", type: "text", placeholder: "my-company", required: true },
    { key: "repo", type: "text", placeholder: "crm-data", required: true },
    { key: "branch", type: "text", placeholder: "main", required: true },
    { key: "token", type: "password", required: true, help: true },
    { key: "apiBaseUrl", type: "text", placeholder: "https://api.github.com" },
  ],
  gitlab: [
    { key: "project", type: "text", placeholder: "group/crm-data", required: true },
    { key: "branch", type: "text", placeholder: "main", required: true },
    { key: "token", type: "password", required: true, help: true },
    { key: "apiBaseUrl", type: "text", placeholder: "https://gitlab.com/api/v4" },
  ],
  "local-folder": [],
};

// ─── Admin hosting ───────────────────────────────────────────────────────

export type HostingOptionId = "none" | "github-pages" | "cloudflare-pages" | "gitlab-pages" | "s3" | "local-folder" | "zip";

export interface HostingOption {
  id: HostingOptionId;
  connectorId: string | null;
  preset: Record<string, unknown>;
}

export const HOSTING_OPTIONS: HostingOption[] = [
  { id: "none", connectorId: null, preset: {} },
  { id: "github-pages", connectorId: "git-pages", preset: { host: "github-pages", provider: "github", branch: "main" } },
  { id: "cloudflare-pages", connectorId: "git-pages", preset: { host: "cloudflare-pages", provider: "github", branch: "main" } },
  { id: "gitlab-pages", connectorId: "git-pages", preset: { host: "gitlab-pages", provider: "gitlab", branch: "main", dir: "public" } },
  { id: "s3", connectorId: "s3", preset: { region: "auto", forcePathStyle: true } },
  { id: "local-folder", connectorId: "local-folder", preset: { handleKey: "publish-target" } },
  { id: "zip", connectorId: "browser-mirror", preset: {} },
];

export function hostingOption(id: string): HostingOption {
  return HOSTING_OPTIONS.find((o) => o.id === id) ?? HOSTING_OPTIONS[0];
}

export function hostingOptionFor(connectorId: string | null | undefined, settings: Record<string, unknown>): HostingOption {
  if (!connectorId) return HOSTING_OPTIONS[0];
  if (connectorId === "git-pages") return hostingOption(String(settings.host ?? "github-pages"));
  return HOSTING_OPTIONS.find((o) => o.connectorId === connectorId) ?? HOSTING_OPTIONS[0];
}

export const HOSTING_FIELDS: Record<Exclude<HostingOptionId, "none">, FieldDef[]> = {
  "github-pages": [
    { key: "owner", type: "text", placeholder: "my-company", required: true },
    { key: "repo", type: "text", placeholder: "crm-admin", required: true },
    { key: "branch", type: "text", placeholder: "main", required: true },
    { key: "token", type: "password", help: true },
    { key: "siteUrl", type: "text", placeholder: "https://my-company.github.io/crm-admin", required: true, help: true },
  ],
  "cloudflare-pages": [
    { key: "provider", type: "select", options: ["github", "gitlab"] },
    { key: "owner", type: "text", placeholder: "my-company", show: (s) => s.provider !== "gitlab", required: true },
    { key: "repo", type: "text", placeholder: "crm-admin", show: (s) => s.provider !== "gitlab", required: true },
    { key: "project", type: "text", placeholder: "group/crm-admin", show: (s) => s.provider === "gitlab", required: true },
    { key: "branch", type: "text", placeholder: "main", required: true },
    { key: "token", type: "password", help: true },
    { key: "siteUrl", type: "text", placeholder: "https://crm-admin.pages.dev", required: true, help: true },
  ],
  "gitlab-pages": [
    { key: "project", type: "text", placeholder: "group/crm-admin", required: true },
    { key: "branch", type: "text", placeholder: "main", required: true },
    { key: "token", type: "password", help: true },
    { key: "siteUrl", type: "text", placeholder: "https://group.gitlab.io/crm-admin", required: true, help: true },
  ],
  s3: [
    { key: "endpoint", type: "text", placeholder: "https://<ACCOUNT_ID>.r2.cloudflarestorage.com", help: true },
    { key: "region", type: "text", placeholder: "auto", required: true },
    { key: "bucket", type: "text", required: true },
    { key: "accessKeyId", type: "text", required: true },
    { key: "secretAccessKey", type: "password", required: true },
    { key: "siteUrl", type: "text", placeholder: "https://crm.example.com", required: true, help: true },
    { key: "forcePathStyle", type: "checkbox" },
    { key: "publicRead", type: "checkbox", help: true },
  ],
  "local-folder": [{ key: "siteUrl", type: "text", placeholder: "http://localhost:8080", help: true }],
  zip: [],
};

export function secretFieldsOf(connectorId: string): string[] {
  return CONNECTOR_SECRET_FIELDS[connectorId] ?? [];
}

export function missingRequired(fields: FieldDef[], settings: Record<string, unknown>): string[] {
  return fields
    .filter((f) => f.required && (!f.show || f.show(settings)))
    .filter((f) => typeof settings[f.key] !== "string" || !(settings[f.key] as string).trim())
    .map((f) => f.key);
}

// Short human description of a location ("r2 · my-bucket", "github · me/crm").
// `localFolder` is the (translated) name shown for a local folder.
export function describeLocation(connectorId: string, s: Record<string, unknown>, localFolder = "local folder"): string {
  if (connectorId === "s3") return [s.endpoint ? String(s.endpoint).replace(/^https?:\/\//, "") : `s3.${s.region}`, s.bucket].filter(Boolean).join(" · ");
  if (connectorId === "git-pages") return s.provider === "gitlab" ? `gitlab · ${s.project}` : `github · ${s.owner}/${s.repo}`;
  if (connectorId === "local-folder") return localFolder;
  if (connectorId === "browser-mirror") return "ZIP";
  return connectorId;
}
