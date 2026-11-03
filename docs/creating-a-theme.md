# Creating a theme

A theme extension packages an AgentCRM look — appearance values plus optional CSS — so it can be installed on any CRM and picked in Settings → Appearance like a built-in preset. See [extensions.md](extensions.md) for the package format and installing, [appearance.md](appearance.md) for every option and CSS variable.

## Scaffold

```bash
npx -y @agent-crm/agentcrm@0.3.0 ext new theme acme-brand --author "Acme"
cd acme-brand
npm install
```

```
acme-brand/
  manifest.json      kind "theme", "style": "style.css"
  src/index.ts       defineTheme({ id, apiVersion, name, description, appearance })
  src/style.css      optional extra CSS (packed as style.css)
  vite.config.ts, tsconfig.json, types/agentcrm-runtime.d.ts, package.json, README.md
```

## Writing it

A theme (`ext new theme <id>`) is `src/index.ts` (`defineTheme`) + an optional `src/style.css` (declared as `"style": "style.css"` in `manifest.json`). Installed and enabled, it appears in Settings, Appearance as a preset; applying it (`appearance preset <id>`) selects it as `themeId`. Its values fill everything the workspace didn't set explicitly; a user can still override any value afterwards. Logo, favicon and custom CSS stay workspace settings.

**First ask whether a theme is needed at all:** a brand color, a font, rounded corners or a dark sidebar are plain appearance settings (Settings → Appearance, or `agentcrm appearance set`). A theme is for a reusable, shareable look (several CRMs, a client, a marketplace) or for CSS that goes beyond the settings.

### Values

```ts
import { defineTheme } from "@agent-crm/runtime";

export default defineTheme({
  id: "acme-brand",
  apiVersion: "1.0.0",
  name: "Acme",
  description: "Acme green, warm grays, dark sidebar.",
  appearance: {
    accent: "#0f766e",        // any #rrggbb; a 50…950 scale is generated (500 = this color)
    neutral: "stone",         // zinc | slate | stone | gray | neutral
    radius: "lg",             // none | sm | md | lg | xl
    density: "comfortable",   // compact | comfortable
    font: "inter",            // system (no network) | inter | geist | roboto | open-sans | lato | source-sans-3 | ibm-plex-sans | dm-sans | manrope | work-sans | plus-jakarta-sans | figtree | outfit | nunito-sans | poppins | space-grotesk
    sidebar: "dark",          // default | dark | accent
    buttons: "accent",        // neutral (near-black) | accent
    contrast: "normal",       // normal | high
    defaultMode: "system",    // system | light | dark (users who never toggled)
  },
});
```

Any subset works; unknown keys or bad values make `ext check` fail. Don't set `logo`, `favicon`, `preset` or `themeId` in a theme.

### Brand from a logo or a hex

1. Get the brand color: the user's hex, or the dominant non-gray color of their logo (read the SVG fill, or sample the PNG). Prefer a mid-tone (lightness 40 to 60 %): very light colors make unreadable buttons; the scale generator keeps the hue but white text needs contrast.
2. Pick `neutral` by temperature: cool blues / teals → `slate`, warm oranges / reds / greens → `stone`, otherwise `zinc`.
3. `buttons: "accent"` for a colorful brand, `"neutral"` for a sober one; `sidebar: "accent"` only for strong brands.
4. Without a theme, the same values go straight to the workspace: `appearance set --accent … --neutral … --yes` and `appearance logo logo.svg --yes`.

### CSS

`style.css` (and `css` in `defineTheme`, same effect) is injected while the theme is selected, before the workspace's custom CSS. Style through the design tokens rather than class names, which can change:

```css
/* Colors are "r g b" triplets. */
html:root {
  --srf-50: 250 250 249;                 /* page background in light mode */
}
html:root .acrm-sidebar-accent {}        /* the colored sidebar */
html[data-density="compact"] {}          /* density / contrast / radius / buttons / sidebar are data- attributes on <html> */
.dark h1 { color: rgb(var(--acc-300)); } /* dark mode = .dark on <html> */
```

Variables: `--acc-50` … `--acc-950` (accent scale), `--srf-50` … `--srf-950` + `--srf-850` (neutral scale), `--acc-fg`, `--primary`, `--primary-hover`, `--primary-fg`, `--radius-scale` (multiplies every radius), `--font-sans`, `--row-h`, `--ctl-h`, `--card-pad`, `--card-head-py`, `--page-py`. Attributes on `<html>`: `data-density`, `data-sidebar`, `data-contrast`, `data-buttons`, `data-radius`. Limits: style.css 256 KB. No `@import` of remote fonts (the CRM loads Google Fonts only when `font` asks for one).

## Ship it

```bash
npm run build
npx -y @agent-crm/agentcrm@0.3.0 ext check .        # validates the values like Settings → Appearance
npx -y @agent-crm/agentcrm@0.3.0 ext pack .         # acme-brand-0.1.0.zip
npx -y @agent-crm/agentcrm@0.3.0 ext install . --site acme --yes
npx -y @agent-crm/agentcrm@0.3.0 appearance preset acme-brand --site acme --yes
```

Disabling or uninstalling a selected theme falls back to the workspace's own values. With an AI agent: *"Make a theme from our logo (logo.svg) and apply it"* — the agent picks the accent from the logo, scaffolds, checks and installs the theme (asking before installing), or simply sets the values with `appearance set` when no reusable theme is needed.
