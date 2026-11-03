// Settings → AI assistant: the user's Anthropic API key (this browser
// only), model and max output tokens.

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, KeyRound, Lock, Save, Trash2, Zap } from "lucide-react";
import { Button, Card, FormField, IconButton, Input, Select } from "../../components/ui";
import { emitShellEvent } from "../../app/shellEvents";
import { toast } from "../../shared/lib/toast";
import {
  ASSISTANT_MODELS,
  MAX_MAX_TOKENS,
  MIN_MAX_TOKENS,
  clampMaxTokens,
  clearAssistantApiKey,
  loadAssistantSettings,
  saveAssistantSettings,
  testApiKey,
} from "../../ai/assistant";
import { ASSISTANT_SETTINGS_CHANGED } from "./events";

export function AssistantSettingsSection() {
  const { t } = useTranslation("assistant");
  const initial = loadAssistantSettings();
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [show, setShow] = useState(false);
  const [model, setModel] = useState(initial.model);
  const [maxTokens, setMaxTokens] = useState(String(initial.maxTokens));
  const [testing, setTesting] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(!!initial.apiKey);

  const models: string[] = (ASSISTANT_MODELS as readonly string[]).includes(model) ? [...ASSISTANT_MODELS] : [...ASSISTANT_MODELS, model];

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    const saved = saveAssistantSettings({ apiKey, model, maxTokens: clampMaxTokens(maxTokens) });
    setApiKey(saved.apiKey);
    setMaxTokens(String(saved.maxTokens));
    setHasStoredKey(!!saved.apiKey);
    emitShellEvent(ASSISTANT_SETTINGS_CHANGED);
    toast.success(t("settings.saved"));
  };

  const onTest = async () => {
    const key = apiKey.trim();
    if (!key) {
      toast.warn(t("settings.noKeyToTest"));
      return;
    }
    setTesting(true);
    try {
      const res = await testApiKey({ apiKey: key, model });
      toast.success(t("settings.testOk", { model: res.model ?? model }));
    } catch (err) {
      toast.error(t("settings.testFailed", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setTesting(false);
    }
  };

  const onClear = () => {
    clearAssistantApiKey();
    setApiKey("");
    setHasStoredKey(false);
    emitShellEvent(ASSISTANT_SETTINGS_CHANGED);
    toast.success(t("settings.cleared"));
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card title={t("settings.title")}>
        <form data-form-type="other" onSubmit={onSave} className="space-y-4">
          <p className="text-sm text-surface-600 dark:text-surface-300">{t("settings.description")}</p>
          <FormField label={t("settings.apiKey")} htmlFor="assistant-api-key" help={t("settings.apiKeyHelp")}>
            <div className="flex items-center gap-1.5">
              <Input
                id="assistant-api-key"
                type={show ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-…"
                autoComplete="off"
                spellCheck={false}
                icon={<KeyRound />}
                className="flex-1"
              />
              <IconButton label={show ? t("settings.hide") : t("settings.show")} icon={show ? <EyeOff /> : <Eye />} onClick={() => setShow((s) => !s)} />
            </div>
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("settings.model")} htmlFor="assistant-model">
              <Select id="assistant-model" value={model} onChange={(e) => setModel(e.target.value)} options={models.map((m) => ({ value: m, label: t(`settings.models.${m}`, { defaultValue: m }) }))} />
            </FormField>
            <FormField label={t("settings.maxTokens")} htmlFor="assistant-max-tokens" help={t("settings.maxTokensHelp", { min: MIN_MAX_TOKENS, max: MAX_MAX_TOKENS })}>
              <Input id="assistant-max-tokens" type="number" min={MIN_MAX_TOKENS} max={MAX_MAX_TOKENS} step={256} value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
            </FormField>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" icon={<Save />}>
              {t("settings.save")}
            </Button>
            <Button type="button" icon={<Zap />} loading={testing} onClick={() => void onTest()}>
              {t("settings.test")}
            </Button>
            <Button type="button" variant="ghost" icon={<Trash2 />} onClick={onClear} disabled={!hasStoredKey && !apiKey}>
              {t("settings.clear")}
            </Button>
          </div>
        </form>
      </Card>
      <div className="flex gap-3 rounded-lg border border-surface-200 bg-surface-50 p-4 text-sm dark:border-surface-800 dark:bg-surface-900">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-surface-500" />
        <div>
          <div className="font-medium text-surface-900 dark:text-white">{t("settings.privacyTitle")}</div>
          <p className="mt-1 text-surface-600 dark:text-surface-300">{t("settings.privacy")}</p>
        </div>
      </div>
    </div>
  );
}
