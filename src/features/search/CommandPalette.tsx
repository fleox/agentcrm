import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Avatar, Modal } from "../../components/ui";
import { useObjects, useSearchIndex } from "../../app/CrmDataContext";
import { useShellEvent } from "../../app/shellEvents";
import { paths } from "../../app/paths";
import { cn } from "../../shared/lib/utils";

export function CommandPalette() {
  const { t } = useTranslation("search");
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const index = useSearchIndex();
  const objects = useObjects();
  useShellEvent("search.open", () => {
    setQ("");
    setActive(0);
    setOpen(true);
  });
  const items = useMemo(() => {
    const nav = objects
      .filter((o) => !q || o.labelPlural.toLowerCase().includes(q.toLowerCase()))
      .map((o) => ({ key: `o:${o.id}`, label: o.labelPlural, sub: t("navigation"), to: paths.objectList(o.id) }));
    const hits = index
      .search(q, { limit: 12 })
      .filter((h) => h.kind === "record")
      .map((h) => ({ key: `r:${h.id}`, label: h.label, sub: h.sub ?? objects.find((o) => o.id === h.object)?.labelSingular, to: paths.record(h.object, h.id) }));
    return [...hits, ...nav].slice(0, 15);
  }, [q, index, objects, t]);
  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };
  return (
    <Modal open={open} onClose={() => setOpen(false)} size="md" className="overflow-hidden">
      <div className="-mx-5 -my-4">
        <div className="flex items-center gap-2 border-b border-surface-100 px-4 dark:border-surface-800">
          <Search className="h-4 w-4 text-surface-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && items[active]) {
                go(items[active].to);
              }
            }}
            placeholder={t("placeholder")}
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-surface-400"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-surface-400">{t("empty")}</li>}
          {items.map((it, i) => (
            <li key={it.key}>
              <button type="button" onMouseEnter={() => setActive(i)} onClick={() => go(it.to)} className={cn("flex w-full items-center gap-3 px-4 py-2 text-left text-sm", i === active && "bg-surface-100 dark:bg-surface-800")}>
                <Avatar name={it.label} size="sm" />
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.sub && <span className="shrink-0 text-xs text-surface-400">{it.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
