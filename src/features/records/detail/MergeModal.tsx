// Merge duplicates into the current record (ops/dedupe): suggested
// duplicates (same email / domain / name) + manual search.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GitMerge, Search } from "lucide-react";
import type { CrmRecord, ObjectDef } from "../../../core/types";
import { Avatar, Badge, Button, Checkbox, Input, Modal, useFieldContext } from "../../../components/ui";
import { useOps, useRecords } from "../../../app/CrmDataContext";
import { findDuplicates, mergeRecords } from "../../../ops/dedupe";
import { toast } from "../../../shared/lib/toast";

export function MergeModal({ open, onClose, record, object }: { open: boolean; onClose(): void; record: CrmRecord; object: ObjectDef }) {
  const { t } = useTranslation("records");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const ctx = useFieldContext();
  const all = useRecords(object.id);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const suggestions = useMemo(() => {
    if (!open) return [];
    const out = new Map<string, string>();
    for (const g of findDuplicates(ops, object.id)) {
      if (!g.records.some((r) => r.id === record.id)) continue;
      for (const r of g.records) if (r.id !== record.id && !out.has(r.id)) out.set(r.id, g.reason);
    }
    return [...out.entries()].map(([id, reason]) => ({ id, reason }));
  }, [open, ops, object.id, record.id, all]);
  const results = q.trim() ? ctx.searchRecords(object.id, q, 20).filter((r) => r.id !== record.id && !suggestions.some((s) => s.id === r.id)) : [];
  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const merge = async () => {
    setBusy(true);
    try {
      const res = await mergeRecords(ops, record.id, [...picked]);
      toast.success(t("merge.done", { count: res.merged.length, activities: res.movedActivities }));
      setPicked(new Set());
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const row = (id: string, label: string, badge?: string) => (
    <label key={id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-50 dark:hover:bg-surface-800">
      <Checkbox checked={picked.has(id)} onChange={() => toggle(id)} />
      <Avatar name={label} size="sm" square={object.id === "companies"} />
      <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
      {badge && <Badge color="yellow">{t(`merge.reasons.${badge}`, { defaultValue: badge })}</Badge>}
    </label>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("merge.title", { name: ctx.recordLabel(record.id) ?? "" })}
      description={t("merge.hint")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc("common.cancel")}
          </Button>
          <Button variant="primary" icon={<GitMerge />} loading={busy} disabled={!picked.size} onClick={() => void merge()}>
            {t("merge.submit", { count: picked.size })}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <div className="mb-1 text-xs font-medium text-surface-500">{t("merge.suggested")}</div>
          {suggestions.length === 0 ? <p className="text-sm text-surface-400">{t("merge.none")}</p> : suggestions.map((s) => row(s.id, ctx.recordLabel(s.id) ?? s.id, s.reason))}
        </div>
        <div>
          <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("merge.search", { object: object.labelPlural.toLowerCase() })} />
          <div className="mt-1 max-h-48 overflow-y-auto">{results.map((r) => row(r.id, r.label))}</div>
        </div>
        {[...picked].filter((id) => !suggestions.some((s) => s.id === id) && !results.some((r) => r.id === id)).map((id) => row(id, ctx.recordLabel(id) ?? id))}
        <p className="text-2xs text-surface-400">{t("merge.warning")}</p>
      </div>
    </Modal>
  );
}
