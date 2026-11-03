// Object list page for ANY object (standard or custom): saved views as
// tabs, per-view filters / sorts / columns / layout with save & reset,
// quick search, table (DataGrid) or kanban, bulk actions.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Download, MoreHorizontal, Plus, RotateCcw, Save, Search, Trash2, Upload } from "lucide-react";
import type { CrmRecord, ViewDef } from "../../core/types";
import { Button, downloadCsv, Dropdown, EmptyState, fileStamp, IconButton, Input, Kbd, ObjectIcon } from "../../components/ui";
import { useCan, useCurrentUser, useObject, useOps, usePipelines, useRecords, useViews } from "../../app/CrmDataContext";
import { paths } from "../../app/paths";
import { emitShellEvent } from "../../app/shellEvents";
import { createRecord, updateRecord } from "../../ops/records";
import { createView, updateView } from "../../ops/views";
import { exportCsv } from "../../ops/exportCsv";
import { toast } from "../../shared/lib/toast";
import { useLocalState, useQueryCtx, useRun, useViewDraft } from "./lib/hooks";
import { computeRows, defaultsFromFilters, isFilterComplete, visibleColumns } from "./lib/viewModel";
import { FilterBar } from "./views/FilterBar";
import { FieldsMenu, SortMenu, ViewOptionsMenu } from "./views/ViewMenus";
import { ViewTabs } from "./views/ViewTabs";
import { DataGrid } from "./table/DataGrid";
import { BulkActions } from "./table/BulkActions";
import { KanbanBoard } from "./kanban/KanbanBoard";

export function ObjectListPage() {
  const { objectId = "" } = useParams();
  const { t } = useTranslation("records");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const ops = useOps();
  const run = useRun();
  const user = useCurrentUser();
  const object = useObject(objectId);
  const records = useRecords(objectId);
  const views = useViews(objectId);
  const pipelines = usePipelines(objectId);
  const qctx = useQueryCtx();
  const canWrite = useCan("records.write");
  const canOwnViews = useCan("views.writeOwn");
  const canSharedViews = useCan("views.writeShared");
  const canExport = useCan("export");
  const canImport = useCan("import");

  const viewId = params.get("view");
  const saved = views.find((v) => v.id === viewId) ?? views[0];
  const view = useViewDraft(object, saved);
  const draft = view.draft;
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [widths, setWidths] = useLocalState<Record<string, number>>(`agentcrm.colWidths.${draft?.id ?? objectId}`, {});

  // Selection is per view; drop ids that disappeared.
  useEffect(() => setSelection(new Set()), [draft?.id, objectId]);

  const rows = useMemo(() => (object && draft ? computeRows(records, object, { filters: draft.filters, sorts: draft.sorts, search }, qctx) : []), [records, object, draft, search, qctx]);
  const selectedIds = useMemo(() => rows.filter((r) => selection.has(r.id)).map((r) => r.id), [rows, selection]);

  const selectView = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      next.set("view", id);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const onSave = useCallback(
    async (record: CrmRecord, col: string, value: unknown) => {
      if (col === "ownerId") {
        if ((value ?? null) === (record.ownerId ?? null)) return;
        await run(() => updateRecord(ops, record.id, {}, { ownerId: (value as string | undefined) ?? null }));
        return;
      }
      if (JSON.stringify(value ?? null) === JSON.stringify(record.fields[col] ?? null)) return;
      await run(() => updateRecord(ops, record.id, { [col]: value ?? null }));
    },
    [ops, run],
  );

  if (!object) return <EmptyState className="py-24" title={t("list.unknownObject")} description={t("list.unknownObjectHint")} />;
  if (!draft) return null;

  const columns = visibleColumns(object, draft.columns);
  const canSaveCurrent = !!view.saved && (view.saved.shared ? canSharedViews : canOwnViews && (!view.saved.ownerId || view.saved.ownerId === user.id));
  const readOnlyView = !canOwnViews;

  const saveView = async () => {
    const patch: Partial<ViewDef> = { type: draft.type, columns: draft.columns, filters: draft.filters.filter(isFilterComplete), sorts: draft.sorts, groupBy: draft.groupBy, pipelineId: draft.pipelineId };
    if (view.saved && canSaveCurrent) {
      await run(() => updateView(ops, view.saved!.id, patch), t("views.saved"));
    } else {
      const created = await run(() => createView(ops, { object: object.id, name: view.saved ? t("views.copyName", { name: view.saved.name }) : draft.name, ...patch, shared: false }), t("views.created"));
      if (created) selectView(created.id);
    }
  };

  const saveAsNew = async () => {
    const created = await run(
      () => createView(ops, { object: object.id, name: t("views.copyName", { name: draft.name }), type: draft.type, columns: draft.columns, filters: draft.filters.filter(isFilterComplete), sorts: draft.sorts, groupBy: draft.groupBy, pipelineId: draft.pipelineId, shared: false }),
      t("views.created"),
    );
    if (created) selectView(created.id);
  };

  const exportView = () => {
    try {
      const csv = exportCsv(ops, object.id, { filters: draft.filters.filter(isFilterComplete), sorts: draft.sorts, fields: columns, includeId: true });
      downloadCsv(`${object.id}-${fileStamp()}`, csv);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const newRecord = () => emitShellEvent("record.create", { object: object.id, defaults: defaultsFromFilters(object, draft.filters) });

  const quickAdd = async (label: string) => {
    await run(() => createRecord(ops, object.id, { ...defaultsFromFilters(object, draft.filters), [object.labelField]: label }));
  };

  const onSort = (field: string, dir: "asc" | "desc" | null) => {
    const rest = draft.sorts.filter((s) => s.field !== field);
    view.set({ sorts: dir ? [{ field, dir }, ...rest] : rest });
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="shrink-0 border-b border-surface-200 bg-white px-4 dark:border-surface-800 dark:bg-surface-950 sm:px-5">
        <div className="flex h-12 items-center gap-2">
          <ObjectIcon name={object.icon} color={object.color} tile />
          <h1 className="truncate text-[15px] font-semibold text-surface-900 dark:text-white">{object.labelPlural}</h1>
          <span className="shrink-0 rounded bg-surface-100 px-1.5 text-xs tabular-nums text-surface-500 dark:bg-surface-800" data-testid="record-count">
            {rows.length === records.length ? t("list.count", { count: records.length }) : t("list.countFiltered", { count: rows.length, total: records.length })}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Input
              icon={<Search />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setSearch("")}
              placeholder={t("list.search", { object: object.labelPlural.toLowerCase() })}
              aria-label={t("list.search", { object: object.labelPlural.toLowerCase() })}
              className="hidden w-56 md:block"
            />
            <Dropdown
              align="end"
              trigger={({ ref, onClick }) => <IconButton ref={ref as never} label={t("list.more")} icon={<MoreHorizontal />} onClick={onClick} />}
              items={[
                ...(canExport ? [{ id: "export", label: t("list.exportView"), icon: <Download />, onSelect: exportView }] : []),
                ...(canImport ? [{ id: "import", label: t("list.import"), icon: <Upload />, onSelect: () => navigate(paths.settings("import")) }] : []),
                { id: "trash", label: t("list.trash"), icon: <Trash2 />, separator: true, onSelect: () => navigate(`/objects/${object.id}/trash`) },
              ]}
            />
            {canWrite && (
              <Button variant="primary" size="sm" icon={<Plus />} onClick={newRecord}>
                {t("list.new")}
              </Button>
            )}
          </div>
        </div>
        <div className="flex min-h-10 flex-wrap items-center gap-2 pb-1.5">
          <ViewTabs object={object} views={views} current={view.saved} draft={draft} pipelines={pipelines} onSelect={selectView} />
          <div className="ml-auto flex items-center gap-0.5">
            <SortMenu object={object} sorts={draft.sorts} onChange={(sorts) => view.set({ sorts })} />
            <FieldsMenu object={object} columns={draft.columns} onChange={(cols) => view.set({ columns: cols })} />
            <ViewOptionsMenu object={object} view={draft} pipelines={pipelines} onChange={view.set} />
          </div>
        </div>
        <div className="flex min-h-9 flex-wrap items-center gap-2 border-t border-surface-100 py-1.5 dark:border-surface-800/70">
          <FilterBar object={object} filters={draft.filters} onChange={(filters) => view.set({ filters })} />
          {view.dirty && (
            <div className="ml-auto flex items-center gap-1.5" data-testid="view-dirty">
              <Button size="xs" variant="ghost" icon={<RotateCcw />} onClick={view.reset}>
                {t("views.reset")}
              </Button>
              {canSaveCurrent && (
                <Button size="xs" variant="ghost" onClick={() => void saveAsNew()}>
                  {t("views.saveAsNew")}
                </Button>
              )}
              {!readOnlyView && (
                <Button size="xs" variant="primary" icon={<Save />} onClick={() => void saveView()}>
                  {canSaveCurrent ? t("views.save") : t("views.saveAsNew")}
                </Button>
              )}
            </div>
          )}
        </div>
      </header>

      {draft.type === "kanban" ? (
        <KanbanBoard object={object} view={draft} records={rows} pipelines={pipelines} canWrite={canWrite} filters={draft.filters} onOpen={(r) => navigate(paths.record(object.id, r.id))} />
      ) : records.length === 0 ? (
        <EmptyState
          className="py-24"
          icon={<ObjectIcon name={object.icon} />}
          title={t("list.empty", { object: object.labelPlural.toLowerCase() })}
          description={t("list.emptyHint")}
          action={
            canWrite && (
              <div className="flex gap-2">
                <Button variant="primary" icon={<Plus />} onClick={newRecord}>
                  {t("list.new")}
                </Button>
                {canImport && (
                  <Link to={paths.settings("import")}>
                    <Button icon={<Upload />}>{t("list.import")}</Button>
                  </Link>
                )}
              </div>
            )
          }
        />
      ) : (
        <DataGrid
          object={object}
          rows={rows}
          columns={columns}
          widths={widths}
          onResize={(c, w) => setWidths((p) => ({ ...p, [c]: w }))}
          sorts={draft.sorts}
          onSort={onSort}
          onHideColumn={(c) => view.set({ columns: draft.columns.filter((x) => x !== c) })}
          canWrite={canWrite}
          selection={selection}
          onSelectionChange={setSelection}
          onOpen={(r) => navigate(paths.record(object.id, r.id))}
          onSave={(r, c, v) => void onSave(r, c, v)}
          onQuickAdd={quickAdd}
        />
      )}

      {selectedIds.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center px-4">
          <BulkActions object={object} ids={selectedIds} onClear={() => setSelection(new Set())} />
        </div>
      )}
      {draft.type === "table" && rows.length > 0 && selectedIds.length === 0 && (
        <div className="hidden shrink-0 items-center gap-3 border-t border-surface-100 px-5 py-1 text-2xs text-surface-400 dark:border-surface-800 lg:flex">
          <span>
            <Kbd>↑↓←→</Kbd> {t("table.hintNavigate")}
          </span>
          <span>
            <Kbd>↵</Kbd> {t("table.hintEdit")}
          </span>
          <span>
            <Kbd>⌘↵</Kbd> {t("table.hintOpen")}
          </span>
          <span>
            <Kbd>Space</Kbd> {t("table.hintSelect")}
          </span>
        </div>
      )}
    </div>
  );
}
