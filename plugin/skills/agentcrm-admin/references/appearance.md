# Appearance options

`appearance set` takes any subset; `"null"` resets one value to its default. Every change is workspace-wide (all users, applied live in open admins) and prints a plan (`data.plan.changes`: key → from / to) until `--yes`.

| Option | Key | Values | Default |
|---|---|---|---|
| `--accent` | accent | any `#rrggbb` (a 50 to 950 scale is generated, 500 = this color) | `#3366ff` |
| `--neutral` | neutral | zinc, slate, stone, gray, neutral | zinc |
| `--radius` | radius | none, sm, md, lg, xl | md |
| `--density` | density | compact (shorter rows and paddings), comfortable | comfortable |
| `--font` | font | system (no network) or a Google font: inter, geist, roboto, open-sans, lato, source-sans-3, ibm-plex-sans, dm-sans, manrope, work-sans, plus-jakarta-sans, figtree, outfit, nunito-sans, poppins, space-grotesk | system |
| `--sidebar` | sidebar | default, dark, accent | default |
| `--mode` | defaultMode | system, light, dark (only for users who never toggled the mode themselves) | system |
| `--buttons` | buttons | neutral (near-black), accent | neutral |
| `--contrast` | contrast | normal, high | normal |
| `--theme` | themeId | an installed, enabled theme extension id | none |

Changing a visual value marks the preset `custom`. Other actions:

- `appearance preset <id>`: default, ocean, forest, sunset, graphite, rose, high-contrast, or a theme extension id. Keeps logo, favicon, custom CSS and the default mode.
- `appearance logo <file>` / `appearance favicon <file>`: PNG, JPEG, GIF, WebP, SVG or ICO, at most 200 KB (SVGs with scripts or event handlers are refused); `--remove` deletes it.
- `appearance css <file|->`: plain CSS (no `<style>` / `<script>`), at most 50 KB, loaded last; `--remove` deletes it. Style through the CSS variables (`--acc-50` to `--acc-950`, `--srf-50` to `--srf-950`, `--primary`, `--radius-scale`, `--font-sans`, `--row-h`…) as `rgb(var(--acc-600))`.
- `appearance reset`: back to defaults, keeping logo and favicon (`--branding` removes them too).
- `appearance get --full` includes the logo / favicon data URLs and the custom CSS.

Choosing a palette for a brand: keep the accent a mid-tone (very light accents make buttons hard to read); slate for cool brands, stone for warm ones; `--sidebar accent` only for strong brands; offer `--contrast high` when the user mentions accessibility.
