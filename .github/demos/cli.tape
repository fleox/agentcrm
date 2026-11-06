# "Run the CRM from the terminal" demo for the README: the published
# agentcrm CLI on a throw-away CRM (encrypted journal in a local folder,
# demo data) prepared by setup.sh.
#   .github/demos/render.sh cli   (from the repository root; needs vhs, ttyd, ffmpeg)
Output .github/assets/demo-cli.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 680
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WindowBar Colorful

Hide
Type "export TMPDIR=/tmp BASH_SILENCE_DEPRECATION_WARNING=1 AGENTCRM_HOME=/tmp/acrm-cli-demo/home npm_config_cache=/tmp/acrm-cli-demo/npm-cache npm_config_update_notifier=false PS1='\[\e[38;5;141m\]❯\[\e[0m\] ' && cd /tmp/acrm-cli-demo/work && clear"
Enter
Sleep 500ms
Show

Type "npx -y @fleox-agent-crm/agentcrm@0.12.2 stats"
Sleep 400ms
Enter
Sleep 3s

Set TypingSpeed 20ms
Type "alias agentcrm='npx -y @fleox-agent-crm/agentcrm@0.12.2'"
Set TypingSpeed 35ms
Sleep 300ms
Enter
Sleep 800ms

Type "agentcrm records list --object deals --filter stage:eq:negotiation"
Sleep 400ms
Enter
Sleep 4s

Type "clear"
Enter
Type "agentcrm records create --object people --set firstName=Grace --set lastName=Hopper"
Sleep 400ms
Enter
Sleep 2500ms

Type "agentcrm pipelines move 0fx394r1cltirl Won"
Sleep 400ms
Enter
Sleep 4s

Type "clear"
Enter
Type 'agentcrm tasks add --title "Send the contract" --due 2026-11-13 --record 0fx394r1cltirl'
Sleep 400ms
Enter
Sleep 3500ms

Type "agentcrm report pipeline"
Sleep 400ms
Enter
Sleep 6s
