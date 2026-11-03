// Exports: CSV per object, full JSON backup, and the JSON restore
// (merge / replace) for admins behind a strong confirm.

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileArchive, FileJson, RotateCcw, Upload } from "lucide-react";
import { Button, Card, Checkbox, FormField, Input, Modal, Select, downloadBlob, downloadCsv, downloadJson, fileStamp } from "../../../components/ui";
import { exportBackupZip, importBackupZip, readBackupZipInfo } from "../../../ops/backup";
import { formatBytes } from "../../../core/files";
import { useCan, useObjects, useOps, useSettings } from "../../../app/CrmDataContext";
import { exportCsv, exportJson, importJson, type JsonExport } from "../../../ops/exportCsv";
import { slugify } from "../../../shared/lib/utils";
import { toast } from "../../../shared/lib/toast";
import { ReadOnlyNote, SectionHeader, errorMessage } from "../components/common";

export function ExportSection() {
  const { t } = useTranslation("settings");
  const ops = useOps();
  const objects = useObjects({ includeHidden: true });
  const settings = useSettings();
  const canExport = useCan("export");
  const canRestore = useCan("settings.write");
  const [objectId, setObjectId] = useState(objects[0]?.id ?? "");
  const [values, setValues] = useState<"labels" | "raw">("labels");
  const [includeId, setIncludeId] = useState(true);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const base = slugify(settings.name) || "agentcrm";

  if (!canExport) {
    return (
      <div className="max-w-3xl">
        <SectionHeader title={t("export.title")} description={t("export.description")} />
        <ReadOnlyNote>{t("export.noPermission")}</ReadOnlyNote>
      </div>
    );
  }

  const csv = () => {
    try {
      const text = exportCsv(ops, objectId, { values, includeId, includeDeleted });
      downloadCsv(`${base}-${objectId}-${fileStamp()}.csv`, text);
      toast.success(t("export.csvDone", { count: Math.max(0, text.split("\n").length - 1) }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const [zipping, setZipping] = useState(false);
  const zip = async () => {
    setZipping(true);
    try {
      const { zip: bytes, report } = await exportBackupZip(ops);
      downloadBlob(`${base}-backup-${fileStamp()}.zip`, new Blob([bytes as BlobPart], { type: "application/zip" }));
      toast.success(t("export.zipDone", { count: report.files, size: formatBytes(bytes.length) }));
      if (report.missing.length) toast.warn(t("export.zipMissing", { count: report.missing.length }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setZipping(false);
    }
  };

  const json = () => {
    try {
      const data = exportJson(ops);
      downloadJson(`${base}-backup-${fileStamp()}.json`, data);
      toast.success(t("export.jsonDone"));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <SectionHeader title={t("export.title")} description={t("export.description")} />
      <Card title={t("export.csvTitle")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("export.object")} htmlFor="export-object">
            <Select id="export-object" value={objectId} options={objects.map((o) => ({ value: o.id, label: o.labelPlural }))} onChange={(e) => setObjectId(e.target.value)} />
          </FormField>
          <FormField label={t("export.values")} htmlFor="export-values">
            <Select
              id="export-values"
              value={values}
              options={[
                { value: "labels", label: t("export.valuesLabels") },
                { value: "raw", label: t("export.valuesRaw") },
              ]}
              onChange={(e) => setValues(e.target.value === "raw" ? "raw" : "labels")}
            />
          </FormField>
          <div className="flex flex-wrap gap-x-5 gap-y-2 sm:col-span-2">
            <Checkbox label={t("export.includeId")} checked={includeId} onChange={(e) => setIncludeId(e.target.checked)} />
            <Checkbox label={t("export.includeDeleted")} checked={includeDeleted} onChange={(e) => setIncludeDeleted(e.target.checked)} />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" icon={<Download />} onClick={csv} disabled={!objectId}>
            {t("export.downloadCsv")}
          </Button>
        </div>
      </Card>
      <Card title={t("export.jsonTitle")}>
        <p className="mb-3 text-[13px] text-surface-600 dark:text-surface-300">{t("export.jsonHelp")}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button icon={<FileJson />} onClick={json}>
            {t("export.downloadJson")}
          </Button>
          <Button variant="primary" icon={<FileArchive />} loading={zipping} onClick={() => void zip()} data-testid="export-zip">
            {t("export.downloadZip")}
          </Button>
        </div>
        <p className="mt-2 text-xs text-surface-500">{t("export.zipHelp")}</p>
      </Card>
      {canRestore && <RestoreCard />}
    </div>
  );
}

function RestoreCard() {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [data, setData] = useState<JsonExport | null>(null);
  const [zipBytes, setZipBytes] = useState<Uint8Array | null>(null);
  const [zipFiles, setZipFiles] = useState(0);
  const [fileName, setFileName] = useState("");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const keyword = t("export.restoreKeyword");

  const load = async (file: File) => {
    try {
      if (/\.zip$/i.test(file.name) || file.type === "application/zip") {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const info = await readBackupZipInfo(bytes);
        setData(info.data);
        setZipBytes(bytes);
        setZipFiles(info.files);
        setFileName(file.name);
        return;
      }
      setZipBytes(null);
      setZipFiles(0);
      const parsed = JSON.parse(await file.text()) as JsonExport;
      if (parsed?.format !== "agentcrm-export") throw new Error(t("export.notAnExport"));
      setData(parsed);
      setFileName(file.name);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const counts = data ? Object.entries(data.collections).map(([c, docs]) => `${c}: ${docs?.length ?? 0}`) : [];

  return (
    <Card title={t("export.restoreTitle")}>
      <p className="mb-3 text-[13px] text-surface-600 dark:text-surface-300">{t("export.restoreHelp")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json,.zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void load(f);
            e.target.value = "";
          }}
        />
        <Button icon={<Upload />} onClick={() => fileRef.current?.click()}>
          {fileName || t("export.chooseBackup")}
        </Button>
        <FormField label={t("export.mode")} htmlFor="restore-mode">
          <Select
            id="restore-mode"
            value={mode}
            options={[
              { value: "merge", label: t("export.modeMerge") },
              { value: "replace", label: t("export.modeReplace") },
            ]}
            onChange={(e) => setMode(e.target.value === "replace" ? "replace" : "merge")}
          />
        </FormField>
        <Button variant="danger" icon={<RotateCcw />} disabled={!data} onClick={() => setConfirmOpen(true)}>
          {t("export.restore")}
        </Button>
      </div>
      {data && <p className="mt-2 text-xs text-surface-500">{t("export.backupInfo", { date: data.exportedAt, counts: counts.join(" · ") })}{zipBytes ? ` · ${t("export.zipFiles", { count: zipFiles })}` : ""}</p>}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        size="sm"
        title={t("export.restoreConfirmTitle")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              {tc("common.cancel")}
            </Button>
            <Button
              variant="danger"
              icon={<RotateCcw />}
              loading={busy}
              disabled={typed.trim().toUpperCase() !== keyword.toUpperCase()}
              onClick={async () => {
                if (!data) return;
                setBusy(true);
                try {
                  const r = zipBytes ? await importBackupZip(ops, zipBytes, { mode }) : await importJson(ops, data, { mode });
                  toast.success(t("export.restored", { written: r.written, deleted: r.deleted }));
                  setConfirmOpen(false);
                  setData(null);
                  setZipBytes(null);
                  setFileName("");
                  setTyped("");
                } catch (err) {
                  toast.error(errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("export.restore")}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-[13px] text-surface-600 dark:text-surface-300">{mode === "replace" ? t("export.restoreReplaceWarning") : t("export.restoreMergeWarning")}</p>
        <FormField label={t("export.typeToConfirm", { keyword })} htmlFor="restore-confirm">
          <Input id="restore-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </FormField>
      </Modal>
    </Card>
  );
}
