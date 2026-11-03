// Lockstep guard for the extension runtime:
//   1. (vitest) the value exports of `runtimeApi` (src/extensions/runtime.ts),
//      of the stub public/runtime/agentcrm-runtime.js and of the public
//      typings types/agentcrm-runtime.d.ts are identical; the generated
//      third-party stubs export every name of the installed packages.
//   2. (tsc) every real export is assignable to its curated declaration
//      and the key contract types are mutually assignable — changing a real
//      signature breaks `npm run typecheck` until the .d.ts follows.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RUNTIME_GLOBAL, RUNTIME_MODULES } from "./api";
import { installRuntime, runtimeApi, type RuntimeApi } from "./runtime";
import type * as Curated from "../../types/agentcrm-runtime";
import type { Appearance as RealAppearance, ThemeDefinition as RealTheme } from "../appearance/types";
import type { ExtensionManifest as RealManifest, ModuleDefinition as RealModuleDefinition } from "./types";
import type { CrmRecord, ObjectDef, FieldDef, Activity, Pipeline, CrmUser, ViewDef, CrmSettings } from "../core/types";
import type { AutomationActionParam } from "../ops/automations/extensionActions";
import type { ModuleInfo } from "../ops/modules";

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

function stubExports(src: string): Set<string> {
  const names = new Set([...src.matchAll(/^export const (\w+)\s*=/gm)].map((m) => m[1]));
  for (const m of src.matchAll(/^export const \{([^}]*)\}\s*=/gm)) for (const n of m[1].split(",")) if (n.trim()) names.add(n.trim());
  return names;
}

function curatedExports(src: string): Set<string> {
  return new Set([...src.matchAll(/^export (?:declare )?(?:const|let|var|function|class|enum) (\w+)/gm)].map((m) => m[1]));
}

const diff = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x)).sort();

describe("@agent-crm/runtime value exports", () => {
  const runtime = new Set(Object.keys(runtimeApi));
  const stub = stubExports(read("public/runtime/agentcrm-runtime.js"));
  const curated = curatedExports(read("types/agentcrm-runtime.d.ts"));

  it("has a sane number of exports", () => {
    expect(runtime.size).toBeGreaterThan(60);
  });

  it("stub = runtimeApi", () => {
    expect({ missingFromStub: diff(runtime, stub), notInRuntime: diff(stub, runtime) }).toEqual({ missingFromStub: [], notInRuntime: [] });
  });

  it("d.ts = runtimeApi", () => {
    expect({ missingFromDts: diff(runtime, curated), notInRuntime: diff(curated, runtime) }).toEqual({ missingFromDts: [], notInRuntime: [] });
  });

  it("installs the global with every stubbed module", () => {
    const g = installRuntime();
    expect((globalThis as Record<string, unknown>)[RUNTIME_GLOBAL]).toBe(g);
    for (const spec of Object.keys(RUNTIME_MODULES)) {
      if (spec === "@agent-crm/runtime" || spec === "lucide-react") continue;
      expect(g.modules[spec as keyof typeof g.modules], spec).toBeTruthy();
    }
  });

  it("loads lucide-react on demand", async () => {
    const g = installRuntime();
    await g.prepare(["lucide-react"]);
    expect(typeof (g.modules["lucide-react"] as Record<string, unknown>).Target).toBe("object");
  });

  it.each(Object.entries(RUNTIME_MODULES).filter(([s]) => s !== "@agent-crm/runtime"))("stub of %s exports every name of the package", async (spec, file) => {
    const mod = (await import(spec)) as Record<string, unknown>;
    const names = new Set(Object.keys(mod).filter((k) => k !== "default" && /^[A-Za-z_$][\w$]*$/.test(k)));
    const stubNames = stubExports(read(`public/runtime/${file}`));
    expect(diff(names, stubNames), `run: node scripts/gen-runtime-stubs.mjs`).toEqual([]);
  });

  it("the import map of index.html maps every runtime specifier", () => {
    const html = read("index.html");
    const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)![1]) as { imports: Record<string, string> };
    expect(map.imports).toEqual(Object.fromEntries(Object.entries(RUNTIME_MODULES).map(([s, f]) => [s, `./runtime/${f}`])));
  });
});

// ─── Compile-time checks (never executed) ──────────────────────────────

// Every real value must fit its curated declaration (`typeof Curated` only
// holds value exports, so a missing / extra key is a compile error too).
export function _curatedFromReal(r: RuntimeApi): typeof Curated {
  return { ...r };
}

type Mutual<R, C> = [R] extends [C] ? ([C] extends [R] ? true : { error: "curated → real fails"; curated: C }) : { error: "real → curated fails"; real: R };
type Expect<T extends true> = T;

export type _MutualChecks = [
  Expect<Mutual<RealAppearance, Curated.Appearance>>,
  Expect<Mutual<RealTheme, Curated.ThemeDefinition>>,
  Expect<Mutual<RealManifest, Curated.ExtensionManifest>>,
  Expect<Mutual<CrmRecord, Curated.CrmRecord>>,
  Expect<Mutual<ObjectDef, Curated.ObjectDef>>,
  Expect<Mutual<FieldDef, Curated.FieldDef>>,
  Expect<Mutual<Activity, Curated.Activity>>,
  Expect<Mutual<Pipeline, Curated.Pipeline>>,
  Expect<Mutual<CrmUser, Curated.CrmUser>>,
  Expect<Mutual<ViewDef, Curated.ViewDef>>,
  Expect<Mutual<CrmSettings, Curated.CrmSettings>>,
  Expect<Mutual<AutomationActionParam, Curated.AutomationActionParam>>,
  Expect<Mutual<ModuleInfo, Curated.ModuleInfo>>,
];

// A module written against the curated types is accepted by the loader.
export function _curatedModuleFitsReal(def: Curated.ModuleDefinition): RealModuleDefinition {
  return def as unknown as RealModuleDefinition;
}
