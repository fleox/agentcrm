import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { applySorts, resolveField, getRecordValue } from "../../core/query";
import { recordLabel } from "../../core/fields";
import { Button, EmptyState, FieldValue, Input, ObjectIcon, PageHeader, Table, TBody, Td, Th, THead, Tr } from "../../components/ui";
import { useCan, useObject, useOps, useRecordLabel, useRecords, useViews } from "../../app/CrmDataContext";
import { paths } from "../../app/paths";
import { createRecord } from "../../ops/records";
import { toast } from "../../shared/lib/toast";

// Placeholder table (the records agent replaces it with the full grid).
export function ObjectListPage() {
  const { objectId = "" } = useParams();
  const { t } = useTranslation("records");
  const navigate = useNavigate();
  const ops = useOps();
  const object = useObject(objectId);
  const records = useRecords(objectId);
  const views = useViews(objectId);
  const labelOf = useRecordLabel();
  const canWrite = useCan("records.write");
  const [q, setQ] = useState("");
  const view = views[0];
  const columns = (view?.columns ?? object?.fields.slice(0, 6).map((f) => f.id) ?? []).filter((c) => c !== object?.labelField);
  const rows = useMemo(() => {
    if (!object) return [];
    const filtered = q ? records.filter((r) => recordLabel(object, r).toLowerCase().includes(q.toLowerCase())) : records;
    return applySorts(filtered, view?.sorts?.length ? view.sorts : [{ field: "createdAt", dir: "desc" }], { object, recordLabel: (_o, id) => labelOf(id) });
  }, [object, records, q, view, labelOf]);

  if (!object) return <EmptyState className="py-24" title={t("list.unknownObject")} />;

  const create = async () => {
    try {
      const r = await createRecord(ops, object.id, { [object.labelField]: t("list.untitled") });
      navigate(paths.record(object.id, r.id));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={object.labelPlural}
        icon={<ObjectIcon name={object.icon} />}
        description={t("list.count", { count: records.length })}
        actions={
          <>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${object.labelPlural}…`} className="w-48" />
            {canWrite && (
              <Button variant="primary" size="sm" icon={<Plus />} onClick={() => void create()}>
                {t("list.new")}
              </Button>
            )}
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState className="py-24" icon={<ObjectIcon name={object.icon} />} title={t("list.empty", { object: object.labelPlural.toLowerCase() })} description={t("list.emptyHint")} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <THead>
              <tr>
                <Th className="pl-6">{resolveField(object, object.labelField)?.label}</Th>
                {columns.map((c) => (
                  <Th key={c}>{resolveField(object, c)?.label ?? c}</Th>
                ))}
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id} className="cursor-pointer" onClick={() => navigate(paths.record(object.id, r.id))}>
                  <Td className="pl-6 font-medium">{recordLabel(object, r)}</Td>
                  {columns.map((c) => {
                    const field = resolveField(object, c);
                    return <Td key={c}>{field && <FieldValue field={field} value={getRecordValue(r, c)} compact />}</Td>;
                  })}
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  );
}
