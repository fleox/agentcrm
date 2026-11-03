// Copies package.json's version into every file that repeats it: the
// Claude Code plugin manifest, each skill's metadata.version and every
// pinned `agentcrm@x.y.z` command in the skills. Run by the npm "version"
// lifecycle (`npm version patch|minor|major`), so a release bumps them all.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const pluginJson = join(root, "plugin", ".claude-plugin", "plugin.json");
const plugin = JSON.parse(readFileSync(pluginJson, "utf8"));
plugin.version = version;
writeFileSync(pluginJson, JSON.stringify(plugin, null, 2) + "\n");

const skillsDir = join(root, "plugin", "skills");
let files = 0;
for (const name of readdirSync(skillsDir)) {
  const dir = join(skillsDir, name);
  if (!existsSync(join(dir, "SKILL.md"))) continue;
  for (const file of walk(dir)) {
    const before = readFileSync(file, "utf8");
    let after = before.replace(/agentcrm@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g, `agentcrm@${version}`);
    if (file.endsWith("SKILL.md")) after = after.replace(/^(\s+version:\s*)["']?[^"'\n]+["']?$/m, `$1"${version}"`);
    if (after !== before) {
      writeFileSync(file, after);
      files++;
    }
  }
}
// Docs pin the same version in their copy-paste snippets.
const docs = ["README.md", "docs/templates/agentcrm-cron.yml", ...readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`)];
for (const doc of docs) {
  const file = join(root, doc);
  if (!existsSync(file)) continue;
  const before = readFileSync(file, "utf8");
  const after = before.replace(/@(?:fleox-)?agent-crm\/agentcrm@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g, `@fleox-agent-crm/agentcrm@${version}`);
  if (after !== before) {
    writeFileSync(file, after);
    files++;
  }
}
console.log(`[sync-version] ${version} → plugin.json + ${files} file(s)`);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : []));
}
