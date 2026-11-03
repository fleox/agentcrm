// Step "Admin hosting" (optional): where the admin itself is published
// for the team, with config.js next to it. Also used by Settings → Admin
// hosting (HostingForm).

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, Cloud, FolderOpen, Github, Gitlab, Monitor, Server } from "lucide-react";
import { FormField, Input } from "../../../components/ui";
import { hostingMissing, testHosting, type HostingInput } from "../services/installers";
import { HOSTING_FIELDS, HOSTING_OPTIONS, hostingOption, type HostingOptionId } from "../services/locations";
import { ChoiceCards, ConnectorFields, FolderPicker, Note, SectionTitle, TestButton, TestStatus, type TestState } from "../components/SetupUi";
import { setupErrorMessage } from "./shared";
import { StepFooter, type StepProps } from "./LocationStep";

const ICONS: Record<HostingOptionId, JSX.Element> = {
  none: <Monitor />,
  "github-pages": <Github />,
  "cloudflare-pages": <Cloud />,
  "gitlab-pages": <Gitlab />,
  s3: <Server />,
  "local-folder": <FolderOpen />,
  zip: <Archive />,
};

export type HostingValue = HostingInput & { folderName: string | null };

export function HostingForm({
  value,
  onChange,
  onTested,
  exclude = [],
}: {
  value: HostingValue;
  onChange(next: HostingValue): void;
  onTested?(ok: boolean): void;
  exclude?: HostingOptionId[];
}) {
  const { t } = useTranslation("setup");
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const option = hostingOption(value.optionId);
  const set = (patch: Partial<HostingValue>) => {
    onChange({ ...value, ...patch });
    setTest({ status: "idle" });
    onTested?.(false);
  };
  const runTest = async () => {
    setTest({ status: "running" });
    try {
      const detail = await testHosting(value);
      setTest({ status: "ok", detail: t("hosting.testOk", { detail }) });
      onTested?.(true);
    } catch (err) {
      setTest({ status: "error", detail: setupErrorMessage(t, err) });
      onTested?.(false);
    }
  };
  const settings = { ...option.preset, ...value.settings };
  return (
    <div className="space-y-4">
      <ChoiceCards
        columns={2}
        value={value.optionId}
        onChange={(id) => set({ optionId: id, settings: { ...hostingOption(id).preset }, folderName: null })}
        choices={HOSTING_OPTIONS.filter((o) => !exclude.includes(o.id)).map((o) => ({
          id: o.id,
          icon: ICONS[o.id],
          title: t(`hosting.options.${o.id}.title`),
          description: t(`hosting.options.${o.id}.description`),
        }))}
      />
      {value.optionId !== "none" && value.optionId !== "zip" && (
        <>
          {value.optionId === "local-folder" && <FolderPicker handleKey="publish-target" picked={value.folderName} onPicked={(name) => set({ folderName: name })} />}
          <ConnectorFields idPrefix="host" fields={HOSTING_FIELDS[value.optionId]} value={settings} onChange={(next) => set({ settings: next })} />
          <FormField label={t("hosting.folder")} htmlFor="host-folder" help={t("hosting.folderHelp")}>
            <Input id="host-folder" value={value.folder} autoComplete="off" onChange={(e) => set({ folder: e.target.value })} placeholder="admin" />
          </FormField>
          <Note tone="info" title={t(`hosting.howTo.${value.optionId}.title`)}>
            {t(`hosting.howTo.${value.optionId}.body`)}
          </Note>
          <div className="flex items-center gap-3">
            <TestButton running={test.status === "running"} onClick={() => void runTest()} />
            {hostingMissing(value).length > 0 && <span className="text-xs text-surface-500">{t("location.fillRequired")}</span>}
          </div>
          <TestStatus state={test} />
        </>
      )}
      {value.optionId === "zip" && <Note tone="info">{t("hosting.zipHint")}</Note>}
      {value.optionId === "none" && <Note tone="info">{t("hosting.noneHint")}</Note>}
    </div>
  );
}

export function HostingStep({ state, update, onBack, onNext }: StepProps) {
  const { t } = useTranslation("setup");
  const [tested, setTested] = useState(false);
  const h = state.hosting;
  const needsTest = h.optionId !== "none" && h.optionId !== "zip";
  const canContinue = !needsTest || tested;
  return (
    <form
      data-form-type="other"
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canContinue) onNext();
      }}
    >
      <SectionTitle hint={t("hosting.hint")}>{t("hosting.title")}</SectionTitle>
      <Note tone="warning" title={t("hosting.securityTitle")}>
        {t("hosting.securityBody")}
      </Note>
      <HostingForm value={h} onChange={(next) => update({ hosting: next })} onTested={setTested} />
      <StepFooter onBack={onBack} nextDisabled={!canContinue} nextLabel={h.optionId === "none" ? t("hosting.skip") : undefined} />
    </form>
  );
}
