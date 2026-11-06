#!/usr/bin/env bash
# Renders a README demo GIF with VHS from the published agentcrm package.
# Rebuilds the throw-away demo CRM first (setup.sh), so every render starts
# from the same data.
#   .github/demos/render.sh cli|schema|extension|mcp   (from the repository root)
# Needs vhs, ttyd, ffmpeg and jq (mcp: the claude CLI).
set -euo pipefail
name="${1:?usage: render.sh cli|schema|extension|mcp}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
gif=".github/assets/demo-$name.gif"
.github/demos/setup.sh
vhs ".github/demos/$name.tape"
# Smaller file: one shared palette, only the changed rectangles redrawn.
tmp=$(mktemp -d)
ffmpeg -v error -y -i "$gif" -filter_complex \
  "[0:v]split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  "$tmp/out.gif"
if [ "$(stat -f%z "$tmp/out.gif" 2>/dev/null || stat -c%s "$tmp/out.gif")" -lt "$(stat -f%z "$gif" 2>/dev/null || stat -c%s "$gif")" ]; then
  mv "$tmp/out.gif" "$gif"
fi
rm -rf "$tmp"
ls -la "$gif"
