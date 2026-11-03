import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runtimeApi } from "../src/extensions/runtime";

// docs/runtime-api-reference.md documents every value export of
// `@agent-crm/runtime` (src/extensions/runtime.ts runtimeApi), and every
// type exported by types/agentcrm-runtime.d.ts.

const root = resolve(__dirname, "..");
const doc = readFileSync(resolve(root, "docs/runtime-api-reference.md"), "utf8");

describe("docs/runtime-api-reference.md", () => {
  it("lists every runtime value export", () => {
    const missing = Object.keys(runtimeApi).filter((name) => !doc.includes(`\`${name}\``));
    expect(missing).toEqual([]);
  });

  it("lists every exported type of the public typings", () => {
    const dts = readFileSync(resolve(root, "types/agentcrm-runtime.d.ts"), "utf8");
    const types = [...dts.matchAll(/^export (?:interface|type) (\w+)/gm)].map((m) => m[1]);
    expect(types.length).toBeGreaterThan(40);
    expect(types.filter((name) => !doc.includes(`\`${name}\``))).toEqual([]);
  });
});
