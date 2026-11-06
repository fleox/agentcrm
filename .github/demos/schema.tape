# Schema as code + mirroring an external source, for the README: the
# published agentcrm CLI on the throw-away CRM prepared by setup.sh (which
# also writes crm-schema.json, day1.json and day2.json).
#   .github/demos/render.sh schema
Output .github/assets/demo-schema.gif

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

Set TypingSpeed 20ms
Type "alias agentcrm='npx -y @fleox-agent-crm/agentcrm@0.12.1'"
Set TypingSpeed 35ms
Sleep 300ms
Enter
Sleep 600ms

Type "cat crm-schema.json"
Sleep 300ms
Enter
Sleep 3500ms

Type "agentcrm schema apply crm-schema.json"
Sleep 400ms
Enter
Sleep 3500ms

Type "clear"
Enter
Type "agentcrm schema apply crm-schema.json --yes"
Sleep 400ms
Enter
Sleep 2500ms

Type "agentcrm schema apply crm-schema.json"
Sleep 400ms
Enter
Sleep 2500ms

Type "clear"
Enter
Type "agentcrm records sync --object markets --key code --archive-field archived --rows @day1.json --yes"
Sleep 400ms
Enter
Sleep 2500ms

Type "diff day1.json day2.json"
Sleep 300ms
Enter
Sleep 3500ms

Type "agentcrm records sync --object markets --key code --archive-field archived --rows @day2.json"
Sleep 400ms
Enter
Sleep 3500ms

Type "agentcrm records sync --object markets --key code --archive-field archived --rows @day2.json --yes"
Sleep 400ms
Enter
Sleep 3500ms
