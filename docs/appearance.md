# Appearance

Settings → **Appearance** changes how the admin looks for **every user** of the workspace: colors, shape, density, font, sidebar, buttons, contrast, default light / dark mode, logo, favicon, custom CSS — or one click on a preset or an installed theme. Changes apply live in every open admin. Admins edit; other roles see the settings read-only.

The same settings are available to agents: the `agentcrm appearance` CLI command, the AI tools `get_appearance`, `set_appearance`, `apply_appearance_preset` (MCP + in-admin assistant), and the MCP resource `agentcrm://appearance`.

## Options

| Setting | Key | Values | Default |
|---|---|---|---|
| Accent color | `accent` | any `#rrggbb`. A full 50 → 950 scale is generated in OKLCH (500 = your color, gamut-mapped), used for links, focus rings, selected items, charts and — with *accent buttons* — primary buttons. | `#3366ff` |
| Neutral grays | `neutral` | `zinc`, `slate` (cool), `stone` (warm), `gray`, `neutral` | `zinc` |
| Corner radius | `radius` | `none`, `sm`, `md`, `lg`, `xl` (multiplies every radius: 0, 0.5, 1, 1.35, 1.75) | `md` |
| Density | `density` | `comfortable`, `compact` (shorter table rows, controls and paddings) | `comfortable` |
| Font | `font` | `system` (no network request) or a Google font loaded only when chosen: `inter`, `geist`, `roboto`, `open-sans`, `lato`, `source-sans-3`, `ibm-plex-sans`, `dm-sans`, `manrope`, `work-sans`, `plus-jakarta-sans`, `figtree`, `outfit`, `nunito-sans`, `poppins`, `space-grotesk` | `system` |
| Sidebar | `sidebar` | `default` (light / dark with the page), `dark` (always dark), `accent` (accent-colored) | `default` |
| Buttons | `buttons` | `neutral` (near-black primary buttons), `accent` (accent-colored) | `neutral` |
| Contrast | `contrast` | `normal`, `high` (stronger borders and secondary text) | `normal` |
| Default mode | `defaultMode` | `system`, `light`, `dark` — for users who never chose themselves (each user's own choice stays in their browser) | `system` |
| Logo | `logo` | image data URL (PNG, JPEG, GIF, WebP, SVG without scripts / event handlers), ≤ 200 KB — shown in the sidebar next to the workspace name | none |
| Favicon | `favicon` | image data URL (PNG, ICO, SVG…), ≤ 200 KB | none |
| Custom CSS | `customCss` | plain CSS, ≤ 50 KB, no `<style>` / `<script>`; loaded last | none |
| Theme | `themeId` | an installed, enabled theme extension | none |
| Preset | `preset` | the preset / theme last applied, or `custom` once a value is changed | `default` |

Resolution: defaults ← the selected theme's values ← the values set explicitly for the workspace.

## Presets

| Id | Look |
|---|---|
| `default` | Neutral zinc grays, blue accent, near-black buttons. |
| `ocean` | Cool slate grays, teal-blue accent (`#0891b2`), large radius, accent buttons. |
| `forest` | Warm stone grays, green accent (`#16a34a`), dark sidebar, accent buttons. |
| `sunset` | Orange accent (`#ea580c`), stone grays, extra-rounded corners. |
| `graphite` | Monochrome (`#52525b`), compact, small radius, dark sidebar. |
| `rose` | Rose accent (`#e11d48`) with an accent-colored sidebar. |
| `high-contrast` | Strong borders and text, small radius, deep blue accent — accessibility first. |

Installed theme extensions are listed after the built-ins ([creating-a-theme.md](creating-a-theme.md)). Applying a preset replaces the visual values and keeps the logo, favicon, custom CSS and default mode. **Reset** goes back to the defaults and keeps logo and favicon (CLI `--branding` removes them too).

## CLI

```bash
npx -y @fleox-agent-crm/agentcrm@0.5.0 appearance get --site acme
npx -y @fleox-agent-crm/agentcrm@0.5.0 appearance presets --site acme
npx -y @fleox-agent-crm/agentcrm@0.5.0 appearance set --site acme --accent "#0f766e" --neutral stone --radius lg --buttons accent        # plan
npx -y @fleox-agent-crm/agentcrm@0.5.0 appearance set --site acme --accent "#0f766e" --neutral stone --radius lg --buttons accent --yes
npx -y @fleox-agent-crm/agentcrm@0.5.0 appearance set --site acme --radius null --yes                     # back to the default radius
npx -y @fleox-agent-crm/agentcrm@0.5.0 appearance preset ocean --site acme --yes
npx -y @fleox-agent-crm/agentcrm@0.5.0 appearance logo ./logo.svg --site acme --yes
npx -y @fleox-agent-crm/agentcrm@0.5.0 appearance favicon ./favicon.png --site acme --yes
npx -y @fleox-agent-crm/agentcrm@0.5.0 appearance css ./brand.css --site acme --yes
npx -y @fleox-agent-crm/agentcrm@0.5.0 appearance reset --site acme --yes
```

Options of `set`: `--accent`, `--neutral`, `--radius`, `--density`, `--font`, `--sidebar`, `--mode` (default mode), `--buttons`, `--contrast`, `--theme`. Without `--yes`, every change prints the plan: `data.plan.changes` = `{ key: { from, to } }`.

## With an AI agent

> "Make the CRM look like our brand: here is our logo." — the agent reads the dominant color of the logo, proposes an accent, grays and button style, shows you the before / after and applies them with the logo.
>
> "Use #e4002b as the main color, compact tables and a dark sidebar."
>
> "We have visually impaired users — make it easier to read."  (high contrast, system font, comfortable density)

## Custom CSS variables

Custom CSS and theme CSS should style through these variables (colors are space-separated `r g b` triplets — use `rgb(var(--acc-600))` or `rgb(var(--acc-600) / 0.5)`):

| Variable | |
|---|---|
| `--acc-50` … `--acc-950` | Accent scale (11 steps). |
| `--srf-50` … `--srf-950`, `--srf-850` | Neutral scale (surfaces, borders, text). |
| `--acc-fg` | Readable text color on `--acc-600`. |
| `--primary`, `--primary-hover`, `--primary-fg` | Primary buttons (accent or neutral, per the *buttons* setting). |
| `--radius-scale` | Multiplier of every border radius. |
| `--font-sans` | Font family. |
| `--row-h`, `--ctl-h` | Table row height, control (input / button) height. |
| `--card-pad`, `--card-head-py`, `--page-py` | Card padding, card header padding, page header padding. |

Attributes on `<html>`: `data-density`, `data-sidebar`, `data-contrast`, `data-buttons`, `data-radius`; dark mode is the `dark` class on `<html>`. The accent sidebar carries `.acrm-sidebar-accent`. Stylesheet order: appearance variables, theme CSS (`#agentcrm-theme-css`), custom CSS (`#agentcrm-custom-css`, last).

Example:

```css
/* Brand headings, softer page background in light mode. */
html:root h1 { color: rgb(var(--acc-700)); }
html:root:not(.dark) body { background: rgb(var(--srf-50)); }
```

## Notes

- The appearance is stored in the CRM's data (`config/appearance`) — encrypted with the rest on file backends — and cached in each browser to avoid a flash of the default look on load.
- Choosing a Google font makes each admin load it from `fonts.googleapis.com`; `system` makes no request.
