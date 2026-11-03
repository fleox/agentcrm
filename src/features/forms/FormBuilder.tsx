import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp, Code2, Copy, Download, ExternalLink, FileInput, Plus, Save, Trash2, UploadCloud, X } from "lucide-react";
import { useCan, useDoc, useObjects, useOps, useUsers } from "../../app/CrmDataContext";
import { Button, Card, Checkbox, confirmDialog, downloadText, EmptyState, FieldInput, FormField, IconButton, Input, Modal, PageHeader, Select, Textarea } from "../../components/ui";
import type { ObjectDef } from "../../core/types";
import { getRuntimeConfig } from "../../lib/runtimeConfig";
import { buildFormArtifacts, buildFormHtml, createForm, deleteForm, isFormFieldType, publishForm, suggestFormFields, updateForm, type LeadFormDoc, type LeadFormInput } from "../../ops/forms";
import { publicUrlFor, uploadFile, withStorageBatch } from "../../shared/siteFiles";
import { toast } from "../../shared/lib/toast";

function defaultInbox(): LeadFormDoc["inbox"] {
  const config = getRuntimeConfig();
  if (config?.backend === "firebase") return { kind: "firebase", settings: { projectId: config.firebase.projectId ?? "", apiKey: config.firebase.apiKey ?? "", collection: "inbox" } };
  return { kind: "s3", settings: { uploadUrl: "", prefix: "inbox/", source: "hosting" } };
}

function blankForm(ops: ReturnType<typeof useOps>, objectId: string, t: (k: string) => string): LeadFormInput {
  return {
    name: t("builder.defaultName"),
    object: objectId,
    fields: suggestFormFields(ops, objectId),
    inbox: defaultInbox(),
    successMessage: t("builder.defaultSuccess"),
    ...(objectId === "people" ? { hiddenValues: { lifecycleStage: "lead", leadSource: "website" } } : {}),
  };
}

export function FormBuilderPage() {
  const { formId } = useParams();
  const { t } = useTranslation("forms");
  const ops = useOps();
  const objects = useObjects();
  const existing = useDoc<LeadFormDoc>("forms", formId && formId !== "new" ? formId : undefined);
  if (formId && formId !== "new" && !existing) return <EmptyState className="py-24" icon={<FileInput />} title={t("builder.notFound")} />;
  const objectId = objects.find((o) => o.id === "people")?.id ?? objects[0]?.id ?? "people";
  const initial: LeadFormInput = existing ? (JSON.parse(JSON.stringify(existing)) as LeadFormInput) : blankForm(ops, objectId, t);
  return <FormBuilder key={existing?.id ?? "new"} id={existing?.id} initial={initial} published={existing} />;
}

function FormBuilder({ id, initial, published }: { id?: string; initial: LeadFormInput; published?: LeadFormDoc }) {
  const { t, i18n } = useTranslation("forms");
  const ops = useOps();
  const navigate = useNavigate();
  const objects = useObjects();
  const users = useUsers();
  const canWrite = useCan("forms.write");
  const [draft, setDraft] = useState<LeadFormInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [embed, setEmbed] = useState<string | null>(null);
  const object = objects.find((o) => o.id === draft.object);
  const set = (patch: Partial<LeadFormInput>) => setDraft((d) => ({ ...d, ...patch }));
  const setInbox = (patch: Record<string, string>) => setDraft((d) => ({ ...d, inbox: { ...d.inbox, settings: { ...d.inbox.settings, ...patch } } }));
  const eligible = (object?.fields ?? []).filter((f) => isFormFieldType(f.type) && !f.hidden);
  const remaining = eligible.filter((f) => !draft.fields.some((x) => x.field === f.id));

  const preview = useMemo(() => {
    if (!object || !draft.fields.length) return "";
    try {
      return buildFormArtifacts({ ...(draft as LeadFormDoc), id: id ?? "preview" }, object, { preview: true, lang: i18n.language }).html;
    } catch {
      return "";
    }
  }, [draft, object, id, i18n.language]);

  const save = async (e?: FormEvent): Promise<string | null> => {
    e?.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = id ? await updateForm(ops, id, draft) : await createForm(ops, draft);
      toast.success(t("builder.saved"));
      if (!id) navigate(`/forms/${saved.id}`, { replace: true });
      return saved.id;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    const savedId = await save();
    if (!savedId) return;
    setPublishing(true);
    try {
      const res = await withStorageBatch(() => publishForm(ops, savedId, { put: (i) => uploadFile(i), publicUrl: publicUrlFor }, { lang: i18n.language }));
      toast.success(res.url ? t("builder.publishedAt", { url: res.url }) : t("builder.published", { path: res.path }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  const showEmbed = async () => {
    const savedId = id ?? (await save());
    if (!savedId) return;
    setEmbed((await buildFormHtml(ops, savedId, { lang: i18n.language })).embedSnippet);
  };

  const download = async () => {
    const savedId = id ?? (await save());
    if (!savedId) return;
    const built = await buildFormHtml(ops, savedId, { lang: i18n.language });
    downloadText(built.path.split("/").slice(-2).join("-") || "form.html", built.html, "text/html;charset=utf-8");
  };

  const remove = async () => {
    if (!id || !(await confirmDialog({ title: t("builder.deleteConfirm", { name: draft.name }), description: t("builder.deleteConfirmBody"), danger: true, confirmLabel: t("builder.delete") }))) return;
    await deleteForm(ops, id);
    toast.success(t("builder.deleted"));
    navigate("/forms");
  };

  const moveField = (i: number, d: number) => {
    const next = [...draft.fields];
    const [f] = next.splice(i, 1);
    next.splice(i + d, 0, f);
    set({ fields: next });
  };
  const hidden = Object.entries(draft.hiddenValues ?? {});
  const kind = draft.inbox.kind;
  const s = draft.inbox.settings;

  return (
    <div>
      <PageHeader
        title={id ? draft.name : t("builder.newTitle")}
        icon={<FileInput />}
        actions={
          <>
            <Button variant="ghost" icon={<ArrowLeft />} onClick={() => navigate("/forms")}>
              {t("builder.back")}
            </Button>
            {id && canWrite && (
              <Button variant="ghost" icon={<Trash2 />} onClick={() => void remove()}>
                {t("builder.delete")}
              </Button>
            )}
            <Button icon={<Code2 />} onClick={() => void showEmbed()} disabled={!canWrite && !id}>
              {t("builder.embed")}
            </Button>
            <Button icon={<Download />} onClick={() => void download()} disabled={!canWrite && !id}>
              {t("builder.download")}
            </Button>
            {canWrite && (
              <>
                <Button icon={<Save />} loading={saving && !publishing} onClick={() => void save()}>
                  {t("builder.save")}
                </Button>
                <Button variant="primary" icon={<UploadCloud />} loading={publishing} onClick={() => void publish()}>
                  {t("builder.publish")}
                </Button>
              </>
            )}
          </>
        }
      />
      <form data-form-type="other" onSubmit={(e) => void save(e)} className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <div className="space-y-4">
          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
          {published?.publishedUrl && (
            <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
              {t("builder.liveAt")}
              <a href={published.publishedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium underline">
                {published.publishedUrl}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          <Card title={t("builder.general")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t("builder.name")} htmlFor="form-name">
                <Input id="form-name" value={draft.name} disabled={!canWrite} onChange={(e) => set({ name: e.target.value })} />
              </FormField>
              <FormField label={t("builder.object")} htmlFor="form-object">
                <Select
                  id="form-object"
                  value={draft.object}
                  disabled={!canWrite}
                  options={objects.map((o) => ({ value: o.id, label: o.labelPlural }))}
                  onChange={(e) => set({ object: e.target.value, fields: suggestFormFields(ops, e.target.value), hiddenValues: {} })}
                />
              </FormField>
              <FormField label={t("builder.pageTitle")} help={t("builder.pageTitleHint")}>
                <Input value={draft.texts?.title ?? ""} disabled={!canWrite} placeholder={draft.name} onChange={(e) => set({ texts: { ...draft.texts, title: e.target.value } })} />
              </FormField>
              <FormField label={t("builder.submitLabel")}>
                <Input value={draft.texts?.submit ?? ""} disabled={!canWrite} placeholder={t("builder.submitDefault")} onChange={(e) => set({ texts: { ...draft.texts, submit: e.target.value } })} />
              </FormField>
              <FormField label={t("builder.description")} className="sm:col-span-2">
                <Textarea rows={2} value={draft.texts?.description ?? ""} disabled={!canWrite} onChange={(e) => set({ texts: { ...draft.texts, description: e.target.value } })} />
              </FormField>
              <FormField label={t("builder.successMessage")} className="sm:col-span-2">
                <Textarea rows={2} value={draft.successMessage} disabled={!canWrite} onChange={(e) => set({ successMessage: e.target.value })} />
              </FormField>
              <FormField label={t("builder.redirectUrl")} help={t("builder.redirectUrlHint")}>
                <Input type="url" value={draft.redirectUrl ?? ""} disabled={!canWrite} placeholder="https://" onChange={(e) => set({ redirectUrl: e.target.value || undefined })} />
              </FormField>
              <FormField label={t("builder.accentColor")}>
                <div className="flex items-center gap-2">
                  <input type="color" aria-label={t("builder.accentColor")} className="h-8 w-10 cursor-pointer rounded border border-surface-200 bg-transparent dark:border-surface-700" value={draft.accentColor ?? "#2563eb"} disabled={!canWrite} onChange={(e) => set({ accentColor: e.target.value })} />
                  <Input value={draft.accentColor ?? ""} disabled={!canWrite} placeholder="#2563eb" onChange={(e) => set({ accentColor: e.target.value || undefined })} />
                </div>
              </FormField>
              <FormField label={t("builder.path")} help={t("builder.pathHint")} className="sm:col-span-2">
                <Input value={draft.publishedPath ?? ""} disabled={!canWrite} placeholder="forms/contact/index.html" onChange={(e) => set({ publishedPath: e.target.value || undefined })} />
              </FormField>
              <FormField label={t("builder.owner")} help={t("builder.ownerHint")}>
                <Select value={draft.ownerId ?? ""} disabled={!canWrite} options={[{ value: "", label: t("builder.noOwner") }, ...users.filter((u) => !u.disabled && u.role !== "viewer").map((u) => ({ value: u.id, label: u.name }))]} onChange={(e) => set({ ownerId: e.target.value || undefined })} />
              </FormField>
            </div>
          </Card>

          <Card title={t("builder.fields")}>
            <div className="space-y-2">
              {draft.fields.map((f, i) => {
                const def = object?.fields.find((x) => x.id === f.field);
                return (
                  <div key={f.field} className="flex flex-wrap items-center gap-2 rounded-md bg-surface-50 p-2 dark:bg-surface-900/60">
                    <span className="w-32 truncate text-xs text-surface-500" title={def?.label}>
                      {def?.label ?? f.field}
                    </span>
                    <Input className="min-w-[10rem] flex-1" aria-label={t("builder.fieldLabel")} value={f.label} disabled={!canWrite} placeholder={def?.label} onChange={(e) => set({ fields: draft.fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                    <Checkbox label={t("builder.required")} checked={f.required} disabled={!canWrite} onChange={(e) => set({ fields: draft.fields.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} />
                    <IconButton size="sm" label={t("builder.moveUp")} icon={<ArrowUp />} disabled={!canWrite || i === 0} onClick={() => moveField(i, -1)} />
                    <IconButton size="sm" label={t("builder.moveDown")} icon={<ArrowDown />} disabled={!canWrite || i === draft.fields.length - 1} onClick={() => moveField(i, 1)} />
                    <IconButton size="sm" label={t("builder.removeField")} icon={<X />} disabled={!canWrite} onClick={() => set({ fields: draft.fields.filter((_, j) => j !== i) })} />
                  </div>
                );
              })}
              {canWrite && remaining.length > 0 && (
                <Select
                  className="max-w-xs"
                  aria-label={t("builder.addField")}
                  value=""
                  placeholder={t("builder.addField")}
                  options={remaining.map((f) => ({ value: f.id, label: f.label }))}
                  onChange={(e) => {
                    const def = remaining.find((f) => f.id === e.target.value);
                    if (def) set({ fields: [...draft.fields, { field: def.id, label: def.label, required: false }] });
                  }}
                />
              )}
              {draft.object === "people" && !draft.fields.some((f) => f.field === "email") && <p className="text-xs text-amber-700 dark:text-amber-300">{t("builder.emailHint")}</p>}
            </div>
          </Card>

          <Card title={t("builder.hiddenValues")}>
            <p className="mb-2 text-xs text-surface-500">{t("builder.hiddenValuesHint")}</p>
            <HiddenValues object={object} values={hidden} disabled={!canWrite} onChange={(entries) => set({ hiddenValues: Object.fromEntries(entries) })} />
          </Card>

          <Card title={t("inbox.title")}>
            <div className="space-y-3">
              <FormField label={t("inbox.kind")}>
                <Select
                  value={kind}
                  disabled={!canWrite}
                  options={(["s3", "firebase", "webhook"] as const).map((k) => ({ value: k, label: t(`inbox.kinds.${k}`) }))}
                  onChange={(e) => {
                    const k = e.target.value as LeadFormDoc["inbox"]["kind"];
                    const config = getRuntimeConfig();
                    set({
                      inbox: {
                        kind: k,
                        settings:
                          k === "s3"
                            ? { uploadUrl: "", prefix: "inbox/", source: "hosting" }
                            : k === "firebase"
                              ? { projectId: config?.backend === "firebase" ? (config.firebase.projectId ?? "") : "", apiKey: config?.backend === "firebase" ? (config.firebase.apiKey ?? "") : "", collection: "inbox" }
                              : { url: "", format: "json" },
                      },
                    });
                  }}
                />
              </FormField>
              <p className="text-xs text-surface-500">{t(`inbox.help.${kind}`)}</p>
              {kind === "s3" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label={t("inbox.uploadUrl")} help={t("inbox.uploadUrlHint")} className="sm:col-span-2">
                    <Input value={s.uploadUrl ?? ""} disabled={!canWrite} placeholder="https://my-bucket.s3.eu-west-3.amazonaws.com/inbox/" onChange={(e) => setInbox({ uploadUrl: e.target.value })} />
                  </FormField>
                  <FormField label={t("inbox.prefix")}>
                    <Input value={s.prefix ?? ""} disabled={!canWrite} placeholder="inbox/" onChange={(e) => setInbox({ prefix: e.target.value })} />
                  </FormField>
                  <FormField label={t("inbox.source")}>
                    <Select value={s.source ?? "hosting"} disabled={!canWrite} options={[{ value: "hosting", label: t("inbox.sources.hosting") }, { value: "data", label: t("inbox.sources.data") }]} onChange={(e) => setInbox({ source: e.target.value })} />
                  </FormField>
                </div>
              )}
              {kind === "firebase" && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField label={t("inbox.projectId")}>
                    <Input value={s.projectId ?? ""} disabled={!canWrite} onChange={(e) => setInbox({ projectId: e.target.value })} />
                  </FormField>
                  <FormField label={t("inbox.apiKey")}>
                    <Input value={s.apiKey ?? ""} disabled={!canWrite} onChange={(e) => setInbox({ apiKey: e.target.value })} />
                  </FormField>
                  <FormField label={t("inbox.collection")}>
                    <Input value={s.collection ?? ""} disabled={!canWrite} placeholder="inbox" onChange={(e) => setInbox({ collection: e.target.value })} />
                  </FormField>
                </div>
              )}
              {kind === "webhook" && (
                <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                  <FormField label={t("inbox.webhookUrl")}>
                    <Input type="url" value={s.url ?? ""} disabled={!canWrite} placeholder="https://formspree.io/f/…" onChange={(e) => setInbox({ url: e.target.value })} />
                  </FormField>
                  <FormField label={t("inbox.format")}>
                    <Select value={s.format ?? "json"} disabled={!canWrite} options={[{ value: "json", label: "JSON" }, { value: "form", label: t("inbox.formEncoded") }]} onChange={(e) => setInbox({ format: e.target.value })} />
                  </FormField>
                  <FormField label={t("inbox.extra")} help={t("inbox.extraHint")} className="sm:col-span-2">
                    <Input value={s.extra ?? ""} disabled={!canWrite} placeholder='{"access_key": "…"}' onChange={(e) => setInbox({ extra: e.target.value })} />
                  </FormField>
                </div>
              )}
            </div>
          </Card>
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </div>

        <aside className="xl:sticky xl:top-4 xl:self-start">
          <Card title={t("builder.preview")} padded={false}>
            {preview ? (
              <iframe title={t("builder.preview")} sandbox="allow-scripts allow-forms" srcDoc={preview} className="h-[38rem] w-full rounded-b-lg border-0 bg-white" />
            ) : (
              <p className="p-4 text-sm text-surface-500">{t("builder.previewEmpty")}</p>
            )}
          </Card>
        </aside>
      </form>
      <Modal open={embed !== null} onClose={() => setEmbed(null)} size="lg" title={t("embed.title")} description={t("embed.hint")} footer={
        <Button variant="primary" icon={<Copy />} onClick={() => void navigator.clipboard?.writeText(embed ?? "").then(() => toast.success(t("embed.copied")), () => toast.error(t("embed.copyFailed")))}>
          {t("embed.copy")}
        </Button>
      }>
        <Textarea readOnly rows={14} className="font-mono text-xs" value={embed ?? ""} onFocus={(e) => e.currentTarget.select()} />
      </Modal>
    </div>
  );
}

function HiddenValues({ object, values, onChange, disabled }: { object: ObjectDef | undefined; values: [string, unknown][]; onChange(v: [string, unknown][]): void; disabled?: boolean }) {
  const { t } = useTranslation("forms");
  const fields = (object?.fields ?? []).filter((f) => !f.system && isFormFieldType(f.type));
  const free = fields.filter((f) => !values.some(([k]) => k === f.id));
  return (
    <div className="space-y-2">
      {values.map(([k, v], i) => {
        const def = fields.find((f) => f.id === k);
        return (
          <div key={k} className="flex items-center gap-2">
            <span className="w-40 truncate text-sm">{def?.label ?? k}</span>
            <div className="flex-1">{def ? <FieldInput field={{ ...def, required: false }} value={v} disabled={disabled} onChange={(nv) => onChange(values.map((e, j) => (j === i ? [k, nv] : e)))} /> : <Input disabled value={String(v)} />}</div>
            <IconButton size="sm" label={t("builder.removeField")} icon={<X />} disabled={disabled} onClick={() => onChange(values.filter((_, j) => j !== i))} />
          </div>
        );
      })}
      {!disabled && free.length > 0 && (
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-surface-400" />
          <Select className="max-w-xs" aria-label={t("builder.addHidden")} value="" placeholder={t("builder.addHidden")} options={free.map((f) => ({ value: f.id, label: f.label }))} onChange={(e) => e.target.value && onChange([...values, [e.target.value, undefined]])} />
        </div>
      )}
    </div>
  );
}
