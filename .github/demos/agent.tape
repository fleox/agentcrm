# Day-to-day demo for the README (demo-agent.gif): a REAL Claude Code session
# with the agentcrm plugin (0.12.1) working on the CRM installed by
# install.tape (same folder, same local encrypted dataset, demo data):
# CSV import with duplicate skipping, a stage move, follow-up tasks on idle
# deals, the pipeline forecast. Not reproducible as is: the recording is
# reviewed, then the agent's work is sped up with a visible label.
#
# How the environment was prepared (not recorded): same as install.tape
# (demo folder settings, CLAUDE_CODE_PLUGIN_CACHE_DIR, AGENTCRM_HOME), right
# after the install take, except the agent's shell: macOS bash 3.2 makes Claude
# Code refuse some compound commands, so the Bash tool runs
# /tmp/agentcrm-demo-bin/zsh (`exec /bin/zsh -o shwordsplit "$@"`), and
# /tmp/agentcrm-demo-bin/ls (`exec /bin/ls -g -o "$@"`, first on PATH) keeps
# the macOS account name out of `ls -l` output.
# Plus ./leads.csv: 8 fictitious trade-show leads (.test / example.com
# addresses), two of them with the email of an existing demo contact.
#
# Compose (timings of the take used):
#   COLORS=128 FASTFPS=3 .github/demos/compose.sh .github/demos/out/agent.mp4 .github/assets/demo-agent.gif 16.1 177 10 16 agent-still.png
# (take used: 3rd; earlier takes ran under macOS bash 3.2, which Claude Code
# refuses for some compound commands). agent-still.png: the pipeline kanban of
# this dataset right after the take, captured as in install.tape.
Output ".github/demos/out/agent.mp4"

Set Shell "bash"
Set FontSize 20
Set Width 1600
Set Height 900
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WindowBar Colorful

Hide
Type `export BASH_SILENCE_DEPRECATION_WARNING=1; unset $(compgen -e | grep -E '^CLAUDE'); export PATH=/tmp/agentcrm-demo-bin:$PATH SHELL=/tmp/agentcrm-demo-bin/zsh CLAUDE_CODE_SHELL=/tmp/agentcrm-demo-bin/zsh CLAUDE_CODE_PLUGIN_CACHE_DIR=/tmp/agentcrm-demo-plugins AGENTCRM_HOME=/tmp/agentcrm-demo-home`
Enter
Type "alias claude='claude --setting-sources project,local' && export PS1='\[\e[38;5;141m\]❯\[\e[0m\] ' && cd /tmp/agentcrm-demo-agent && clear"
Enter
Sleep 500ms
Show

Type "claude"
Enter
Sleep 7s

Type `Import the leads in ./leads.csv (skip duplicates), move the Hooli consulting retainer deal to Negotiation, create follow-up tasks for every open deal with no activity in 14 days, then show me the pipeline forecast. Go ahead without asking.`
Sleep 1s
Enter
Sleep 200s
