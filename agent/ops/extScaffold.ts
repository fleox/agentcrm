import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EXTENSION_API_VERSION, RUNTIME_SPECIFIERS } from "../../src/extensions/api";
import { EXTENSION_ID_RE, RESERVED_EXTENSION_IDS } from "../../src/extensions/package";
import { CliError } from "../output";
import { ownPackageRoot, packageRoot, PACKAGE_NAME, readVersionInfo } from "../paths";

// `agentcrm ext new module|theme <id>` — a standalone extension project
// (its own package.json, Vite build, typings copied from the CLI's
// types/agentcrm-runtime.d.ts) that builds to dist/bundle.js and packs to
// the ZIP the admin installs. Mirror of external/ (the shipped examples).

export interface ScaffoldOptions {
  kind: "module" | "theme";
  id: string;
  dir: string;
  name?: string;
  description?: string;
  author?: string;
}

export interface ScaffoldResult {
  kind: "module" | "theme";
  id: string;
  dir: string;
  files: string[];
  next: string[];
}

// Generated sources start lines with `${IMPORT}` so the CLI bundle has no
// line that looks like a bare import (agent/bundle.test.ts).
const IMPORT = "import";

// Same majors as the AgentCRM admin build (React 18, Vite 6). TypeScript 5:
// react-i18next 15 declares an (optional) peer typescript@^5, so npm 7+
// refuses TypeScript 6 without --legacy-peer-deps.
const DEV_DEPENDENCIES: Record<string, string> = {
  "@types/react": "^18.3.31",
  i18next: "^23.16.8",
  "lucide-react": "^0.460.0",
  react: "^18.3.1",
  "react-i18next": "^15.7.4",
  typescript: "^5.9.3",
  vite: "^6.4.5",
};

export function titleOf(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function toolNameOf(id: string): string {
  return `${id.replace(/-/g, "_")}_summary`.slice(0, 64);
}

function viteConfig(entry: string): string {
  return `// Vite config of an AgentCRM extension. What matters:
//   1. Library mode, ONE ESM file dist/bundle.js default-exporting
//      defineModule({...}) / defineTheme({...}).
//   2. The runtime specifiers stay external: the admin maps them to its own
//      React, router, i18n and UI kit at runtime. Never bundle react.
//   3. inlineDynamicImports: the admin only loads bundle.js (chunks 404).
//   4. Production JSX (the admin doesn't provide react/jsx-dev-runtime).
${IMPORT} { defineConfig } from "vite";

export const RUNTIME_EXTERNALS = ${JSON.stringify(RUNTIME_SPECIFIERS)};

export default defineConfig({
  esbuild: { jsx: "automatic", jsxDev: false },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  logLevel: "warn",
  build: {
    lib: { entry: ${JSON.stringify(entry)}, formats: ["es"], fileName: () => "bundle.js" },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
    rollupOptions: { external: RUNTIME_EXTERNALS, output: { inlineDynamicImports: true } },
  },
});
`;
}

const TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    lib: ["ES2022", "DOM", "DOM.Iterable"],
    module: "ESNext",
    moduleResolution: "Bundler",
    jsx: "react-jsx",
    strict: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noEmit: true,
    isolatedModules: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    types: [],
    // The public typings of the runtime API, copied from the agentcrm CLI.
    paths: { "@agent-crm/runtime": ["./types/agentcrm-runtime.d.ts"] },
  },
  include: ["src", "types"],
};

function moduleSource(id: string, name: string): string {
  const tool = toolNameOf(id);
  return `// ${name} — an AgentCRM module extension.
//   - a page at /${id} with a navigation entry,
//   - a tab on every record page,
//   - an AI tool \`${tool}\` (MCP, in-admin assistant, \`agentcrm tools\`),
//   - English + French strings (namespace "${id}": t("${id}:key")).
// Everything comes from \`@agent-crm/runtime\` (the admin's own instances).
// Recipes (custom objects, dashboard widgets, automation actions, settings
// pages with module config): docs/creating-a-module.md.
${IMPORT} { Puzzle } from "lucide-react";
${IMPORT} { useTranslation } from "react-i18next";
${IMPORT} { Card, PageHeader, defineModule, formatDateTime, intlLocale, ops, recordLabel, useActivities, useCurrentUser, useObjects, useRecords, type RecordSlotProps } from "@agent-crm/runtime";

const ID = ${JSON.stringify(id)};

const en = {
  nav: ${JSON.stringify(name)},
  title: ${JSON.stringify(name)},
  intro: "Hi {{name}}! This page comes from the {{id}} extension.",
  counts: "Records in this workspace",
  tab: ${JSON.stringify(name)},
  tabBody: "“{{label}}” was created {{date}} and has {{count}} activities.",
};
const fr: typeof en = {
  nav: ${JSON.stringify(name)},
  title: ${JSON.stringify(name)},
  intro: "Bonjour {{name}} ! Cette page vient de l'extension {{id}}.",
  counts: "Fiches de cet espace",
  tab: ${JSON.stringify(name)},
  tabBody: "« {{label}} » a été créée le {{date}} et a {{count}} activités.",
};

function MainPage() {
  const { t } = useTranslation(ID);
  const me = useCurrentUser();
  const objects = useObjects();
  const records = useRecords(undefined);
  return (
    <div>
      <PageHeader title={t("title")} icon={<Puzzle />} />
      <div className="space-y-4 p-6">
        <p className="text-sm text-surface-600 dark:text-surface-300">{t("intro", { name: me.name, id: ID })}</p>
        <Card title={t("counts")}>
          <ul className="space-y-1 text-sm">
            {objects.map((o) => (
              <li key={o.id} className="flex justify-between">
                <span>{o.labelPlural}</span>
                <span className="tabular-nums text-surface-500">{records.filter((r) => r.object === o.id).length}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function RecordTab({ record, object }: RecordSlotProps) {
  const { t } = useTranslation(ID);
  const activities = useActivities(record.id);
  return <p className="p-4 text-sm text-surface-600 dark:text-surface-300">{t("tabBody", { label: recordLabel(object, record), date: formatDateTime(record.createdAt, intlLocale()), count: activities.length })}</p>;
}

export default defineModule({
  id: ID,
  apiVersion: ${JSON.stringify(EXTENSION_API_VERSION)},
  feature: {
    routes: [{ path: "/${id}", element: <MainPage /> }],
    navItems: [{ id: ID, label: \`\${ID}:nav\`, icon: Puzzle, to: "/${id}", section: "workspace", order: 60 }],
    i18n: { en, fr },
    slots: { recordDetailTabs: [{ id: ID, label: \`\${ID}:tab\`, icon: Puzzle, order: 90, component: RecordTab }] },
  },
  aiTools: [
    {
      name: ${JSON.stringify(tool)},
      description: "Example tool of the ${id} extension: how many records each object holds (optionally only one object).",
      inputSchema: { type: "object", properties: { object: { type: "string", description: "Only this object id (e.g. companies)." } } },
      mutating: false,
      handler: (ctx, input) => {
        const objects = ops.listObjects(ctx).filter((o) => !input.object || o.id === input.object);
        return { counts: Object.fromEntries(objects.map((o) => [o.id, ops.listRecords(ctx, o.id, { limit: 1 }).total])) };
      },
    },
  ],
});
`;
}

function themeSource(id: string, name: string, description: string): string {
  return `// ${name} — an AgentCRM theme extension. A theme is a set of appearance
// values (any subset of Settings → Appearance) plus optional CSS
// (src/style.css, packed as style.css, injected while the theme is
// selected). Users can still override any value in Settings → Appearance.
// Values and CSS variables: docs/creating-a-theme.md, docs/appearance.md.
${IMPORT} { defineTheme } from "@agent-crm/runtime";

export default defineTheme({
  id: ${JSON.stringify(id)},
  apiVersion: ${JSON.stringify(EXTENSION_API_VERSION)},
  name: ${JSON.stringify(name)},
  description: ${JSON.stringify(description)},
  appearance: {
    accent: "#0f766e",
    neutral: "stone",
    radius: "lg",
    density: "comfortable",
    font: "system",
    sidebar: "dark",
    buttons: "accent",
    contrast: "normal",
    defaultMode: "system",
  },
});
`;
}

const THEME_CSS = `/* Extra CSS of the theme (≤ 256 KB), injected while it is selected.
   Prefer the appearance values in src/index.ts; use this for details.
   Colors are "r g b" triplets: rgb(var(--acc-500)). Variables:
   --acc-50…950, --srf-50…950 (+850), --primary, --radius-scale,
   --font-sans, --row-h, --ctl-h, --card-pad… (docs/appearance.md). */

/* Slightly stronger page headers. */
html:root h1 {
  letter-spacing: -0.01em;
}
`;

function readme(kind: "module" | "theme", id: string, name: string, cliVersion: string): string {
  const cli = `npx -y ${PACKAGE_NAME}@${cliVersion}`;
  return `# ${name}

An AgentCRM ${kind} extension (\`${id}\`).

## Develop

\`\`\`bash
npm install
npm run typecheck     # against types/agentcrm-runtime.d.ts (the runtime API)
npm run build         # → dist/bundle.js
npm run check         # validates and loads the bundle like the admin does
npm run pack          # → ${id}-<version>.zip
\`\`\`

Install it on a CRM (shows a plan first — installing runs this code with the
rights of every admin who opens the CRM):

\`\`\`bash
${cli} ext install . --site <alias>
${cli} ext install . --site <alias> --yes
\`\`\`

Or upload the ZIP in the admin: Settings → Modules → Installed extensions.

## Files

- \`manifest.json\` — id, kind, name, version (bump it for every release), apiVersion, description${kind === "module" ? ", icon, category, dependsOn" : ", style"}.
- \`src/index.${kind === "module" ? "tsx" : "ts"}\` — the default export (\`${kind === "module" ? "defineModule" : "defineTheme"}({...})\`).${kind === "theme" ? "\n- `src/style.css` — extra CSS packed as style.css." : ""}
- \`types/agentcrm-runtime.d.ts\` — the runtime API typings (copied from the CLI; refresh with \`${cli} ext new ${kind} ${id} --dir /tmp/x\` and copy the file).
- \`vite.config.ts\` — keeps react, react-i18next, lucide-react and @agent-crm/runtime external (the admin provides them).

Docs: https://github.com/fleox/agentcrm/blob/master/docs/${kind === "module" ? "creating-a-module.md" : "creating-a-theme.md"}
`;
}

export function scaffoldExtension(opts: ScaffoldOptions): ScaffoldResult {
  const { kind, id, dir } = opts;
  if (!EXTENSION_ID_RE.test(id)) throw new CliError("usage", `Invalid id "${id}".`, "3–50 characters: lowercase letters, digits and dashes, starting with a letter (e.g. my-module).", 2);
  if (RESERVED_EXTENSION_IDS.includes(id)) throw new CliError("usage", `"${id}" is reserved (built-in module or reserved word).`, "Pick another id, e.g. acme-" + id + ".", 2);
  const name = opts.name?.trim() || titleOf(id);
  const description = opts.description?.trim() || (kind === "module" ? `${name}: a page, a record tab and an AI tool for AgentCRM.` : `${name}: an AgentCRM theme.`);
  const cliVersion = readVersionInfo().version;
  const typings = [join(packageRoot(), "types", "agentcrm-runtime.d.ts"), join(ownPackageRoot(), "types", "agentcrm-runtime.d.ts")].find((p) => existsSync(p)) ?? join(ownPackageRoot(), "types", "agentcrm-runtime.d.ts");
  if (!existsSync(typings)) throw new CliError("internal", `types/agentcrm-runtime.d.ts not found next to the CLI (${typings}).`);

  const manifest: Record<string, unknown> = {
    id,
    kind,
    name,
    version: "0.1.0",
    apiVersion: EXTENSION_API_VERSION,
    description,
    ...(opts.author ? { author: opts.author } : {}),
    entry: "bundle.js",
    ...(kind === "module" ? { icon: "Puzzle", category: "customisation" } : { style: "style.css" }),
  };
  const cli = `npx -y ${PACKAGE_NAME}@${cliVersion}`;
  const pkg = {
    name: id,
    version: "0.1.0",
    private: true,
    type: "module",
    description,
    scripts: {
      build: "vite build",
      typecheck: "tsc --noEmit",
      check: `${cli} ext check .`,
      pack: `${cli} ext pack .`,
    },
    devDependencies: DEV_DEPENDENCIES,
  };
  const entry = kind === "module" ? "src/index.tsx" : "src/index.ts";
  const files: Record<string, string> = {
    "package.json": JSON.stringify(pkg, null, 2) + "\n",
    "manifest.json": JSON.stringify(manifest, null, 2) + "\n",
    "vite.config.ts": viteConfig(entry),
    "tsconfig.json": JSON.stringify(TSCONFIG, null, 2) + "\n",
    "README.md": readme(kind, id, name, cliVersion),
    ".gitignore": "node_modules/\ndist/\n*.zip\n",
    [entry]: kind === "module" ? moduleSource(id, name) : themeSource(id, name, description),
    ...(kind === "theme" ? { "src/style.css": THEME_CSS } : {}),
  };
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  mkdirSync(join(dir, "types"), { recursive: true });
  copyFileSync(typings, join(dir, "types", "agentcrm-runtime.d.ts"));
  return {
    kind,
    id,
    dir,
    files: [...Object.keys(files), "types/agentcrm-runtime.d.ts"].sort(),
    next: [
      `cd ${dir}`,
      "npm install",
      "npm run build",
      `${cli} ext check .`,
      `${cli} ext install . --site <alias>   (plan; add --yes once the user agrees)`,
    ],
  };
}
