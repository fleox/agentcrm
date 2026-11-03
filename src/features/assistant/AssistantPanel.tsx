// The assistant slide-over (globalOverlays slot): always mounted inside
// the signed-in shell so the conversation survives open / close; opened by
// the "assistant.toggle" / "assistant.ask" shell events and Cmd/Ctrl+J.

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { KeyRound, MessageSquarePlus, Send, Settings2, Sparkles, Square, X } from "lucide-react";
import { Button, EmptyState, IconButton, Kbd, ObjectIcon, Spinner, Textarea } from "../../components/ui";
import { cn } from "../../shared/lib/utils";
import { emitShellEvent, useShellEvent } from "../../app/shellEvents";
import { useObject, useOps, useRecord, useSettings } from "../../app/CrmDataContext";
import { paths } from "../../app/paths";
import { recordLabel } from "../../core/fields";
import { buildSystemPrompt, loadAssistantSettings, type PromptRecordContext } from "../../ai/assistant";
import { ASSISTANT_ASK, ASSISTANT_SETTINGS_CHANGED, ASSISTANT_TOGGLE, ASSISTANT_VISIBILITY, parseAskDetail } from "./events";
import { ChatItemView } from "./ChatItems";
import { useAssistantChat } from "./useAssistantChat";

function routeRecord(pathname: string): PromptRecordContext | null {
  const m = matchPath("/objects/:objectId/:recordId", pathname);
  return m?.params.objectId && m.params.recordId ? { objectId: m.params.objectId, recordId: m.params.recordId } : null;
}

function ContextChip({ context, onRemove }: { context: PromptRecordContext; onRemove(): void }) {
  const { t } = useTranslation("assistant");
  const object = useObject(context.objectId);
  const record = useRecord(context.recordId);
  if (!object || !record || record.object !== context.objectId) return null;
  return (
    <div className="mb-2 flex items-center gap-1.5">
      <span className="text-2xs font-medium uppercase tracking-wide text-surface-400">{t("context.label")}</span>
      <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-surface-200 bg-surface-50 py-0.5 pl-1.5 pr-0.5 text-xs text-surface-700 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200">
        <ObjectIcon name={object.icon} color={object.color} />
        <span className="truncate">{recordLabel(object, record)}</span>
        <button type="button" onClick={onRemove} aria-label={t("context.remove")} title={t("context.remove")} className="rounded p-0.5 text-surface-400 hover:bg-surface-200 hover:text-surface-700 dark:hover:bg-surface-700">
          <X className="h-3 w-3" />
        </button>
      </span>
    </div>
  );
}

export function AssistantPanel() {
  const { t, i18n } = useTranslation("assistant");
  const ops = useOps();
  const crmSettings = useSettings();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(loadAssistantSettings);
  const [draft, setDraft] = useState("");
  const [pinned, setPinned] = useState<PromptRecordContext | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const chat = useAssistantChat(
    useMemo(() => ({ stopped: t("notice.stopped"), maxIterations: (n: number) => t("notice.maxIterations", { count: n }) }), [t]),
  );

  // Context: explicit "Ask AI" record, else the record page we're on.
  const fromRoute = useMemo(() => routeRecord(location.pathname), [location.pathname]);
  const lastPath = useRef(location.pathname);
  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    setPinned(null);
    setDismissed(false);
  }, [location.pathname]);
  const context = dismissed ? null : pinned ?? fromRoute;

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  useShellEvent(ASSISTANT_TOGGLE, () => setOpen((o) => !o));
  useShellEvent(ASSISTANT_ASK, (detail) => {
    const ask = parseAskDetail(detail);
    if (ask) {
      setPinned({ objectId: ask.objectId, recordId: ask.recordId });
      setDismissed(false);
      if (ask.prompt) setDraft(ask.prompt);
    }
    setOpen(true);
    focusInput();
  });
  useShellEvent(ASSISTANT_SETTINGS_CHANGED, () => setSettings(loadAssistantSettings()));

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    emitShellEvent(ASSISTANT_VISIBILITY, { open });
    if (open) {
      setSettings(loadAssistantSettings());
      focusInput();
    }
  }, [open]);

  // Follow the conversation.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.items, open]);

  const submit = useCallback(
    (text: string) => {
      if (!text.trim() || chat.running || !settings.apiKey) return;
      const system = buildSystemPrompt({ ctx: ops, route: location.pathname, record: context, locale: i18n.language, crmName: crmSettings.name });
      chat.send(text, { ctx: ops, settings, system });
      setDraft("");
    },
    [chat, settings, ops, location.pathname, context, i18n.language, crmSettings.name],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(draft);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(draft);
    }
  };

  if (!open) return null;

  const hasKey = !!settings.apiKey;
  const lastItem = chat.items[chat.items.length - 1];
  const waiting = chat.running && !(lastItem?.kind === "assistant" && lastItem.streaming) && !(lastItem?.kind === "tool" && (lastItem.status === "pending" || lastItem.status === "running"));
  const suggestions = [context ? t("suggestions.record") : null, t("suggestions.pipeline"), t("suggestions.tasks"), t("suggestions.stale")].filter((s): s is string => !!s);

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-[420px] max-w-full flex-col border-l border-surface-200 bg-white shadow-2xl dark:border-surface-800 dark:bg-surface-950"
      aria-label={t("title")}
      data-testid="assistant-panel"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-surface-200 px-3 dark:border-surface-800">
        <Sparkles className="h-4 w-4 text-accent-600 dark:text-accent-400" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-surface-900 dark:text-white">{t("title")}</h2>
        <span className="hidden sm:inline-flex">
          <Kbd>⌘J</Kbd>
        </span>
        <IconButton size="sm" label={t("newChat")} icon={<MessageSquarePlus />} onClick={chat.newChat} disabled={chat.items.length === 0 && !chat.running} />
        <IconButton
          size="sm"
          label={t("settingsLink")}
          icon={<Settings2 />}
          onClick={() => {
            navigate(paths.settings("assistant"));
          }}
        />
        <IconButton size="sm" label={t("close")} icon={<X />} onClick={() => setOpen(false)} />
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!hasKey ? (
          <EmptyState
            icon={<KeyRound />}
            title={t("noKey.title")}
            description={t("noKey.description")}
            action={
              <Button variant="primary" icon={<Settings2 />} onClick={() => navigate(paths.settings("assistant"))}>
                {t("noKey.action")}
              </Button>
            }
          />
        ) : chat.items.length === 0 ? (
          <div>
            <EmptyState icon={<Sparkles />} title={t("empty.title")} description={t("empty.description")} className="py-8" />
            <div className="space-y-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  className="block w-full rounded-md border border-surface-200 px-3 py-2 text-left text-sm text-surface-700 hover:border-surface-300 hover:bg-surface-50 dark:border-surface-800 dark:text-surface-200 dark:hover:bg-surface-900"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {chat.items.map((item) => (
              <ChatItemView key={item.id} item={item} onDecide={chat.decide} />
            ))}
            {waiting && (
              <div className="flex items-center gap-2 text-xs text-surface-500">
                <Spinner size="sm" />
                {t("thinking")}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-surface-200 p-3 dark:border-surface-800">
        {context && <ContextChip context={context} onRemove={() => setDismissed(true)} />}
        <form data-form-type="other" onSubmit={onSubmit} className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder={t("composer.placeholder")}
            aria-label={t("composer.placeholder")}
            disabled={!hasKey}
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none"
          />
          <Button type="submit" variant="primary" icon={<Send />} disabled={!hasKey || !draft.trim()} className={cn(chat.running && "hidden")} aria-label={t("composer.send")}>
            {t("composer.send")}
          </Button>
          <Button type="button" variant="danger" icon={<Square />} onClick={chat.stop} className={cn(!chat.running && "hidden")} aria-label={t("composer.stop")}>
            {t("composer.stop")}
          </Button>
        </form>
        <p className="mt-1.5 text-2xs text-surface-400">{t("composer.hint")}</p>
      </div>
    </aside>
  );
}
