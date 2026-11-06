#!/usr/bin/env bash
# Turns a recorded agent session (VHS mp4, 1600x900) into a README GIF
# (1200 wide): real time until the prompt is sent, the agent's work sped up
# (visible "sped up xN" label), a hold on the final answer, and optionally a
# still of the result (a 1440x810 admin screenshot, padded on the terminal
# background).
#   .github/demos/compose.sh <in.mp4> <out.gif> <prompt-sent s> <agent-done s> <hold s> <speed 8|16> [still.png]
# COLORS=<n> (default 160) and FASTFPS=<n> (frame rate of the sped-up part,
# default 5) keep a long take under ~5 MB.
set -euo pipefail
in="$1"; out="$2"; sent="$3"; done="$4"; hold="$5"; speed="$6"; still="${7:-}"
dir="$(dirname "$0")"
end=$(echo "$done + $hold" | bc)
inputs=(-i "$in" -i "$dir/speed-label-$speed.png")
graph="[0:v]scale=1200:675:flags=lanczos,setsar=1,split=3[v0][v1][v2];\
[v0]trim=0:$sent,setpts=PTS-STARTPTS,fps=10,format=rgba[a];\
[v1]trim=$sent:$done,setpts=(PTS-STARTPTS)/$speed,fps=${FASTFPS:-5},format=rgba[b0];[b0][1:v]overlay=W-w-24:14[b];\
[v2]trim=$done:$end,setpts=PTS-STARTPTS,fps=10,format=rgba[c];"
n=3; parts="[a][b][c]"
if [ -n "$still" ]; then
  inputs+=(-loop 1 -t 4 -i "$still")
  graph+="[2:v]scale=1152:648:flags=lanczos,pad=1200:675:(ow-iw)/2:(oh-ih)/2:color=0x1e1e2e,setsar=1,fps=10,format=rgba[d];"
  n=4; parts="[a][b][c][d]"
fi
graph+="${parts}concat=n=$n:v=1:a=0,split[x][y];[x]palettegen=max_colors=${COLORS:-160}:stats_mode=diff[p];[y][p]paletteuse=dither=none:diff_mode=rectangle"
ffmpeg -v error -y "${inputs[@]}" -filter_complex "$graph" "$out"
ls -la "$out"
