# Use the CRM from an MCP client

`agentcrm mcp` is a stdio MCP server: tools = the AI tool catalog (search, list, get, create, update, delete, merge records, notes, activities, tasks, pipeline moves, reports, CSV import), resources = schema and pipelines, prompts = pipeline review, follow-up email, lead qualification. `--read-only` hides every tool that writes.

Claude Code:

```bash
claude mcp add agentcrm -- npx -y @agent-crm/agentcrm@0.2.0 mcp --site <alias>
```

Claude Desktop (`claude_desktop_config.json`) and Cursor (`.cursor/mcp.json`):

```json
{ "mcpServers": { "agentcrm": { "command": "npx", "args": ["-y", "@agent-crm/agentcrm@0.2.0", "mcp", "--site", "<alias>"] } } }
```

The server uses the credentials of this computer (`~/.agentcrm`) and acts as the site's CLI user.
