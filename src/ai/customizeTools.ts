// AI tools for customisation (modules, appearance, extensions) — part of
// the catalog in ./tools.ts. Handlers call src/ops/ only (admin-only
// writes are enforced there).

import { BUTTON_STYLES, COLOR_MODES, CONTRASTS, DENSITIES, FONTS, NEUTRALS, RADII, SIDEBAR_STYLES, type AppearancePatch } from "../appearance";
import { applyPreset, getAppearance, listPresets, setAppearance } from "../ops/appearance";
import { OpsError } from "../ops/context";
import { listExtensions, setExtensionEnabled } from "../ops/extensions";
import { listModules, setModuleEnabled } from "../ops/modules";
import type { AiTool, JsonSchema } from "./tools";

function compactAppearance(a: ReturnType<typeof getAppearance>): Record<string, unknown> {
  const { logo, favicon, customCss, ...rest } = a;
  return { ...rest, hasLogo: !!logo, hasFavicon: !!favicon, customCssBytes: customCss ? customCss.length : 0 };
}

const appearanceProps: Record<string, JsonSchema> = {
  accent: { type: "string", description: "Accent color, hex #rrggbb (a full 50–950 scale is generated from it)." },
  neutral: { type: "string", enum: NEUTRALS, description: "Gray scale used for surfaces, borders and text." },
  radius: { type: "string", enum: RADII },
  density: { type: "string", enum: DENSITIES, description: "compact = shorter table rows and paddings." },
  font: { type: "string", enum: FONTS.map((f) => f.id), description: '"system" needs no network; the others load from Google Fonts.' },
  sidebar: { type: "string", enum: SIDEBAR_STYLES },
  defaultMode: { type: "string", enum: COLOR_MODES, description: "Default light/dark mode for users who never toggled it." },
  contrast: { type: "string", enum: CONTRASTS },
  buttons: { type: "string", enum: BUTTON_STYLES, description: "Primary buttons: neutral (near-black) or accent colored." },
  customCss: { type: ["string", "null"], description: "Extra CSS for the whole workspace (≤ 50 KB). null removes it." },
  themeId: { type: ["string", "null"], description: "Installed theme extension to use (see list_extensions); null clears it." },
};

export const CUSTOMIZE_TOOLS: AiTool[] = [
  {
    name: "list_modules",
    description:
      "List the workspace modules (built-in features such as dashboard, deals, reports, tasks, automations, forms, integrations, assistant, plus installed extension modules) with enabled / required state and dependencies.",
    inputSchema: { type: "object", properties: {} },
    mutating: false,
    handler: (ctx) =>
      listModules(ctx).map((m) => ({
        id: m.id,
        name: m.name,
        category: m.category,
        source: m.source,
        enabled: m.enabled,
        ...(m.required ? { required: true } : {}),
        ...(m.dependsOn.length ? { dependsOn: m.dependsOn } : {}),
        ...(m.dependents.length ? { dependents: m.dependents } : {}),
        ...(m.objects.length ? { objects: m.objects } : {}),
        ...(m.version ? { version: m.version } : {}),
      })),
  },
  {
    name: "set_module_enabled",
    description:
      "Enable or disable a module for the whole workspace (admin only). Disabling hides its pages, navigation and widgets (and objects, e.g. deals) without deleting data. Fails when other modules depend on it unless cascade is true.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Module id (see list_modules)." }, enabled: { type: "boolean" }, cascade: { type: "boolean", default: false, description: "Also disable dependents / enable dependencies." } },
      required: ["id", "enabled"],
    },
    mutating: true,
    handler: (ctx, input) => setModuleEnabled(ctx, String(input.id), input.enabled === true, { cascade: input.cascade === true }),
  },
  {
    name: "get_appearance",
    description: "Get the workspace appearance (accent color, neutral scale, radius, density, font, sidebar style, default mode, selected theme) and the available presets / themes.",
    inputSchema: { type: "object", properties: {} },
    mutating: false,
    handler: (ctx) => ({ appearance: compactAppearance(getAppearance(ctx)), presets: listPresets(ctx).map((p) => ({ id: p.id, name: p.name, source: p.source, description: p.description })) }),
  },
  {
    name: "set_appearance",
    description: "Change the workspace appearance for every user (admin only). Pass only the keys to change; null resets a key to its default. Applied live in every open admin.",
    inputSchema: { type: "object", properties: appearanceProps, additionalProperties: false },
    mutating: true,
    handler: async (ctx, input) => compactAppearance(await setAppearance(ctx, input as AppearancePatch)),
  },
  {
    name: "apply_appearance_preset",
    description: "Apply an appearance preset (default, ocean, forest, sunset, graphite, rose, high-contrast) or an installed theme extension id (admin only). Logo, favicon and custom CSS are kept.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Preset or theme id (see get_appearance)." } }, required: ["id"] },
    mutating: true,
    handler: async (ctx, input) => compactAppearance(await applyPreset(ctx, String(input.id))),
  },
  {
    name: "list_extensions",
    description: "List the installed extensions (external modules and themes) with version, author, enabled state and API compatibility.",
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["module", "theme"] } } },
    mutating: false,
    handler: (ctx, input) => listExtensions(ctx, input.kind === "module" || input.kind === "theme" ? { kind: input.kind } : {}),
  },
  {
    name: "set_extension_enabled",
    description: "Enable or disable an installed extension without uninstalling it (admin only). Installing new code is not possible through tools — use Settings → Modules or the CLI.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, enabled: { type: "boolean" }, cascade: { type: "boolean", default: false } }, required: ["id", "enabled"] },
    mutating: true,
    handler: (ctx, input) => {
      if (typeof input.id !== "string" || !input.id) throw new OpsError("validation", 'Missing "id".');
      return setExtensionEnabled(ctx, input.id, input.enabled === true, { cascade: input.cascade === true });
    },
  },
];
