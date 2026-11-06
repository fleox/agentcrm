# Install demo for the README (demo-install.gif): a REAL Claude Code session
# with the agentcrm plugin (marketplace fleox/agentcrm, plugin 0.12.1, CLI
# @fleox-agent-crm/agentcrm@0.12.1) installing a CRM on this computer only:
# encrypted journal in a local folder + the admin served by `agentcrm serve`.
# Not reproducible as is: the recording is reviewed, then the agent's work is
# sped up with a visible label.
#
# How the environment was prepared (not recorded):
# - /tmp/agentcrm-demo-agent/.claude/settings.json: extraKnownMarketplaces
#   agentcrm (github fleox/agentcrm), enabledPlugins agentcrm@agentcrm, the
#   agentcrm CLI (`npx -y @fleox-agent-crm/agentcrm*`) pre-approved; the folder
#   was trusted by running claude there once; plugin installed at project scope
#   (`claude plugin install agentcrm@agentcrm --scope project`).
# - CLAUDE_CODE_PLUGIN_CACHE_DIR=/tmp/agentcrm-demo-plugins so the skill paths
#   shown on screen are not under the owner's home.
# - SHELL=/bin/bash for the agent's Bash tool (the owner's login shell is zsh),
#   with an exported `ls` function adding -g -o so `ls -l` output shows no
#   owner / group (the macOS account name). Nothing else is altered.
# - AGENTCRM_HOME=/tmp/agentcrm-demo-home (isolated CLI state) holding one
#   credential, generated beforehand so no secret is ever typed or shown:
#     npx -y @fleox-agent-crm/agentcrm@0.12.1 credentials set passphrase:northwind-studio --generate
#
# The prompt names no port on purpose: with a port the agent tends to add a
# siteUrl to the local-folder hosting, and the admin URL then points at
# <siteUrl>/admin/ while `serve --dir` needs the admin folder itself.
#
# Compose (timings of the take used):
#   .github/demos/compose.sh .github/demos/out/install.mp4 .github/assets/demo-install.gif 17.9 53.5 10 8 install-still.png
# (take used: 5th; earlier takes stumbled on `serve --dir <hosting path>`, see the note above).
# install-still.png: the admin served locally (`agentcrm serve --dir crm-admin/admin`)
# opening THIS dataset in headless Chrome, 1440x810, dark. Headless Chrome has no
# folder picker, so the dataset's files (byte for byte, still encrypted) were
# copied into the page's origin-private file system and that directory handle
# was stored where the picker stores it; the passphrase was typed into the
# masked unlock field by the capture script (never shown).
Output ".github/demos/out/install.mp4"

Set Shell "bash"
Set FontSize 20
Set Width 1600
Set Height 900
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WindowBar Colorful

Hide
Type `export BASH_SILENCE_DEPRECATION_WARNING=1; ls(){ command ls -g -o "$@"; }; export -f ls; unset $(compgen -e | grep -E '^CLAUDE'); export SHELL=/bin/bash CLAUDE_CODE_PLUGIN_CACHE_DIR=/tmp/agentcrm-demo-plugins AGENTCRM_HOME=/tmp/agentcrm-demo-home`
Enter
Type "alias claude='claude --setting-sources project,local' && export PS1='\[\e[38;5;141m\]❯\[\e[0m\] ' && cd /tmp/agentcrm-demo-agent && clear"
Enter
Sleep 500ms
Show

Type "claude"
Enter
Sleep 7s

Type `Install AgentCRM for "Northwind Studio" on this computer: data encrypted in ./crm-data with the passphrase I already stored, demo data, owner Maya Patel (maya@northwind.test), admin in ./crm-admin served locally with agentcrm serve. Don't ask me anything; give me the admin URL at the end.`
Sleep 1s
Enter
Sleep 180s
