import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Filter, Sort } from "../../src/core/types";
import { CliError, printResult, type Io } from "../output";
import type { OptionValue } from "./types";

// Option parsing shared by the data commands.

// Writes an --out file (parent folders created) and returns its absolute path.
export function writeOutFile(path: string, data: string | Uint8Array): string {
  const abs = resolve(path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  return abs;
}

export function usage(message: string, hint?: string): never {
  throw new CliError("usage", message, hint, 2);
}

export function strOpt(options: Record<string, OptionValue>, name: string): string | undefined {
  const v = options[name];
  if (Array.isArray(v)) return v.at(-1);
  return typeof v === "string" ? v : undefined;
}

export function requireStr(options: Record<string, OptionValue>, name: string, hint?: string): string {
  const v = strOpt(options, name);
  if (!v || !v.trim()) usage(`--${name} is required.`, hint);
  return v.trim();
}

export function listOpt(options: Record<string, OptionValue>, name: string): string[] | undefined {
  const v = options[name];
  if (v === undefined || v === false) return undefined;
  const all = Array.isArray(v) ? v : [String(v)];
  return all.flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
}

export function multiOpt(options: Record<string, OptionValue>, name: string): string[] {
  const v = options[name];
  if (v === undefined || v === false) return [];
  return Array.isArray(v) ? v : [String(v)];
}

export function numOpt(options: Record<string, OptionValue>, name: string): number | undefined {
  const v = strOpt(options, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) usage(`--${name} must be a number, got "${v}".`);
  return n;
}

export function boolOpt(options: Record<string, OptionValue>, name: string): boolean {
  return options[name] === true;
}

// `--x value`, `--x @file` (file contents) or `--x -` (stdin).
export function readTextValue(value: string, name: string): string {
  if (value === "-") return readFileSync(0, "utf8");
  if (value.startsWith("@")) {
    const file = value.slice(1);
    if (!existsSync(file)) usage(`--${name}: ${file} does not exist.`);
    return readFileSync(file, "utf8");
  }
  return value;
}

export function jsonOpt(options: Record<string, OptionValue>, name: string): unknown {
  const v = strOpt(options, name);
  if (v === undefined) return undefined;
  const text = readTextValue(v, name);
  try {
    return JSON.parse(text);
  } catch (err) {
    usage(`--${name} is not valid JSON: ${(err as Error).message}`, `Example: --${name} '{"name":"Acme"}' or --${name} @file.json`);
  }
}

export function jsonObjectOpt(options: Record<string, OptionValue>, name: string): Record<string, unknown> | undefined {
  const v = jsonOpt(options, name);
  if (v === undefined) return undefined;
  if (!v || typeof v !== "object" || Array.isArray(v)) usage(`--${name} must be a JSON object.`);
  return v as Record<string, unknown>;
}

// "42" → 42, "true" → true, "null" → null, '["a","b"]' → array; anything
// that doesn't round-trip ("00123", "+33…", "2024-01-01") stays a string.
export function parseScalar(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return "";
  try {
    const v = JSON.parse(t) as unknown;
    if (typeof v === "string") return v;
    if (typeof v === "number" && String(v) !== t) return raw;
    return v;
  } catch {
    return raw;
  }
}

// --set key=value (repeated) merged over --fields JSON.
export function fieldsInput(options: Record<string, OptionValue>, jsonName = "fields"): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(jsonObjectOpt(options, jsonName) ?? {}) };
  for (const pair of multiOpt(options, "set")) {
    const i = pair.indexOf("=");
    if (i <= 0) usage(`--set expects key=value, got "${pair}".`, 'e.g. --set name="Acme Inc" --set employees=40');
    out[pair.slice(0, i).trim()] = parseScalar(pair.slice(i + 1));
  }
  return out;
}

const VALUELESS = new Set(["empty", "notEmpty"]);
const LIST_OPS = new Set(["in", "notIn"]);

// field:op:value (value may contain ':'), repeated.
export function parseFilters(values: string[], ops: readonly string[]): Filter[] {
  return values.map((f) => {
    const first = f.indexOf(":");
    if (first <= 0) usage(`--filter expects field:op:value, got "${f}".`, `Ops: ${ops.join(", ")}. e.g. --filter stage:eq:proposal --filter amount:gte:10000`);
    const field = f.slice(0, first);
    const rest = f.slice(first + 1);
    const second = rest.indexOf(":");
    const op = second < 0 ? rest : rest.slice(0, second);
    const raw = second < 0 ? undefined : rest.slice(second + 1);
    if (!ops.includes(op)) usage(`Unknown filter op "${op}" in "${f}".`, `Ops: ${ops.join(", ")}.`);
    if (VALUELESS.has(op)) return { field, op } as Filter;
    if (raw === undefined) usage(`--filter "${f}" needs a value (field:op:value).`);
    let value: unknown = parseScalar(raw);
    if (LIST_OPS.has(op) && !Array.isArray(value)) value = raw.split(",").map((s) => parseScalar(s.trim()));
    return { field, op, value } as Filter;
  });
}

// --sort field[:asc|desc] (repeated or comma-separated); "-field" = desc.
export function parseSorts(values: string[]): Sort[] {
  return values
    .flatMap((v) => v.split(","))
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (s.startsWith("-")) return { field: s.slice(1), dir: "desc" as const };
      const [field, dir = "asc"] = s.split(":");
      if (dir !== "asc" && dir !== "desc") usage(`--sort direction must be asc or desc, got "${dir}".`);
      return { field, dir };
    });
}

// Destructive commands: without --yes, print the plan and write nothing.
export function confirmOrPlan(io: Io, options: Record<string, OptionValue>, plan: unknown, human: () => string): boolean {
  if (options.yes === true) return true;
  printResult(io, { needsConfirmation: true, plan }, () => `${human()}\nNothing changed — re-run with --yes once the user agrees.`);
  return false;
}

export function positional(positionals: string[], index: number, what: string, usageLine: string): string {
  const v = positionals[index];
  if (!v) usage(`Missing ${what}.`, `Usage: agentcrm ${usageLine}`);
  return v;
}

export function table(rows: Record<string, unknown>[], columns: string[]): string {
  if (!rows.length) return "(none)";
  const cell = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)).replace(/\s+/g, " ").slice(0, 60);
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i])).join("  ").trimEnd();
  return [line(columns), line(widths.map((w) => "-".repeat(w))), ...rows.map((r) => line(columns.map((c) => cell(r[c]))))].join("\n");
}

export const SITE_OPTION = { name: "site", type: "string" as const, description: "Site alias (default: $AGENTCRM_SITE, ./agentcrm.json, the only site, or `site use`)." };
export const AS_OPTION = { name: "as", type: "string" as const, description: "Act as this CRM user (email or id) instead of the site's user." };
export const YES_OPTION = { name: "yes", type: "boolean" as const, description: "Apply — only after the user confirmed the plan." };
