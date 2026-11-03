// CSV import wizard: 1 source (file / drop / paste + object) → 2 column
// mapping (auto-suggested) + options → 3 dry run report → 4 real import.

import { useMemo, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Check, FileUp, FlaskConical, Play, RotateCcw, Upload } from "lucide-react";
import { Badge, Button, Card, Checkbox, FormField, Select, Table, TBody, THead, Td, Textarea, Th, Tr } from "../../../components/ui";
import { useCan, useObjects, useOps } from "../../../app/CrmDataContext";
import { paths } from "../../../app/paths";
import { importCsv, MAPPING_ID, MAPPING_OWNER, MAPPING_SKIP, parseCsv, suggestMapping, type ImportOptions, type ImportReport, type ParsedCsv } from "../../../ops/importCsv";
import { cn } from "../../../shared/lib/utils";
import { toast } from "../../../shared/lib/toast";
import { ReadOnlyNote, SectionHeader, StatTile, errorMessage } from "../components/common";

type Step = 1 | 2 | 3 | 4;
type OnDuplicate = NonNullable<ImportOptions["onDuplicate"]>;

const ACTION_COLORS: Record<string, string> = { create: "green", update: "blue", skip: "gray", error: "red" };

export function ImportSection() {
  const { t } = useTranslation("settings");
  const ops = useOps();
  const objects = useObjects();
  const canImport = useCan("import");
  const [step, setStep] = useState<Step>(1);
  const [objectId, setObjectId] = useState(objects.find((o) => o.id === "people")?.id ?? objects[0]?.id ?? "");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [onDuplicate, setOnDuplicate] = useState<OnDuplicate>("update");
  const [dayFirst, setDayFirst] = useState(false);
  const [createOptions, setCreateOptions] = useState(true);
  const [createRelated, setCreateRelated] = useState(true);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const object = objects.find((o) => o.id === objectId);

  if (!canImport) {
    return (
      <div className="max-w-3xl">
        <SectionHeader title={t("import.title")} description={t("import.description")} />
        <ReadOnlyNote>{t("import.noPermission")}</ReadOnlyNote>
      </div>
    );
  }

  const readFile = async (file: File) => {
    try {
      const text = await file.text();
      setCsv(text);
      setFileName(file.name);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void readFile(file);
  };

  const toMapping = () => {
    if (!object) return;
    const p = parseCsv(csv);
    if (!p.headers.length || !p.rows.length) {
      toast.error(t("import.emptyCsv"));
      return;
    }
    setParsed(p);
    setMapping(suggestMapping(object, p.headers));
    setReport(null);
    setStep(2);
  };

  const options = (dryRun: boolean): ImportOptions => ({ object: objectId, csv, mapping, dryRun, onDuplicate, dayFirst, createOptions, createRelated });

  const run = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await importCsv(ops, options(dryRun));
      if (dryRun) {
        setReport(r);
        setStep(3);
      } else {
        setResult(r);
        setStep(4);
        toast.success(t("import.done", { created: r.created, updated: r.updated }));
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep(1);
    setCsv("");
    setFileName("");
    setParsed(null);
    setReport(null);
    setResult(null);
  };

  const steps = [t("import.step1"), t("import.step2"), t("import.step3"), t("import.step4")];

  return (
    <div className="max-w-5xl">
      <SectionHeader title={t("import.title")} description={t("import.description")} />
      <ol className="mb-5 flex flex-wrap items-center gap-2 text-[13px]" aria-label={t("import.steps")}>
        {steps.map((label, i) => {
          const n = (i + 1) as Step;
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold",
                  n < step ? "bg-emerald-500 text-white" : n === step ? "bg-surface-900 text-white dark:bg-white dark:text-surface-900" : "bg-surface-200 text-surface-500 dark:bg-surface-800",
                )}
              >
                {n < step ? <Check className="h-3 w-3" /> : n}
              </span>
              <span className={cn(n === step ? "font-medium text-surface-900 dark:text-white" : "text-surface-500")} aria-current={n === step ? "step" : undefined}>
                {label}
              </span>
              {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-surface-200 dark:bg-surface-700" />}
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <Card>
          <div className="space-y-4">
            <FormField label={t("import.object")} htmlFor="import-object">
              <Select id="import-object" className="max-w-xs" value={objectId} options={objects.map((o) => ({ value: o.id, label: o.labelPlural }))} onChange={(e) => setObjectId(e.target.value)} />
            </FormField>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
                dragOver ? "border-accent-500 bg-accent-50/50 dark:bg-accent-500/10" : "border-surface-200 dark:border-surface-700",
              )}
            >
              <FileUp className="h-6 w-6 text-surface-400" />
              <p className="text-[13px] text-surface-600 dark:text-surface-300">{fileName ? t("import.fileLoaded", { name: fileName }) : t("import.dropHere")}</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void readFile(f);
                  e.target.value = "";
                }}
              />
              <Button size="sm" icon={<Upload />} onClick={() => fileRef.current?.click()}>
                {t("import.chooseFile")}
              </Button>
            </div>
            <FormField label={t("import.paste")} htmlFor="import-csv" help={t("import.pasteHelp")}>
              <Textarea
                id="import-csv"
                rows={7}
                value={csv}
                className="font-mono text-xs"
                placeholder={"First name,Last name,Email,Company\nAda,Lovelace,ada@example.com,Analytical Engines"}
                onChange={(e) => {
                  setCsv(e.target.value);
                  setFileName("");
                }}
              />
            </FormField>
            <div className="flex justify-end">
              <Button variant="primary" trailing={<ArrowRight />} disabled={!csv.trim() || !object} onClick={toMapping}>
                {t("import.next")}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {step === 2 && parsed && object && (
        <MappingStep
          parsed={parsed}
          mapping={mapping}
          setMapping={setMapping}
          objectLabel={object.labelPlural}
          fieldOptions={object.fields.map((f) => ({ value: f.id, label: f.label }))}
          onDuplicate={onDuplicate}
          setOnDuplicate={setOnDuplicate}
          dayFirst={dayFirst}
          setDayFirst={setDayFirst}
          createOptions={createOptions}
          setCreateOptions={setCreateOptions}
          createRelated={createRelated}
          setCreateRelated={setCreateRelated}
          busy={busy}
          onBack={() => setStep(1)}
          onDryRun={() => void run(true)}
        />
      )}

      {step === 3 && report && (
        <div className="space-y-4">
          <ReportView report={report} />
          <div className="flex flex-wrap justify-between gap-2">
            <Button icon={<ArrowLeft />} onClick={() => setStep(2)}>
              {t("import.backToMapping")}
            </Button>
            <Button variant="primary" icon={<Play />} loading={busy} disabled={report.created + report.updated === 0} onClick={() => void run(false)}>
              {t("import.runImport", { count: report.created + report.updated })}
            </Button>
          </div>
        </div>
      )}

      {step === 4 && result && object && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200" data-testid="import-done">
            <Check className="h-4 w-4" />
            {t("import.done", { created: result.created, updated: result.updated })}
          </div>
          <ReportView report={result} />
          <div className="flex flex-wrap justify-between gap-2">
            <Button icon={<RotateCcw />} onClick={reset}>
              {t("import.another")}
            </Button>
            <Link to={paths.objectList(object.id)} className="inline-flex h-8 items-center gap-2 rounded-md bg-surface-900 px-3 text-sm font-medium text-white hover:bg-surface-800 dark:bg-white dark:text-surface-900">
              {t("import.openList", { object: object.labelPlural })}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

interface MappingStepProps {
  parsed: ParsedCsv;
  mapping: Record<string, string>;
  setMapping(m: Record<string, string>): void;
  objectLabel: string;
  fieldOptions: { value: string; label: string }[];
  onDuplicate: OnDuplicate;
  setOnDuplicate(v: OnDuplicate): void;
  dayFirst: boolean;
  setDayFirst(v: boolean): void;
  createOptions: boolean;
  setCreateOptions(v: boolean): void;
  createRelated: boolean;
  setCreateRelated(v: boolean): void;
  busy: boolean;
  onBack(): void;
  onDryRun(): void;
}

function MappingStep(p: MappingStepProps) {
  const { t } = useTranslation("settings");
  const targets = [
    { value: MAPPING_SKIP, label: t("import.skip") },
    { value: MAPPING_OWNER, label: t("import.owner") },
    { value: MAPPING_ID, label: t("import.recordId") },
    ...p.fieldOptions,
  ];
  const samples = (h: string) =>
    p.parsed.rows
      .map((r) => (r[h] ?? "").trim())
      .filter(Boolean)
      .slice(0, 3);
  const used = Object.values(p.mapping).filter((v) => v !== MAPPING_SKIP);
  const dupTargets = new Set(used.filter((v, i) => used.indexOf(v) !== i));
  const mappedCount = used.length;

  return (
    <div className="space-y-4">
      <Card title={t("import.mappingTitle", { rows: p.parsed.rows.length, object: p.objectLabel })} padded={false}>
        <div className="overflow-x-auto">
          <Table data-testid="mapping-table">
            <THead>
              <tr>
                <Th>{t("import.column")}</Th>
                <Th>{t("import.samples")}</Th>
                <Th className="w-56">{t("import.field")}</Th>
              </tr>
            </THead>
            <TBody>
              {p.parsed.headers.map((h) => (
                <Tr key={h}>
                  <Td className="font-medium">{h}</Td>
                  <Td className="text-xs text-surface-500">{samples(h).join(" · ") || "—"}</Td>
                  <Td className="overflow-visible">
                    <Select
                      aria-label={t("import.mapColumn", { column: h })}
                      data-header={h}
                      value={p.mapping[h] ?? MAPPING_SKIP}
                      options={targets}
                      className={cn(dupTargets.has(p.mapping[h]) && "[&_select]:border-amber-400")}
                      onChange={(e) => p.setMapping({ ...p.mapping, [h]: e.target.value })}
                    />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
        <div className="border-t border-surface-100 px-4 py-2 text-xs text-surface-500 dark:border-surface-800">
          {t("import.mappedCount", { count: mappedCount, total: p.parsed.headers.length })}
          {dupTargets.size > 0 && <span className="ml-2 text-amber-600">{t("import.duplicateTargets")}</span>}
          {p.parsed.errors.length > 0 && <span className="ml-2 text-red-600">{t("import.parseErrors", { count: p.parsed.errors.length })}</span>}
        </div>
      </Card>
      <Card title={t("import.options")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("import.onDuplicate")} htmlFor="import-dup" help={t("import.onDuplicateHelp")}>
            <Select
              id="import-dup"
              value={p.onDuplicate}
              options={[
                { value: "update", label: t("import.dupUpdate") },
                { value: "skip", label: t("import.dupSkip") },
                { value: "create", label: t("import.dupCreate") },
              ]}
              onChange={(e) => p.setOnDuplicate(e.target.value as OnDuplicate)}
            />
          </FormField>
          <div className="space-y-2 pt-5">
            <Checkbox label={t("import.dayFirst")} checked={p.dayFirst} onChange={(e) => p.setDayFirst(e.target.checked)} />
            <Checkbox label={t("import.createOptions")} checked={p.createOptions} onChange={(e) => p.setCreateOptions(e.target.checked)} />
            <Checkbox label={t("import.createRelated")} checked={p.createRelated} onChange={(e) => p.setCreateRelated(e.target.checked)} />
          </div>
        </div>
      </Card>
      <div className="flex flex-wrap justify-between gap-2">
        <Button icon={<ArrowLeft />} onClick={p.onBack}>
          {t("import.back")}
        </Button>
        <Button variant="primary" icon={<FlaskConical />} loading={p.busy} disabled={mappedCount === 0} onClick={p.onDryRun}>
          {t("import.dryRun")}
        </Button>
      </div>
    </div>
  );
}

function ReportView({ report }: { report: ImportReport }) {
  const { t } = useTranslation("settings");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const rows = useMemo(() => (errorsOnly ? report.rows.filter((r) => r.action === "error" || (r.messages?.length ?? 0) > 0) : report.rows), [report, errorsOnly]);
  return (
    <div className="space-y-4" data-testid="import-report">
      {report.dryRun && <p className="text-[13px] text-surface-500">{t("import.dryRunNote")}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <StatTile label={t("import.total")} value={report.total} />
        <StatTile label={t("import.created")} value={report.created} tone="good" />
        <StatTile label={t("import.updated")} value={report.updated} />
        <StatTile label={t("import.skipped")} value={report.skipped} tone={report.skipped ? "warn" : "default"} />
        <StatTile label={t("import.failed")} value={report.failed} tone={report.failed ? "bad" : "default"} />
      </div>
      {(report.newOptions.length > 0 || report.createdRelated.length > 0 || report.unmappedColumns.length > 0) && (
        <div className="grid gap-2 text-[13px] sm:grid-cols-3">
          {report.newOptions.length > 0 && (
            <Card title={t("import.newOptions")}>
              <ul className="space-y-1">
                {report.newOptions.map((o) => (
                  <li key={o.field}>
                    <span className="font-medium">{o.field}</span>: {o.labels.join(", ")}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {report.createdRelated.length > 0 && (
            <Card title={t("import.createdRelated", { count: report.createdRelated.length })}>
              <ul className="max-h-32 space-y-1 overflow-y-auto">
                {report.createdRelated.map((r, i) => (
                  <li key={`${r.object}-${r.label}-${i}`}>
                    {r.label} <span className="text-xs text-surface-500">({r.object})</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {report.unmappedColumns.length > 0 && (
            <Card title={t("import.unmapped")}>
              <p className="text-surface-600 dark:text-surface-300">{report.unmappedColumns.join(", ")}</p>
            </Card>
          )}
        </div>
      )}
      <Card
        padded={false}
        title={t("import.rows")}
        actions={<Checkbox label={t("import.errorsOnly")} checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />}
      >
        <div className="max-h-96 overflow-auto">
          <Table>
            <THead>
              <tr>
                <Th className="w-16">{t("import.row")}</Th>
                <Th className="w-24">{t("import.action")}</Th>
                <Th>{t("import.record")}</Th>
                <Th>{t("import.messages")}</Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.row}>
                  <Td className="tabular-nums text-surface-500">{r.row}</Td>
                  <Td>
                    <Badge color={ACTION_COLORS[r.action]}>{t(`import.actions.${r.action}`)}</Badge>
                  </Td>
                  <Td>{r.label ?? "—"}</Td>
                  <Td className="whitespace-normal text-xs text-surface-500">{r.messages?.join(" · ")}</Td>
                </Tr>
              ))}
              {!rows.length && (
                <Tr>
                  <Td colSpan={4} className="text-center text-surface-500">
                    {t("import.noRows")}
                  </Td>
                </Tr>
              )}
            </TBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
