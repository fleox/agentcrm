# Theme recipes

A theme (`ext new theme <id>`) is `src/index.ts` (`defineTheme`) + an optional `src/style.css` (declared as `"style": "style.css"` in `manifest.json`). Installed and enabled, it appears in Settings, Appearance as a preset; applying it (`appearance preset <id>`) selects it as `themeId`. Its values fill everything the workspace didn't set explicitly; a user can still override any value afterwards. Logo, favicon and custom CSS stay workspace settings.

**First ask whether a theme is needed at all:** a brand color, a font, rounded corners or a dark sidebar are plain appearance settings (`agentcrm-admin` skill, `appearance set`). A theme is for a reusable, shareable look (several CRMs, a client, a marketplace) or for CSS that goes beyond the settings.

## Values

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

## Brand from a logo or a hex

1. Get the brand color: the user's hex, or the dominant non-gray color of their logo (read the SVG fill, or sample the PNG). Prefer a mid-tone (lightness 40 to 60 %): very light colors make unreadable buttons; the scale generator keeps the hue but white text needs contrast.
2. Pick `neutral` by temperature: cool blues / teals → `slate`, warm oranges / reds / greens → `stone`, otherwise `zinc`.
3. `buttons: "accent"` for a colorful brand, `"neutral"` for a sober one; `sidebar: "accent"` only for strong brands.
4. Without a theme, the same values go straight to the workspace: `appearance set --accent … --neutral … --yes` and `appearance logo logo.svg --yes`.

## CSS

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

## Test

```bash
npm run build
npx -y @fleox-agent-crm/agentcrm@0.10.0 ext check . --json
npx -y @fleox-agent-crm/agentcrm@0.10.0 ext install . --site acme --yes --json
npx -y @fleox-agent-crm/agentcrm@0.10.0 appearance preset acme-brand --site acme --json
```

`ext check` prints the resolved values (`data.theme.appearance`) and the CSS size. `appearance preset` prints the before / after plan; add `--yes` to apply. Open the admin to look at it (light and dark, a table and a record page).
