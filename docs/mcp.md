# MCP server

`agentcrm mcp` turns a CRM into a [Model Context Protocol](https://modelcontextprotocol.io) server on stdio, so Claude Desktop, Claude Code, Cursor or any MCP client can search, read and update it.

```bash
npx -y @agent-crm/agentcrm@0.1.0 mcp --site acme [--read-only] [--as <user email>]
```

The server uses this computer's AgentCRM state (`~/.agentcrm`: the registered site and its credentials) — install or register the CRM first (`agentcrm install` / `agentcrm site add`). It acts as the site's CLI user; roles apply.

## Client configuration

**Claude Code**

```bash
claude mcp add agentcrm -- npx -y @agent-crm/agentcrm@0.1.0 mcp --site acme
# read-only:
claude mcp add agentcrm-ro -- npx -y @agent-crm/agentcrm@0.1.0 mcp --site acme --read-only
```

**Claude Desktop** — `claude_desktop_config.json` (Settings → Developer → Edit config):

```json
{
  "mcpServers": {
    "agentcrm": {
      "command": "npx",
      "args": ["-y", "@agent-crm/agentcrm@0.1.0", "mcp", "--site", "acme"]
    }
  }
}
```

**Cursor** — `.cursor/mcp.json` in the project (or `~/.cursor/mcp.json`): the same `mcpServers` object.

Desktop apps may not see your shell's `PATH`: use the absolute path of `npx` (`which npx`) as `command` if the server doesn't start. Several CRMs = several entries with different `--site`.

## Protocol

- JSON-RPC 2.0, one message per line on stdin / stdout (logs on stderr). Batches are answered as arrays.
- Protocol version `2025-06-18` (also accepts `2025-03-26` and `2024-11-05`; an unknown version gets `2025-06-18`).
- Methods: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/templates/list`, `resources/read`, `prompts/list`, `prompts/get`, `logging/setLevel`.
- Implemented by hand in `agent/mcp/server.ts` (no SDK), tested in `agent/mcp/server.test.ts` and over a spawned process in `agent/bundle.test.ts`.

## Tools

Exactly the AI catalog of `src/ai/tools.ts` (also used by the in-admin assistant and `agentcrm tools list|call`): `describe_schema`, `search_records`, `list_records`, `get_record`, `create_record`, `update_record`, `delete_record`, `merge_records`, `add_note`, `log_activity`, `create_task`, `complete_task`, `list_tasks`, `list_activities`, `move_deal_stage`, `pipeline_summary`, `run_report`, `create_field`, `import_csv`, plus the automation tools.

- `annotations.readOnlyHint` = the tool doesn't write; `destructiveHint` for delete / merge / import / update; `idempotentHint` where repeating is harmless.
- `tools/call` returns `structuredContent` (the JSON result) and a `text` content with the same JSON. Engine errors (validation, forbidden, not found) come back as `isError: true` results with `{ error: { code, message, hint } }`, so the model can correct itself; unknown tools are JSON-RPC errors (`-32602`).
- `--read-only` hides every mutating tool and refuses calls to them.
- Before each call the server pulls remote changes (at most every 5 s); mutating calls take the site lock.

## Resources

| URI | Content |
|---|---|
| `agentcrm://schema` | Objects, fields (ids, types, options, relations) and pipelines (`describe_schema`) |
| `agentcrm://pipelines` | Pipelines with stages and the current forecast |

## Prompts

| Name | Arguments | What it asks the model to do |
|---|---|---|
| `pipeline_review` | `pipelineId?`, `ownerId?` | Totals by stage, forecast, stale deals, one next best action per at-risk deal |
| `follow_up_email` | `recordId`, `goal?`, `tone?` | Read the timeline and draft a specific follow-up email; log it only after approval |
| `lead_qualification` | `recordId` | BANT assessment, recommended lifecycle stage, fit score and next step |
