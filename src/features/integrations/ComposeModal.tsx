import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { Button, FormField, Input, Modal, Select, Switch, Textarea } from "../../components/ui";
import { useCan, useOps } from "../../app/CrmDataContext";
import type { CrmRecord } from "../../core/types";
import { parseAddressList, type IntegrationProvider } from "../../ops/integrations";
import { toast } from "../../shared/lib/toast";
import { useIntegrations } from "./hooks";
import { sendEmail } from "./service";

export interface ComposeDefaults {
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
}

export function ComposeModal({ open, onClose, record, defaults }: { open: boolean; onClose(): void; record?: CrmRecord; defaults?: ComposeDefaults }) {
  const { t } = useTranslation("integrations");
  const ops = useOps();
  const canLog = useCan("activities.write");
  const { settings, connected, google, microsoft } = useIntegrations();
  const [provider, setProvider] = useState<IntegrationProvider>(connected[0] ?? "google");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [log, setLog] = useState(settings.autoLog);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTo(defaults?.to ?? "");
    setCc(defaults?.cc ?? "");
    setSubject(defaults?.subject ?? "");
    setBody(defaults?.body ?? "");
    setLog(settings.autoLog);
    setProvider((p) => (connected.includes(p) ? p : (connected[0] ?? "google")));
    // Reset only when (re)opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const recipients = parseAddressList(to);
  const account = (provider === "google" ? google : microsoft)?.account;

  return (
    <Modal open={open} onClose={onClose} title={t("compose.title")} description={account ? t("compose.from", { account }) : undefined} size="lg" dismissible={false}>
      <form
        data-form-type="other"
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!recipients.length) {
            toast.error(t("compose.noRecipient"));
            return;
          }
          setSending(true);
          try {
            const res = await sendEmail(ops, provider, { to: recipients, cc: parseAddressList(cc), subject, body }, settings, { log: log && canLog, record });
            toast.success(res.logged ? t("compose.sentLogged") : t("compose.sent"));
            onClose();
          } catch (err) {
            toast.error((err as Error).message);
          } finally {
            setSending(false);
          }
        }}
      >
        {connected.length > 1 && (
          <FormField label={t("compose.via")} htmlFor="int-compose-provider">
            <Select
              id="int-compose-provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value as IntegrationProvider)}
              options={connected.map((p) => ({ value: p, label: t(`providers.${p}`) }))}
            />
          </FormField>
        )}
        <FormField label={t("compose.to")} htmlFor="int-compose-to">
          <Input id="int-compose-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="ada@example.com, bob@example.com" autoComplete="off" />
        </FormField>
        <FormField label={t("compose.cc")} htmlFor="int-compose-cc">
          <Input id="int-compose-cc" value={cc} onChange={(e) => setCc(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField label={t("compose.subject")} htmlFor="int-compose-subject">
          <Input id="int-compose-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </FormField>
        <FormField label={t("compose.body")} htmlFor="int-compose-body">
          <Textarea id="int-compose-body" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
        </FormField>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {canLog ? <Switch checked={log} onChange={setLog} label={t("compose.logToTimeline")} size="sm" /> : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={sending}>
              {t("compose.cancel")}
            </Button>
            <Button type="submit" variant="primary" icon={<Send />} loading={sending} disabled={!connected.length}>
              {t("compose.send")}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
