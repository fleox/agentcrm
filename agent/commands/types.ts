import type { Io } from "../output";

export interface CommandOption {
  name: string;
  type: "string" | "boolean";
  description: string;
  multiple?: boolean;
}

export interface CommandContext {
  io: Io;
  options: Record<string, string | boolean | undefined>;
  positionals: string[];
}

export interface Command {
  name: string;
  usage: string;
  summary: string;
  options: CommandOption[];
  run(ctx: CommandContext): Promise<number | void>;
}
