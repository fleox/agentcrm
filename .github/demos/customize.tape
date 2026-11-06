# Customisation demo for the README (demo-customize.gif): a REAL Claude Code
# session with the agentcrm plugin (0.12.1) restyling the CRM of install.tape /
# agent.tape (appearance: accent, sidebar, font; modules switched off). Not
# reproducible as is: the recording is reviewed, then the agent's work is sped
# up with a visible label.
#
# How the environment was prepared (not recorded): exactly as agent.tape, on
# the dataset as agent.tape left it.
#
# Compose (timings of the take used):
#   .github/demos/compose.sh .github/demos/out/customize.mp4 .github/assets/demo-customize.gif 12.9 42 9 8 customize-still.png
# (first take). customize-still.png: the pipeline kanban after the take, light
# mode, captured as in install.tape.
Output ".github/demos/out/customize.mp4"

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

Type `Make the CRM match our brand: accent #0f766e, dark sidebar, Inter font, and hide lead forms and the email integration. Go ahead without asking.`
Sleep 1s
Enter
Sleep 150s
