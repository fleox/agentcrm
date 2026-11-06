# MCP demo for the README: register the published agentcrm MCP server in
# Claude Code (a throw-away HOME, never the maintainer's own config), check
# it connects, and call the same tool catalog from the terminal.
#   .github/demos/render.sh mcp
Output .github/assets/demo-mcp.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 680
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WindowBar Colorful

Hide
Type "export TMPDIR=/tmp BASH_SILENCE_DEPRECATION_WARNING=1 HOME=/tmp/acrm-cli-demo/claude-home AGENTCRM_HOME=/tmp/acrm-cli-demo/home npm_config_cache=/tmp/acrm-cli-demo/npm-cache npm_config_update_notifier=false PS1='\[\e[38;5;141m\]❯\[\e[0m\] ' && cd /tmp/acrm-cli-demo/work && clear"
Enter
Sleep 500ms
Show

Type "claude mcp add agentcrm -- npx -y @fleox-agent-crm/agentcrm@0.12.1 mcp --site demo"
Sleep 400ms
Enter
Sleep 3s

Type "claude mcp list"
Sleep 300ms
Enter
Sleep 6s

Type "clear"
Enter
Set TypingSpeed 20ms
Type "alias agentcrm='npx -y @fleox-agent-crm/agentcrm@0.12.1'   # the same tools, from a shell"
Set TypingSpeed 35ms
Sleep 300ms
Enter
Sleep 600ms

Type `agentcrm tools call search_records --input '{"query":"acme","limit":2}'`
Sleep 400ms
Enter
Sleep 6s
