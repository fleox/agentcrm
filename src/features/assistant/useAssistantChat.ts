// React state around the pure runtime (src/ai/assistant/): conversation
// (persisted per tab), streaming display items, pending approvals, Stop.

import { useCallback, useEffect, useRef, useState } from "react";
import type { OpsContext } from "../../ops/context";
import { findTool } from "../../ai/tools";
import {
  appendUserContent,
  clearConversation,
  loadConversation,
  runAssistantLoop,
  saveConversation,
  settleItems,
  type ApprovalDecision,
  type AssistantSettings,
  type DisplayItem,
  type LoopEvent,
  type StoredConversation,
} from "../../ai/assistant";

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export interface SendOptions {
  ctx: OpsContext;
  settings: AssistantSettings;
  system: string;
}

export interface AssistantChat {
  items: DisplayItem[];
  running: boolean;
  send(text: string, opts: SendOptions): void;
  stop(): void;
  newChat(): void;
  decide(toolUseId: string, decision: ApprovalDecision): void;
}

type Labels = { stopped: string; maxIterations: (n: number) => string };

export function useAssistantChat(labels: Labels): AssistantChat {
  const [conv, setConv] = useState<StoredConversation>(() => loadConversation());
  const [running, setRunning] = useState(false);
  const convRef = useRef(conv);
  convRef.current = conv;
  const controllerRef = useRef<AbortController | null>(null);
  const approvalsRef = useRef(new Map<string, (d: ApprovalDecision) => void>());
  // "Always allow" choices, for the rest of this page session.
  const autoApprovedRef = useRef(new Set<string>());
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  // Persist when idle (streaming deltas would rewrite storage constantly).
  useEffect(() => {
    if (!running) saveConversation(conv);
  }, [conv, running]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const updateItems = useCallback((fn: (items: DisplayItem[]) => DisplayItem[]) => {
    setConv((c) => ({ ...c, items: fn(c.items) }));
  }, []);

  const upsertTool = useCallback(
    (id: string, patch: Partial<Extract<DisplayItem, { kind: "tool" }>> & { name: string }) => {
      updateItems((items) => {
        const i = items.findIndex((it) => it.kind === "tool" && it.id === id);
        if (i === -1) return [...items, { kind: "tool", id, input: undefined, status: "running", mutating: findTool(patch.name)?.mutating, ...patch }];
        const next = items.slice();
        next[i] = { ...(items[i] as Extract<DisplayItem, { kind: "tool" }>), ...patch };
        return next;
      });
    },
    [updateItems],
  );

  const send = useCallback(
    (text: string, opts: SendOptions) => {
      const trimmed = text.trim();
      if (!trimmed || controllerRef.current) return;
      const controller = new AbortController();
      controllerRef.current = controller;
      setRunning(true);
      const runId = uid("run");
      const messages = appendUserContent(convRef.current.messages, trimmed);
      setConv((c) => ({ messages, items: [...c.items, { kind: "user", id: uid("u"), text: trimmed }] }));

      const onEvent = (ev: LoopEvent) => {
        switch (ev.type) {
          case "text": {
            const id = `${runId}-a${ev.iteration}`;
            updateItems((items) => {
              const i = items.findIndex((it) => it.id === id);
              if (i === -1) return [...items, { kind: "assistant", id, text: ev.delta, streaming: true }];
              const next = items.slice();
              const cur = items[i] as Extract<DisplayItem, { kind: "assistant" }>;
              next[i] = { ...cur, text: cur.text + ev.delta };
              return next;
            });
            break;
          }
          case "assistant_message": {
            const id = `${runId}-a${ev.iteration}`;
            updateItems((items) => items.map((it) => (it.id === id && it.kind === "assistant" ? { ...it, streaming: false } : it)));
            break;
          }
          case "approval_pending":
            upsertTool(ev.id, { name: ev.name, input: ev.input, status: "pending" });
            break;
          case "approval_resolved":
            approvalsRef.current.delete(ev.id);
            break;
          case "tool_start":
            upsertTool(ev.id, { name: ev.name, input: ev.input, status: "running" });
            break;
          case "tool_end":
            upsertTool(ev.id, { name: ev.name, status: ev.rejected ? "rejected" : ev.isError ? "error" : "done", result: ev.result });
            break;
          case "error":
            updateItems((items) => [...items, { kind: "error", id: uid("e"), message: ev.error.message }]);
            break;
          case "max_iterations":
            updateItems((items) => [...items, { kind: "notice", id: uid("n"), text: labelsRef.current.maxIterations(ev.iterations) }]);
            break;
          default:
            break;
        }
      };

      void runAssistantLoop({
        ctx: opts.ctx,
        apiKey: opts.settings.apiKey,
        model: opts.settings.model,
        maxTokens: opts.settings.maxTokens,
        system: opts.system,
        messages,
        signal: controller.signal,
        autoApproved: autoApprovedRef.current,
        requestApproval: (req) => new Promise<ApprovalDecision>((resolve) => approvalsRef.current.set(req.id, resolve)),
        onEvent,
      }).then((result) => {
        // "New chat" during the run: drop its outcome.
        if (controllerRef.current !== controller) return;
        controllerRef.current = null;
        approvalsRef.current.clear();
        setConv((c) => ({
          messages: result.messages,
          items: [...settleItems(c.items), ...(result.status === "aborted" ? [{ kind: "notice" as const, id: uid("n"), text: labelsRef.current.stopped }] : [])],
        }));
        setRunning(false);
      });
    },
    [updateItems, upsertTool],
  );

  const stop = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    approvalsRef.current.clear();
    clearConversation();
    setConv({ messages: [], items: [] });
    setRunning(false);
  }, []);

  const decide = useCallback((toolUseId: string, decision: ApprovalDecision) => {
    const resolve = approvalsRef.current.get(toolUseId);
    if (!resolve) return;
    approvalsRef.current.delete(toolUseId);
    resolve(decision);
  }, []);

  return { items: conv.items, running, send, stop, newChat, decide };
}
