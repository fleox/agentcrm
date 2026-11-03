// en is the source of truth: every bundle ships the same keys in fr
// (plural variants — _one, _other, _many… — compared by their base key).
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

function keys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

const bundles = [
  ["core", resolve(root, "i18n")],
  ...readdirSync(resolve(root, "features"))
    .filter((f) => existsSync(resolve(root, "features", f, "i18n", "en.json")))
    .map((f) => [f, resolve(root, "features", f, "i18n")]),
];

describe("i18n parity (en ↔ fr)", () => {
  it.each(bundles)("%s", (_name, dir) => {
    const base = (list: string[]) => [...new Set(list.map((k) => k.replace(/_(zero|one|two|few|many|other)$/, "")))].sort();
    const en = base(keys(JSON.parse(readFileSync(resolve(dir, "en.json"), "utf8"))));
    const fr = base(keys(JSON.parse(readFileSync(resolve(dir, "fr.json"), "utf8"))));
    expect({ missingInFr: en.filter((k) => !fr.includes(k)), extraInFr: fr.filter((k) => !en.includes(k)) }).toEqual({ missingInFr: [], extraInFr: [] });
  });
});
