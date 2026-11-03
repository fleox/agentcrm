// Cmd+K command palette (global overlay, opened by the "search.open" shell
// event): recent records, full-text record / activity search, navigation
// commands and actions. A leading ">" restricts results to commands.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Calendar, CheckSquare, Clock, CornerDownLeft, Languages, Mail, Moon, Phone, Plus, Search, StickyNote, Sun } from "lucide-react";
import { Kbd, Modal, ObjectIcon } from "../../components/ui";
import { useActivities, useCan, useCurrentUser, useObjects, useRecordLabel, useSearchIndex } from "../../app/CrmDataContext";
import { emitShellEvent, useShellEvent } from "../../app/shellEvents";
import { useFeatures } from "../../app/featureRegistry";
import { paths } from "../../app/paths";
import { useTheme } from "../../app/theme";
import { activeLocale, LOCALE_LABELS, setActiveLocale, SUPPORTED_LOCALES } from "../../i18n";
import type { ActivityType } from "../../core/types";
import { cn } from "../../shared/lib/utils";
import { parseRecordPath, pushRecent, readRecent, type RecentRecord } from "./recentRecords";

export type PaletteGroup = "recent" | "records" | "activities" | "navigation" | "actions";
const GROUP_ORDER: PaletteGroup[] = ["recent", "records", "activities", "navigation", "actions"];

export interface PaletteItem {
  key: string;
  group: PaletteGroup;
  label: string;
  sub?: string;
  icon: ReactNode;
  // Extra words matched by the command filter.
  keywords?: string;
  run(): void;
}

const ACTIVITY_ICONS: Record<ActivityType, typeof StickyNote> = { note: StickyNote, task: CheckSquare, call: Phone, email: Mail, meeting: Calendar };

function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Every whitespace-separated token of `query` appears in label/keywords.
export function matchesCommand(item: Pick<PaletteItem, "label" | "sub" | "keywords">, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const hay = fold(`${item.label} ${item.sub ?? ""} ${item.keywords ?? ""}`);
  return q.split(/\s+/).every((tok) => hay.includes(tok));
}

const iconBox = "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-surface-200 bg-white text-surface-500 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-300 [&>svg]:h-3 [&>svg]:w-3";

export function CommandPalette() {
  const { t } = useTranslation("search");
  const { t: tc } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useCurrentUser();
  const canWriteRecords = useCan("records.write");
  const canWriteActivities = useCan("activities.write");
  const index = useSearchIndex();
  const objects = useObjects();
  const features = useFeatures();
  const activities = useActivities();
  const labelOf = useRecordLabel();
  const theme = useTheme();

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<RecentRecord[]>(readRecent);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Track visited record pages.
  const current = useMemo(() => {
    const hit = parseRecordPath(location.pathname);
    return hit && labelOf(hit.id) !== undefined ? hit : null;
  }, [location.pathname, labelOf]);
  useEffect(() => {
    const hit = parseRecordPath(location.pathname);
    if (hit) setRecent(pushRecent(hit));
  }, [location.pathname]);

  useShellEvent("search.open", () => {
    setQ("");
    setActive(0);
    setRecent(readRecent());
    setOpen(true);
  });

  const objectById = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);
  const activityById = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);

  const close = () => setOpen(false);
  const go = (to: string) => () => navigate(to);

  // Navigation + action commands (static for a given state).
  const commands = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];
    const navItems = features
      .flatMap((f) => f.navItems ?? [])
      .filter((n) => !n.roles || n.roles.includes(user.role))
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    for (const n of navItems) {
      const Icon = n.icon;
      out.push({ key: `nav:${n.id}`, group: "navigation", label: tc(n.label), icon: <span className={iconBox}><Icon /></span>, keywords: `${t("keywords.goTo")} ${n.id}`, run: go(n.to) });
    }
    for (const o of objects) {
      out.push({
        key: `obj:${o.id}`,
        group: "navigation",
        label: o.labelPlural,
        icon: <ObjectIcon name={o.icon} color={o.color} tile />,
        keywords: `${t("keywords.goTo")} ${o.id} ${o.labelSingular}`,
        run: go(paths.objectList(o.id)),
      });
    }
    const currentLabel = current ? labelOf(current.id) : undefined;
    if (canWriteRecords) {
      for (const o of objects) {
        out.push({
          key: `create:${o.id}`,
          group: "actions",
          label: t("actions.create", { object: o.labelSingular }),
          icon: <span className={iconBox}><Plus /></span>,
          keywords: `${t("keywords.create")} ${o.labelPlural} ${o.id}`,
          run: () => emitShellEvent("record.create", { object: o.id }),
        });
      }
    }
    if (canWriteActivities) {
      out.push({
        key: "act:note",
        group: "actions",
        label: t("actions.logNote"),
        sub: currentLabel ? t("actions.on", { record: currentLabel }) : undefined,
        icon: <span className={iconBox}><StickyNote /></span>,
        keywords: t("keywords.note"),
        run: () => emitShellEvent("activity.log", { type: "note", ...(current ? { target: { object: current.object, id: current.id } } : {}) }),
      });
      out.push({
        key: "act:task",
        group: "actions",
        label: t("actions.newTask"),
        sub: currentLabel ? t("actions.on", { record: currentLabel }) : undefined,
        icon: <span className={iconBox}><CheckSquare /></span>,
        keywords: t("keywords.task"),
        run: () => emitShellEvent("tasks.create", current ? { targets: [{ object: current.object, id: current.id }] } : {}),
      });
    }
    const dark = theme.theme === "dark";
    out.push({
      key: "act:theme",
      group: "actions",
      label: dark ? t("actions.lightMode") : t("actions.darkMode"),
      icon: <span className={iconBox}>{dark ? <Sun /> : <Moon />}</span>,
      keywords: t("keywords.theme"),
      run: () => theme.toggle(),
    });
    const locale = activeLocale();
    for (const l of SUPPORTED_LOCALES) {
      if (l === locale) continue;
      out.push({
        key: `act:lang:${l}`,
        group: "actions",
        label: t("actions.language", { language: LOCALE_LABELS[l] }),
        icon: <span className={iconBox}><Languages /></span>,
        keywords: `${t("keywords.language")} ${l}`,
        run: () => void setActiveLocale(l),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, features, user.role, canWriteRecords, canWriteActivities, current, labelOf, theme.theme, t, tc, open]);

  const commandMode = q.trimStart().startsWith(">");
  const text = commandMode ? q.trimStart().slice(1).trim() : q.trim();

  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];
    if (!commandMode && !text) {
      for (const r of recent) {
        if (current && r.id === current.id) continue;
        const label = labelOf(r.id);
        const o = objectById.get(r.object);
        if (label === undefined || !o) continue;
        out.push({ key: `recent:${r.id}`, group: "recent", label, sub: o.labelSingular, icon: <ObjectIcon name={o.icon} color={o.color} tile />, run: go(paths.record(r.object, r.id)) });
      }
    }
    if (!commandMode && text) {
      const recordObjects = objects.map((o) => o.id);
      for (const h of index.search(text, { limit: 8, objects: recordObjects })) {
        if (h.kind !== "record") continue;
        const o = objectById.get(h.object);
        out.push({
          key: `rec:${h.id}`,
          group: "records",
          label: h.label || t("untitled"),
          sub: h.sub ?? o?.labelSingular,
          icon: <ObjectIcon name={o?.icon} color={o?.color} tile />,
          run: go(paths.record(h.object, h.id)),
        });
      }
      for (const h of index.search(text, { limit: 5, objects: ["activities"] })) {
        if (h.kind !== "activity") continue;
        const a = activityById.get(h.id);
        if (!a) continue;
        const target = a.targets.find((tg) => labelOf(tg.id) !== undefined);
        if (!target && a.type !== "task") continue;
        const Icon = ACTIVITY_ICONS[a.type] ?? StickyNote;
        out.push({
          key: `act:${h.id}`,
          group: "activities",
          label: h.label,
          sub: [t(`activityTypes.${a.type}`), target ? labelOf(target.id) : undefined].filter(Boolean).join(" · "),
          icon: <span className={iconBox}><Icon /></span>,
          run: go(target ? paths.record(target.object, target.id) : paths.tasks()),
        });
      }
    }
    out.push(...commands.filter((c) => matchesCommand(c, text)));
    // Stable group order.
    return GROUP_ORDER.flatMap((g) => out.filter((i) => i.group === g));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandMode, text, recent, current, labelOf, objectById, objects, index, activityById, commands, t]);

  useEffect(() => {
    setActive(0);
  }, [q]);
  const activeIndex = Math.min(active, Math.max(items.length - 1, 0));

  // Keep the highlighted item visible.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open]);

  const runItem = (item: PaletteItem | undefined) => {
    if (!item) return;
    close();
    item.run();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = items.length;
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      if (n) setActive((activeIndex + 1) % n);
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      if (n) setActive((activeIndex - 1 + n) % n);
    } else if (e.key === "Home" || (e.key === "ArrowUp" && e.metaKey)) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" || (e.key === "ArrowDown" && e.metaKey)) {
      e.preventDefault();
      setActive(Math.max(n - 1, 0));
    } else if (e.key === "PageDown") {
      e.preventDefault();
      if (n) setActive(Math.min(activeIndex + 5, n - 1));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      setActive(Math.max(activeIndex - 5, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runItem(items[activeIndex]);
    }
  };

  let lastGroup: PaletteGroup | null = null;
  const activeItem = items[activeIndex];

  return (
    <Modal open={open} onClose={close} size="lg" className="overflow-hidden">
      <div className="-mx-5 -my-4 text-[13px]" data-testid="command-palette">
        <div className="flex items-center gap-2 border-b border-surface-100 px-4 dark:border-surface-800">
          <Search className="h-4 w-4 shrink-0 text-surface-400" />
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("placeholder")}
            aria-label={t("placeholder")}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={activeItem ? `palette-item-${activeIndex}` : undefined}
            className="h-12 w-full bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-400 dark:text-surface-100"
          />
          {commandMode && <span className="shrink-0 rounded bg-accent-50 px-1.5 py-0.5 text-2xs font-medium text-accent-700 dark:bg-accent-500/10 dark:text-accent-300">{t("commandsOnly")}</span>}
          <Kbd>esc</Kbd>
        </div>
        <div ref={listRef} id="command-palette-list" role="listbox" className="max-h-[min(60vh,420px)] overflow-y-auto py-1">
          {items.length === 0 && (
            <div className="flex flex-col items-center gap-1 px-4 py-10 text-center">
              <Search className="h-5 w-5 text-surface-300 dark:text-surface-600" />
              <div className="text-sm font-medium text-surface-700 dark:text-surface-200">{t("empty")}</div>
              <div className="text-xs text-surface-400">{text ? t("emptyHint", { query: text }) : t("emptyHintNoQuery")}</div>
            </div>
          )}
          {items.map((it, i) => {
            const header = it.group !== lastGroup;
            lastGroup = it.group;
            const isActive = i === activeIndex;
            return (
              <div key={it.key}>
                {header && (
                  <div role="presentation" className="flex items-center gap-1.5 px-4 pb-1 pt-2.5 text-2xs font-semibold uppercase tracking-wide text-surface-400">
                    {it.group === "recent" && <Clock className="h-3 w-3" />}
                    {t(`groups.${it.group}`)}
                  </div>
                )}
                <button
                  type="button"
                  id={`palette-item-${i}`}
                  role="option"
                  aria-selected={isActive}
                  data-index={i}
                  tabIndex={-1}
                  onMouseMove={() => i !== activeIndex && setActive(i)}
                  onClick={() => runItem(it)}
                  className={cn(
                    "mx-1.5 flex w-[calc(100%-12px)] items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left",
                    isActive ? "bg-surface-100 text-surface-900 dark:bg-surface-800 dark:text-white" : "text-surface-700 dark:text-surface-200",
                  )}
                >
                  {it.icon}
                  <span className="min-w-0 flex-1 truncate">
                    {it.label}
                    {it.sub && <span className="ml-2 text-xs text-surface-400">{it.sub}</span>}
                  </span>
                  <span className={cn("shrink-0 items-center gap-1 text-xs text-surface-400", isActive ? "inline-flex" : "hidden")}>
                    {it.group === "actions" ? t("hints.run") : t("hints.open")}
                    {it.group === "actions" ? <CornerDownLeft className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="hidden items-center gap-4 border-t border-surface-100 px-4 py-2 text-2xs text-surface-400 dark:border-surface-800 sm:flex">
          <span className="inline-flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> {t("hints.navigate")}
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>↵</Kbd> {t("hints.select")}
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>esc</Kbd> {t("hints.close")}
          </span>
          <span className="ml-auto inline-flex items-center gap-1">
            <Kbd>&gt;</Kbd> {t("hints.commands")}
          </span>
        </div>
      </div>
    </Modal>
  );
}
