import { describe, expect, it } from "vitest";
import { setupTestCrm } from "../../ops/testing";
import { recordsOf } from "../../ops/store";
import { AI_TOOLS } from "../tools";
import { toApiTool, toApiTools } from "./tools";
import { buildSystemPrompt } from "./systemPrompt";
import { ASSISTANT_STORAGE_KEYS, DEFAULT_MAX_TOKENS, DEFAULT_MODEL, clearAssistantApiKey, loadAssistantSettings, saveAssistantSettings } from "./settings";
import { ASSISTANT_HISTORY_KEY, clearConversation, loadConversation, saveConversation } from "./history";

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), map: m };
}

describe("tool schema conversion", () => {
  it("maps every AI tool to {name, description, input_schema}", () => {
    const api = toApiTools();
    expect(api).toHaveLength(AI_TOOLS.length);
    for (const [i, t] of AI_TOOLS.entries()) {
      expect(api[i]).toEqual({ name: t.name, description: t.description, input_schema: expect.objectContaining({ type: "object" }) });
      expect(Object.keys(api[i]!)).toEqual(["name", "description", "input_schema"]);
    }
  });

  it("fills a missing properties map", () => {
    expect(toApiTool({ name: "x", description: "d", inputSchema: { type: "object" } }).input_schema).toEqual({ type: "object", properties: {} });
  });
});

describe("system prompt", () => {
  it("includes rules, schema, user, date and route", async () => {
    const crm = await setupTestCrm({ demo: true });
    const p = buildSystemPrompt({ ctx: crm.admin, route: "/objects/deals", locale: "fr", crmName: "Test CRM" });
    expect(p).toContain("AgentCRM");
    expect(p).toContain("describe_schema");
    expect(p).toMatch(/never invent/i);
    expect(p).toMatch(/user's language/);
    expect(p).toContain("Today: 2024-06-15");
    expect(p).toContain("Ada Admin <ada@example.com>, role admin, user id `owner`");
    expect(p).toContain("Current page: `/objects/deals`");
    expect(p).toContain("### companies");
    expect(p).toContain("`company`");
    expect(p).toMatch(/pipeline `[^`]+` "Sales"/);
    expect(p).toContain("UI language: fr");
  });

  it("includes the record in context", async () => {
    const crm = await setupTestCrm({ demo: true });
    const deal = recordsOf(crm.store, "deals")[0]!;
    const p = buildSystemPrompt({ ctx: crm.admin, record: { objectId: "deals", recordId: deal.id } });
    expect(p).toContain("looking at this record");
    expect(p).toContain(deal.id);
    expect(p).toContain(String(deal.fields.name));
    const missing = buildSystemPrompt({ ctx: crm.admin, record: { objectId: "deals", recordId: "nope" } });
    expect(missing).toContain("was not found");
  });
});

describe("settings storage", () => {
  it("defaults, saves and clears (key only in the given storage)", () => {
    const s = memoryStorage();
    expect(loadAssistantSettings(s)).toEqual({ apiKey: "", model: DEFAULT_MODEL, maxTokens: DEFAULT_MAX_TOKENS });
    const saved = saveAssistantSettings({ apiKey: "  sk-ant-x ", model: "claude-opus-5-5", maxTokens: 999999 }, s);
    expect(saved).toEqual({ apiKey: "sk-ant-x", model: "claude-opus-5-5", maxTokens: 64000 });
    expect(s.map.get(ASSISTANT_STORAGE_KEYS.apiKey)).toBe("sk-ant-x");
    clearAssistantApiKey(s);
    expect(loadAssistantSettings(s).apiKey).toBe("");
    expect(loadAssistantSettings(s).model).toBe("claude-opus-5-5");
  });
});

describe("conversation history", () => {
  it("round-trips, settles transient states and repairs dangling tool calls", () => {
    const s = memoryStorage();
    saveConversation(
      {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "create_record", input: {} }] },
        ],
        items: [
          { kind: "user", id: "1", text: "hi" },
          { kind: "assistant", id: "2", text: "par", streaming: true },
          { kind: "tool", id: "t1", name: "create_record", input: {}, status: "pending" },
        ],
      },
      s,
    );
    const back = loadConversation(s);
    expect(back.messages).toHaveLength(3);
    expect(back.items[1]).toMatchObject({ streaming: false });
    expect(back.items[2]).toMatchObject({ status: "error" });
    clearConversation(s);
    expect(s.map.has(ASSISTANT_HISTORY_KEY)).toBe(false);
    expect(loadConversation(s)).toEqual({ messages: [], items: [] });
  });

  it("ignores corrupt data", () => {
    const s = memoryStorage();
    s.setItem(ASSISTANT_HISTORY_KEY, "{oops");
    expect(loadConversation(s)).toEqual({ messages: [], items: [] });
  });
});
