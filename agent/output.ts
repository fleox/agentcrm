// Output protocol shared by every command (mirror of cms-ia agent/output.ts).
// Agents parse --json output, so it is one JSON object per invocation:
//   success → { "ok": true, "data": … }
//   failure → { "ok": false, "error": { "code", "message", "hint"? } }
// Human mode prints plain text. Logs and progress always go to stderr.

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

// Known errors thrown by the engine, translated into codes and hints.
function knownError(error: unknown): CliError | null {
  if (!(error instanceof Error)) return null;
  if (error.name === "PassphraseError") {
    const reason = (error as Error & { reason?: string }).reason;
    return reason === "missing"
      ? new CliError("passphrase-required", "This dataset is encrypted and the site has no passphrase credential.", "Store it with `agentcrm credentials set passphrase:<alias>`.")
      : new CliError("passphrase-wrong", "Wrong passphrase: the data could not be decrypted.");
  }
  if (error.name === "OpsError") {
    const code = (error as Error & { code?: string }).code ?? "invalid";
    return new CliError(code, error.message, undefined, code === "validation" || code === "invalid" ? 2 : 1);
  }
  return null;
}

export function printError(io: Io, error: unknown): number {
  const e =
    error instanceof CliError
      ? error
      : knownError(error) ?? new CliError("internal", error instanceof Error ? error.message : String(error), "Unexpected error. Retry once; if it persists, report it with the command and this output.");
  if (io.json) io.out(JSON.stringify({ ok: false, error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) } }));
  else io.err(`Error: ${e.message}${e.hint ? `\nHint: ${e.hint}` : ""}`);
  return e.exitCode;
}
