// Output protocol shared by every command (mirror of cms-ia agent/output.ts).
// Agents parse --json output, so it is one JSON object per invocation:
//   success → { "ok": true, "data": … }
//   failure → { "ok": false, "error": { "code", "message", "hint"? } }
// Human mode prints plain text. Logs and progress always go to stderr so
// they never corrupt the JSON on stdout. Exit codes: 0 ok, 1 failure,
// 2 usage error (bad arguments, invalid plan, validation).

export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

export interface Io {
  json: boolean;
  out(text: string): void;
  err(text: string): void;
}

export function createIo(json: boolean): Io {
  return {
    json,
    out: (text) => process.stdout.write(text.endsWith("\n") ? text : text + "\n"),
    err: (text) => process.stderr.write(text.endsWith("\n") ? text : text + "\n"),
  };
}

export function printResult(io: Io, data: unknown, human: () => string): void {
  if (io.json) io.out(JSON.stringify({ ok: true, data }));
  else io.out(human());
}

const OPS_HINTS: Record<string, string> = {
  forbidden: "The CRM user the CLI acts as lacks this permission (see `site show` → user, `users list`). Ask an admin, or re-register the site with an admin user (`site add … --user <email>`).",
  notFound: "Check the id (list commands print them: `records list --object …`, `objects list`, `views list`…).",
  validation: "Fix the input: `objects get <object>` lists field ids, types and select options.",
  conflict: "Something with the same key already exists — list it first, then update instead of creating.",
  invalid: "Check the arguments with `agentcrm help <command>`.",
};

export const MODULE_DEPENDENCY_HINT =
  "Re-run with --cascade to also switch the listed modules (the plan shows every change), or enable / disable them first (`agentcrm modules list`).";

// Known errors thrown by the engine, translated into codes and hints an
// agent can act on.
export function knownError(error: unknown): CliError | null {
  if (!(error instanceof Error)) return null;
  if (error.name === "PassphraseError") {
    const reason = (error as Error & { reason?: string }).reason;
    return reason === "missing"
      ? new CliError(
          "passphrase-required",
          "This dataset is encrypted and the site has no passphrase credential.",
          "Store it (`agentcrm credentials set passphrase:<alias>` in the user's own terminal), then attach it: `agentcrm site credentials <alias> --passphrase-credential passphrase:<alias>`.",
        )
      : new CliError("passphrase-wrong", "Wrong passphrase: the data could not be decrypted.", "Store the right one with `agentcrm credentials set <the site's passphrase account>` (see `site show`).");
  }
  if (error.name === "OpsError") {
    const code = (error as Error & { code?: string }).code ?? "invalid";
    const details = (error as Error & { details?: { blockers?: unknown; dependents?: unknown } }).details;
    // Module dependency conflicts (modules / ext enable & disable, ext uninstall).
    const hint =
      code === "conflict" && Array.isArray(details?.blockers)
        ? MODULE_DEPENDENCY_HINT
        : code === "conflict" && Array.isArray(details?.dependents)
          ? `Disable the modules that depend on it first (${(details.dependents as string[]).join(", ")}: \`agentcrm modules disable <id> --yes\`), or pass --force.`
          : OPS_HINTS[code];
    return new CliError(code, error.message, hint, code === "validation" || code === "invalid" ? 2 : 1);
  }
  if (error.name === "FieldValidationError") {
    return new CliError("validation", error.message, OPS_HINTS.validation, 2);
  }
  if (error.name === "DocConflictError") {
    return new CliError("conflict", `The data changed elsewhere while this command ran: ${error.message}`, "Run the same command again (it reloads the latest data).");
  }
  if (error.name === "StorageError") {
    const status = (error as Error & { status?: number }).status ?? 0;
    const hint =
      status === 401 || status === 403
        ? "The storage refused the credentials: check the key pair / token and its permissions (`agentcrm doctor`)."
        : status === 404
          ? "Bucket, repository or path not found: check the names in the plan / site."
          : status === 0
            ? "Network error or CORS: check the endpoint URL and the connection."
            : "Retry once; run `agentcrm doctor` if it persists.";
    return new CliError("storage", `${error.message}${status ? ` (HTTP ${status})` : ""}`, hint);
  }
  return null;
}

export function toCliError(error: unknown): CliError {
  return error instanceof CliError
    ? error
    : knownError(error) ??
        new CliError(
          "internal",
          error instanceof Error ? error.message : String(error),
          "Unexpected error. Retry once; if it persists, report it with the command and this output.",
        );
}

export function printError(io: Io, error: unknown): number {
  const e = toCliError(error);
  if (io.json) io.out(JSON.stringify({ ok: false, error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) } }));
  else io.err(`Error: ${e.message}${e.hint ? `\nHint: ${e.hint}` : ""}`);
  return e.exitCode;
}
