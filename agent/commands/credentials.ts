import { timingSafeEqual } from "node:crypto";
import { copyToClipboard, fromAwsProfile, fromEnv, fromGh, promptHidden } from "../credentialSources";
import { forgetFirebaseSession } from "../firebaseSession";
import { CREDENTIAL_TYPES, listCredentials, parseAccount, removeCredential, requireCredential, setCredential } from "../credentials";
import { CliError, printResult } from "../output";
import { PACKAGE_NAME, readVersionInfo } from "../paths";
import { listSites } from "../sites";
import type { Command } from "./types";
import { strOpt, usage } from "./util";

// Values are never printed — not even masked.

export const credentialsCommand: Command = {
  name: "credentials",
  usage: "credentials <set|list|remove|copy|verify|types> [<type>:<name>] [--from-env VAR[,VAR]] [--from-gh] [--from-aws-profile <name>] [--generate]",
  summary:
    "Store, list, copy, verify or remove access keys per account (<type>:<name>; types: s3, github, gitlab, firebase, passphrase, anthropic) in ~/.agentcrm/credentials.json (0600). `set` reads the secret from --from-env, --from-gh, --from-aws-profile, --generate (passphrases) or a hidden prompt the USER types in.",
  subcommands: [
    { name: "set", usage: "credentials set <type>:<name> [--from-env VAR[,VAR]] [--from-gh] [--from-aws-profile <p>] [--generate]", summary: "Store a credential (hidden prompt unless a --from-* source is given).", writes: true },
    { name: "list", usage: "credentials list", summary: "Accounts stored on this computer (field names only) and the sites using them." },
    { name: "remove", usage: "credentials remove <type>:<name>", summary: "Delete a stored credential.", writes: true },
    { name: "copy", usage: "credentials copy <type>:<name> [--field <f>]", summary: "Put a secret on the clipboard without printing it (save the passphrase in a password manager)." },
    { name: "verify", usage: "credentials verify <type>:<name> [--field <f>]", summary: "The USER pastes the value from their password manager at a hidden prompt: proves the saved copy is right." },
    { name: "types", usage: "credentials types", summary: "Credential types, their fields and where to create them." },
  ],
  options: [
    { name: "from-env", type: "string", description: "Read the value(s) from these environment variables (comma-separated, in field order — s3: KEY_ID,SECRET)." },
    { name: "from-gh", type: "boolean", description: "github: take the token of the signed-in GitHub CLI (gh auth token)." },
    { name: "from-aws-profile", type: "string", description: "s3: import the key pair of this aws CLI profile." },
    { name: "generate", type: "boolean", description: "passphrase: generate a strong random passphrase." },
    { name: "field", type: "string", description: "copy / verify: which field (default: the first)." },
  ],
  async run({ io, options, positionals }) {
    const [action = "list", account] = positionals;
    if (action === "types") {
      printResult(io, CREDENTIAL_TYPES, () => Object.entries(CREDENTIAL_TYPES).map(([type, c]) => `${type}: ${c.label} (${c.fields.join(", ")})\n  ${c.howTo}`).join("\n"));
      return;
    }
    if (action === "list") {
      const { sites } = listSites();
      const list = listCredentials().map((c) => ({
        ...c,
        usedBy: sites.filter((s) => Object.values(s.credentials).includes(c.account)).map((s) => s.alias),
      }));
      printResult(io, list, () => (list.length ? list.map((c) => `${c.account}  (${c.fields.join(", ")})${c.usedBy.length ? `  used by ${c.usedBy.join(", ")}` : ""}`).join("\n") : "No stored credentials."));
      return;
    }
    if (!account) usage(`credentials ${action} needs an account, e.g. s3:main.`);
    const { type } = parseAccount(account);
    const spec = CREDENTIAL_TYPES[type];
    if (action === "remove") {
      const removed = removeCredential(account);
      forgetFirebaseSession(account);
      printResult(io, { account, removed }, () => (removed ? `Removed ${account}.` : `${account} was not stored.`));
      return;
    }
    if (action === "copy" || action === "verify") {
      const cred = requireCredential(account);
      const field = strOpt(options, "field") ?? spec.fields[0];
      const stored = cred.values[field];
      if (!stored) usage(`${account} has no field "${field}".`, `Fields: ${Object.keys(cred.values).join(", ")}.`);
      if (action === "copy") {
        const tool = copyToClipboard(stored);
        printResult(io, { account, field, copied: true, tool }, () => `Copied ${field} of ${account} to the clipboard.`);
        return;
      }
      if (!process.stdin.isTTY) {
        throw new CliError("needs-terminal", "verify reads the value the USER pastes in their own terminal.", `Ask the user to run it themselves (in Claude Code: \`! npx -y ${PACKAGE_NAME}@${readVersionInfo().version} credentials verify ${account}\`).`);
      }
      try {
        copyToClipboard("");
      } catch {
        /* no clipboard tool */
      }
      io.err(`Paste the ${field} of ${account} from where you saved it (password manager), then press Enter.`);
      const typed = Buffer.from((await promptHidden(`${field}: `)).trim());
      const expected = Buffer.from(stored);
      if (typed.length !== expected.length || !timingSafeEqual(typed, expected)) {
        throw new CliError("mismatch", `That is not the ${field} of ${account}.`, `Copy it again (\`agentcrm credentials copy ${account}\`), save it again, and re-run verify.`);
      }
      printResult(io, { account, field, verified: true }, () => `${field} of ${account} verified.`);
      return;
    }
    if (action !== "set") usage(`Unknown action "${action}".`, "Use set, list, remove, copy, verify or types.");
    let values: Record<string, string>;
    if (options.generate === true) {
      if (type !== "passphrase") usage("--generate only applies to passphrase accounts.");
      const { generatePassphrase } = await import("../../src/shared/crypto");
      values = { passphrase: generatePassphrase() };
    } else if (typeof options["from-env"] === "string") {
      values = fromEnv(options["from-env"].split(",").map((s) => s.trim()), spec.fields);
    } else if (options["from-gh"] === true) {
      if (type !== "github") usage("--from-gh only applies to github accounts.");
      values = fromGh();
    } else if (typeof options["from-aws-profile"] === "string") {
      if (type !== "s3") usage("--from-aws-profile only applies to s3 accounts.");
      values = fromAwsProfile(options["from-aws-profile"]);
    } else {
      io.err(`${spec.label} for ${account}. ${spec.howTo}`);
      values = {};
      for (const field of spec.fields) values[field] = await promptHidden(`${field}: `);
    }
    const saved = setCredential(account, values);
    forgetFirebaseSession(account); // a new login starts a new session
    printResult(io, { account, type, fields: Object.keys(saved.values) }, () => `Stored ${account} (${Object.keys(saved.values).join(", ")}).`);
  },
};
