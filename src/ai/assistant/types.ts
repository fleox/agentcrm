// Messages API shapes used by the in-admin assistant (a minimal subset of
// https://docs.anthropic.com/en/api/messages — only what we send / read).
// Pure TS, no React: the runtime under src/ai/assistant/ is UI-agnostic.

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

// Any other block the API may return (thinking, server tools…), kept
// verbatim so the conversation can be sent back unchanged.
export interface OtherBlock {
  type: string;
  [k: string]: unknown;
}

export type AssistantContentBlock = TextBlock | ToolUseBlock | OtherBlock;
export type UserContentBlock = TextBlock | ToolResultBlock;

export type ApiMessage = { role: "user"; content: string | UserContentBlock[] } | { role: "assistant"; content: AssistantContentBlock[] };

export interface ApiTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "pause_turn" | "refusal" | (string & {});

export interface AssistantTurn {
  id?: string;
  model?: string;
  content: AssistantContentBlock[];
  stopReason: StopReason | null;
  usage: Usage;
}

export function isToolUse(block: { type: string }): block is ToolUseBlock {
  return block.type === "tool_use";
}

export function isText(block: { type: string }): block is TextBlock {
  return block.type === "text";
}
