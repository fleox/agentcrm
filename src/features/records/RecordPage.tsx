import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { recordLabel } from "../../core/fields";
import { Avatar, Button, Card, confirmDialog, EmptyState, FieldInput, FieldValue, ObjectIcon, PageHeader, Tabs } from "../../components/ui";
import { useActivities, useCan, useObject, useOps, useRecord } from "../../app/CrmDataContext";
import { getSlot } from "../../app/featureRegistry";
import { paths } from "../../app/paths";
import { deleteRecord, updateRecord } from "../../ops/records";
import { toast } from "../../shared/lib/toast";
import { formatRelative } from "../../shared/lib/utils";
import { intlLocale } from "../../i18n";

// Placeholder detail page (fields + timeline + slot tabs / panels).
export function RecordPage() {
  const { objectId = "", recordId = "" } = useParams();
  const { t } = useTranslation("records");
  const { t: tc } = useTranslation();
  const navigate = useNavigate();
  const ops = useOps();
  const object = useObject(objectId);
  const record = useRecord(recordId);
  const activities = useActivities(recordId);
  const canWrite = useCan("records.write");
  const [tab, setTab] = useState("timeline");
  if (!object || !record) return <EmptyState className="py-24" title={t("detail.notFound")} />;

  const tabs = getSlot("recordDetailTabs").filter((x) => !x.when || x.when(object));
  const panels = getSlot("recordDetailPanels").filter((x) => !x.when || x.when(object));
  const ActiveTab = tabs.find((x) => x.id === tab)?.component;
  const label = recordLabel(object, record);

  const save = async (fieldId: string, value: unknown) => {
    if (JSON.stringify(value ?? null) === JSON.stringify(record.fields[fieldId] ?? null)) return;
    try {
      await updateRecord(ops, record.id, { [fieldId]: value ?? null });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={label}
        icon={<ObjectIcon name={object.icon} />}
        description={object.labelSingular}
        actions={
          canWrite && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 />}
              onClick={async () => {
                if (!(await confirmDialog({ title: tc("confirm.deleteTitle", { name: label }), danger: true, confirmLabel: tc("common.delete") }))) return;
                await deleteRecord(ops, record.id);
                navigate(paths.objectList(object.id));
              }}
            >
              {t("detail.delete")}
            </Button>
          )
        }
      />
      {record.deletedAt && <div className="bg-amber-50 px-6 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{t("detail.deleted")}</div>}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-6 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card title={t("detail.fields")}>
            <dl className="space-y-3">
              {object.fields
                .filter((f) => !f.hidden)
                .map((f) => (
                  <div key={f.id}>
                    <dt className="mb-1 text-xs text-surface-500">{f.label}</dt>
                    <dd className="text-sm">
                      {canWrite ? <FieldInput field={f} value={record.fields[f.id]} onChange={() => undefined} onCommit={(v) => void save(f.id, v)} /> : <FieldValue field={f} value={record.fields[f.id]} emptyText="—" />}
                    </dd>
                  </div>
                ))}
            </dl>
          </Card>
          {panels.map((p) => (
            <p.component key={p.id} record={record} object={object} />
          ))}
        </div>
        <div className="min-w-0">
          <Tabs tabs={[{ id: "timeline", label: t("detail.timeline"), count: activities.length }, ...tabs.map((x) => ({ id: x.id, label: tc(x.label) }))]} value={tab} onChange={setTab} />
          <div className="pt-4">
            {ActiveTab ? (
              <ActiveTab record={record} object={object} />
            ) : activities.length === 0 ? (
              <EmptyState title={t("detail.noActivity")} />
            ) : (
              <ul className="space-y-2">
                {activities.map((a) => (
                  <li key={a.id} className="flex gap-3 rounded-lg border border-surface-200 p-3 dark:border-surface-800">
                    <Avatar name={a.type} size="sm" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{a.title}</div>
                      {a.body && <p className="mt-0.5 whitespace-pre-wrap text-sm text-surface-600 dark:text-surface-300">{a.body}</p>}
                      <div className="mt-1 text-xs text-surface-400">
                        {tc(`activityTypes.${a.type}`)} · {formatRelative(a.createdAt, intlLocale())}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
