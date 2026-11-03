// The src/ai/tools.ts catalog → Messages API `tools` definitions. Read
// at call time so tools appended to AI_TOOLS show up automatically.

import { listAiTools, type AiTool } from "../tools";
import type { ApiTool } from "./types";

export function toApiTool(tool: Pick<AiTool, "name" | "description" | "inputSchema">): ApiTool {
  const schema = { ...(tool.inputSchema as Record<string, unknown>) };
  if (!schema.type) schema.type = "object";
  if (!schema.properties) schema.properties = {};
  return { name: tool.name, description: tool.description, input_schema: schema };
}

export function toApiTools(tools: readonly AiTool[] = listAiTools()): ApiTool[] {
  return tools.map(toApiTool);
}
