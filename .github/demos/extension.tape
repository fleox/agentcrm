# Extension authoring demo for the README: scaffold a module, build it,
# check it, install it on the throw-away CRM prepared by setup.sh, and call
# its AI tool. The npm install step is hidden (setup.sh warms the cache).
#   .github/demos/render.sh extension
Output .github/assets/demo-extension.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 680
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WindowBar Colorful

Hide
Type "export TMPDIR=/tmp BASH_SILENCE_DEPRECATION_WARNING=1 AGENTCRM_HOME=/tmp/acrm-cli-demo/home npm_config_cache=/tmp/acrm-cli-demo/npm-cache npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false PS1='\[\e[38;5;141m\]❯\[\e[0m\] ' && cd /tmp/acrm-cli-demo/work && clear"
Enter
Sleep 500ms
Show

Set TypingSpeed 20ms
Type "alias agentcrm='npx -y @fleox-agent-crm/agentcrm@0.12.1'"
Set TypingSpeed 35ms
Sleep 300ms
Enter
Sleep 600ms

Type "agentcrm ext new module deal-radar"
Sleep 400ms
Enter
Sleep 4s

Type "cd deal-radar && npm install"
Sleep 300ms
Enter
Hide
Sleep 15s
Type "clear"
Enter
Sleep 300ms
Show

Type "npm run build --silent && ls dist"
Sleep 300ms
Enter
Sleep 3s

Type "agentcrm ext check ."
Sleep 300ms
Enter
Sleep 4s

Type "clear"
Enter
Type "agentcrm ext install . --site demo"
Sleep 400ms
Enter
Sleep 4500ms

Type "agentcrm ext install . --site demo --yes"
Sleep 400ms
Enter
Sleep 3s

Type "clear"
Enter
Type "agentcrm tools list | cut -c1-44 | tail -4"
Sleep 300ms
Enter
Sleep 3500ms

Type "agentcrm tools call deal_radar_summary --input '{}'"
Sleep 300ms
Enter
Sleep 5s
