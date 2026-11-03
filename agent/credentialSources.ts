import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CliError } from "./output";

// Ways to fill a credential without the secret ever passing through an
// agent's conversation: environment variables, tools the user is already
// signed in to (gh, aws), or a hidden prompt in the user's own terminal.

export function fromEnv(names: string[], fields: string[]): Record<string, string> {
  if (names.length !== fields.length) {
    throw new CliError("usage", `--from-env needs ${fields.length} variable name(s) (${fields.join(", ")}), comma-separated.`, undefined, 2);
  }
  return Object.fromEntries(
    fields.map((field, i) => {
      const value = process.env[names[i]];
      if (!value) throw new CliError("env-missing", `Environment variable ${names[i]} is empty or not set.`);
      return [field, value];
    }),
  );
}

export function fromGh(host?: string): Record<string, string> {
  try {
    const args = ["auth", "token", ...(host ? ["--hostname", host] : [])];
    const token = execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (!token) throw new Error("empty");
    return { token };
  } catch {
    throw new CliError(
      "gh-unavailable",
      "Could not read a token from the GitHub CLI.",
      "Install gh and run `gh auth login`, or create a fine-grained token and use `credentials set` without --from-gh.",
    );
  }
}

// Minimal INI reader for ~/.aws/credentials (honours AWS_SHARED_CREDENTIALS_FILE).
export function parseIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section: Record<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const s = /^\[([^\]]+)\]$/.exec(line);
    if (s) {
      section = out[s[1].trim()] = {};
      continue;
    }
    const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (kv && section) section[kv[1].trim()] = kv[2].trim();
  }
  return out;
}

export function fromAwsProfile(profile: string): Record<string, string> {
  const file = process.env.AWS_SHARED_CREDENTIALS_FILE || join(homedir(), ".aws", "credentials");
  if (!existsSync(file)) throw new CliError("aws-missing", `No aws credentials file at ${file}.`, "Run `aws configure` first.");
  const section = parseIni(readFileSync(file, "utf8"))[profile];
  if (!section?.aws_access_key_id || !section.aws_secret_access_key) {
    throw new CliError("aws-profile-missing", `Profile "${profile}" has no access key pair in ${file}.`);
  }
  return { accessKeyId: section.aws_access_key_id, secretAccessKey: section.aws_secret_access_key };
}

// Reads one line from the terminal without echoing it.
export async function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    throw new CliError(
      "needs-terminal",
      "No terminal to type the secret in.",
      "Ask the user to run this command themselves in their terminal (in Claude Code: prefix it with `!`), or pass --from-env / --from-gh / --from-aws-profile.",
    );
  }
  process.stderr.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const done = (err?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done();
        if (ch === "\u0003") return done(new CliError("cancelled", "Cancelled."));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

// Puts a secret on the clipboard without printing it (the user pastes it
// into a password manager or a form).
export function copyToClipboard(text: string): string {
  const candidates: [string, string[]][] =
    process.platform === "darwin"
      ? [["pbcopy", []]]
      : process.platform === "win32"
        ? [["clip", []]]
        : [
            ["wl-copy", []],
            ["xclip", ["-selection", "clipboard"]],
            ["xsel", ["--clipboard", "--input"]],
          ];
  for (const [cmd, args] of candidates) {
    const res = spawnSync(cmd, args, { input: text, stdio: ["pipe", "ignore", "ignore"] });
    if (res.status === 0) return cmd;
  }
  throw new CliError("no-clipboard", "No clipboard tool found (pbcopy, clip, wl-copy, xclip or xsel).", "Install one, or read the value from ~/.agentcrm/credentials.json yourself.");
}
