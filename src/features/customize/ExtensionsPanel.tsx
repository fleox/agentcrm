// Settings → Modules → Installed extensions: install / upgrade from a ZIP
// (drag & drop, manifest review, explicit trust confirmation), enable /
// disable, export, uninstall. Engine: src/ops/extensions.ts; packages:
// src/extensions/package.ts; live load state: src/extensions/registry.ts.

import { useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Download, MoreHorizontal, Package, Palette, Puzzle, ShieldAlert, Trash2, Upload } from "lucide-react";
import { Badge, Button, Card, Checkbox, Dropdown, EmptyState, IconButton, Modal, Spinner, Switch, confirmDialog } from "../../components/ui";
import { useCan, useCollection, useOps } from "../../app/CrmDataContext";
import { intlLocale } from "../../i18n";
import { isSafeMode } from "../../extensions/loader";
import { ExtensionPackageError, packExtension, readExtensionZip } from "../../extensions/package";
import { listLoadedExtensions, subscribeLoadedExtensions } from "../../extensions/registry";
import type { ExtensionDoc, ExtensionPackage, LoadedExtension } from "../../extensions/types";
import { getExtensionPackage, installExtension, setExtensionEnabled, summarizeExtension, uninstallExtension, type ExtensionSummary } from "../../ops/extensions";
import { toast } from "../../shared/lib/toast";
import { cn, formatDate } from "../../shared/lib/utils";
import { ReadOnlyNotice, formatSize } from "./common";
import { moduleIcon } from "./icons";

function useLoadState(): Map<string, LoadedExtension> {
  const list = useSyncExternalStore(subscribeLoadedExtensions, listLoadedExtensions, listLoadedExtensions);
  return useMemo(() => new Map(list.map((e) => [e.id, e])), [list]);
}

function downloadBytes(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const STATUS_COLOR: Record<string, string> = { loaded: "green", error: "red", disabled: "gray", skipped: "yellow", incompatible: "red", pending: "gray" };

export function ExtensionsPanel() {
  const { t } = useTranslation("customize");
  const canEdit = useCan("extensions.write");
  const docs = useCollection<ExtensionDoc>("extensions");
  const extensions = useMemo(() => docs.map(summarizeExtension).sort((a, b) => a.name.localeCompare(b.name)), [docs]);
  const load = useLoadState();
  const [pending, setPending] = useState<{ pkg: ExtensionPackage } | { error: string } | null>(null);
  const safe = isSafeMode();

  return (
    <div className="space-y-4" data-testid="extensions-panel">
      <p className="text-[13px] text-surface-500">{t("extensions.description")}</p>
      {!canEdit && <ReadOnlyNotice />}
      {safe && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          {t("extensions.safeMode")}
        </div>
      )}
      {canEdit && <DropZone onPackage={(pkg) => setPending({ pkg })} onError={(error) => setPending({ error })} />}
      {extensions.length === 0 ? (
        <EmptyState className="py-10" icon={<Package />} title={t("extensions.empty")} />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-surface-100 dark:divide-surface-800">
            {extensions.map((e) => (
              <ExtensionRow key={e.id} ext={e} state={load.get(e.id)} canEdit={canEdit} />
            ))}
          </ul>
        </Card>
      )}
      {pending && <InstallModal pending={pending} installed={extensions} onClose={() => setPending(null)} />}
    </div>
  );
}

function DropZone({ onPackage, onError }: { onPackage(pkg: ExtensionPackage): void; onError(message: string): void }) {
  const { t } = useTranslation("customize");
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState(false);
  const read = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      onPackage(await readExtensionZip(new Uint8Array(await file.arrayBuffer())));
    } catch (err) {
      onError(err instanceof ExtensionPackageError || err instanceof Error ? err.message : String(err));
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void read(e.dataTransfer.files[0]);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50",
        over ? "border-accent-500 bg-accent-50/60 dark:bg-accent-500/10" : "border-surface-200 hover:border-surface-300 dark:border-surface-700 dark:hover:border-surface-600",
      )}
      data-testid="extension-dropzone"
    >
      <span className="text-surface-400 [&>svg]:h-5 [&>svg]:w-5">{reading ? <Spinner size="sm" /> : <Upload />}</span>
      <span className="text-[13px] font-medium text-surface-700 dark:text-surface-200">{reading ? t("extensions.reading") : t("extensions.drop")}</span>
      <span className="text-xs text-surface-400">{t("extensions.dropHint")}</span>
      <input ref={input} type="file" accept=".zip,application/zip" className="hidden" data-testid="extension-file" onChange={(e) => void read(e.target.files?.[0])} />
    </div>
  );
}

function InstallModal({ pending, installed, onClose }: { pending: { pkg: ExtensionPackage } | { error: string }; installed: ExtensionSummary[]; onClose(): void }) {
  const { t } = useTranslation("customize");
  const { t: tc } = useTranslation();
  const ops = useOps();
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState(false);
  if ("error" in pending) {
    return (
      <Modal open onClose={onClose} title={t("extensions.install.invalid")} size="md" footer={<Button onClick={onClose}>{tc("common.close")}</Button>}>
        <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">{pending.error}</span>
        </div>
      </Modal>
    );
  }
  const { manifest: m, files } = pending.pkg;
  const current = installed.find((e) => e.id === m.id);
  const size = new TextEncoder().encode(files["bundle.js"]).length + (files["style.css"] ? new TextEncoder().encode(files["style.css"]).length : 0);
  const install = async () => {
    setBusy(true);
    try {
      const res = await installExtension(ops, pending.pkg);
      toast.success(res.mode === "upgrade" ? t("extensions.install.upgraded", { name: m.name, version: m.version }) : t("extensions.install.done", { name: m.name, version: m.version }));
      for (const w of res.warnings) toast.warn(w);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const rows: [string, string | undefined][] = [
    [t("extensions.install.id"), m.id],
    [t("extensions.install.kind"), t(`extensions.kind.${m.kind}`)],
    [t("extensions.install.version"), current ? (current.version === m.version ? t("extensions.install.reinstall", { version: m.version }) : t("extensions.install.upgrade", { from: current.version, to: m.version })) : m.version],
    [t("extensions.install.author"), m.author],
    [t("extensions.install.homepage"), m.homepage],
    [t("extensions.install.api"), m.apiVersion],
    [t("extensions.install.size"), formatSize(size)],
    [t("extensions.install.dependsOn"), m.dependsOn?.join(", ")],
  ];
  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      title={current ? t("extensions.install.upgradeTitle") : t("extensions.install.title")}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {tc("common.cancel")}
          </Button>
          <Button variant="primary" icon={<Upload />} loading={busy} disabled={!trusted} onClick={() => void install()} data-testid="confirm-install">
            {current ? t("extensions.install.confirmUpgrade") : t("extensions.install.confirm")}
          </Button>
        </>
      }
    >
      <form data-form-type="other" onSubmit={(e) => e.preventDefault()} className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-300 [&>svg]:h-5 [&>svg]:w-5">{m.kind === "theme" ? <Palette /> : <Puzzle />}</span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-surface-900 dark:text-white">{m.name}</div>
            {m.description && <p className="text-[13px] text-surface-500">{m.description}</p>}
          </div>
        </div>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-surface-500">{k}</dt>
                <dd className="min-w-0 break-words font-medium text-surface-900 dark:text-surface-100">{v}</dd>
              </div>
            ))}
        </dl>
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <div className="flex items-center gap-1.5 font-semibold">
            <ShieldAlert className="h-4 w-4" />
            {t("extensions.install.warningTitle")}
          </div>
          <p className="mt-1">{t("extensions.install.warning")}</p>
        </div>
        <Checkbox checked={trusted} onChange={(e) => setTrusted(e.target.checked)} label={t("extensions.install.trust", { name: m.name })} data-testid="trust-extension" />
      </form>
    </Modal>
  );
}

function ExtensionRow({ ext, state, canEdit }: { ext: ExtensionSummary; state: LoadedExtension | undefined; canEdit: boolean }) {
  const { t } = useTranslation("customize");
  const ops = useOps();
  const [busy, setBusy] = useState(false);
  const Icon = ext.kind === "theme" ? Palette : moduleIcon(ext.icon);
  const status = !ext.compatible ? "incompatible" : state?.status ?? (ext.enabled ? "pending" : "disabled");
  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await fn();
      if (success) toast.success(success);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const uninstall = async () => {
    const ok = await confirmDialog({ title: t("extensions.uninstallTitle", { name: ext.name }), description: t("extensions.uninstallBody"), confirmLabel: t("extensions.uninstall"), danger: true });
    if (ok) await run(() => uninstallExtension(ops, ext.id), t("extensions.uninstalled", { name: ext.name }));
  };
  const exportZip = () =>
    run(async () => {
      const bytes = await packExtension(getExtensionPackage(ops, ext.id));
      downloadBytes(`${ext.id}-${ext.version}.zip`, bytes);
    });
  return (
    <li className="flex items-start gap-3 px-card py-3" data-extension={ext.id}>
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-surface-900 dark:text-white">{ext.name}</span>
          <span className="text-xs tabular-nums text-surface-500">v{ext.version}</span>
          <Badge color={ext.kind === "theme" ? "pink" : "purple"}>{t(`extensions.kind.${ext.kind}`)}</Badge>
          <Badge color={STATUS_COLOR[status]} dot>
            {t(`extensions.status.${status}`)}
          </Badge>
        </div>
        {ext.description && <p className="mt-0.5 text-xs text-surface-500">{ext.description}</p>}
        <p className="mt-1 text-2xs text-surface-400">
          {[ext.author ? t("extensions.by", { author: ext.author }) : null, t("extensions.installedOn", { date: formatDate(ext.installedAt, intlLocale()) }), ext.previousVersion ? t("extensions.upgradedFrom", { version: ext.previousVersion }) : null, formatSize(ext.size.bundle + ext.size.style)].filter(Boolean).join(" · ")}
        </p>
        {status === "error" && state?.error && <p className="mt-1 break-words font-mono text-2xs text-red-600 dark:text-red-400">{state.error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Switch
          checked={ext.enabled}
          disabled={!canEdit || busy || (!ext.enabled && !ext.compatible)}
          label={<span className="sr-only">{ext.name}</span>}
          onChange={(v) => void run(() => setExtensionEnabled(ops, ext.id, v), v ? t("extensions.enabledToast", { name: ext.name }) : t("extensions.disabledToast", { name: ext.name }))}
        />
        <Dropdown
          align="end"
          trigger={({ ref, onClick }) => <IconButton ref={ref as never} size="sm" label={ext.name} icon={<MoreHorizontal />} onClick={onClick} disabled={busy} />}
          items={[
            { id: "export", label: t("extensions.export"), icon: <Download />, onSelect: () => void exportZip() },
            ...(canEdit ? [{ id: "uninstall", label: t("extensions.uninstall"), icon: <Trash2 />, danger: true, separator: true, onSelect: () => void uninstall() }] : []),
          ]}
        />
      </div>
    </li>
  );
}
