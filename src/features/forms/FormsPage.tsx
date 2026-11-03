import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { ExternalLink, FileInput, Plus } from "lucide-react";
import { useCan, useForms, useObjects } from "../../app/CrmDataContext";
import { Badge, Button, EmptyState, PageHeader, Table, TBody, Td, Th, THead, Tr } from "../../components/ui";
import { intlLocale } from "../../i18n";
import type { LeadFormDoc } from "../../ops/forms";
import { formatRelative } from "../../shared/lib/utils";
import { FormsTabs } from "./FormsTabs";

export function FormsPage() {
  const { t } = useTranslation("forms");
  const navigate = useNavigate();
  const forms = useForms() as LeadFormDoc[];
  const objects = useObjects();
  const canWrite = useCan("forms.write");
  const sorted = [...forms].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div>
      <PageHeader
        title={t("title")}
        icon={<FileInput />}
        description={t("subtitle")}
        actions={
          canWrite && (
            <Button variant="primary" icon={<Plus />} onClick={() => navigate("/forms/new")}>
              {t("list.new")}
            </Button>
          )
        }
      />
      <FormsTabs value="list" />
      <div className="p-4">
        {sorted.length === 0 ? (
          <EmptyState
            className="py-20"
            icon={<FileInput />}
            title={t("empty")}
            description={t("emptyHint")}
            action={
              canWrite && (
                <Button icon={<Plus />} onClick={() => navigate("/forms/new")}>
                  {t("list.new")}
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-surface-200 dark:border-surface-800">
            <Table>
              <THead>
                <Tr>
                  <Th>{t("list.name")}</Th>
                  <Th>{t("list.object")}</Th>
                  <Th>{t("list.inbox")}</Th>
                  <Th>{t("list.published")}</Th>
                  <Th>{t("list.lastIngest")}</Th>
                </Tr>
              </THead>
              <TBody>
                {sorted.map((f) => (
                  <Tr key={f.id}>
                    <Td>
                      <Link to={`/forms/${f.id}`} className="font-medium text-surface-900 hover:underline dark:text-white">
                        {f.name}
                      </Link>
                      <div className="text-xs text-surface-500">{t("list.fieldsCount", { count: f.fields.length })}</div>
                    </Td>
                    <Td className="text-sm">{objects.find((o) => o.id === f.object)?.labelPlural ?? f.object}</Td>
                    <Td>
                      <Badge color={f.inbox.kind === "webhook" ? "purple" : f.inbox.kind === "firebase" ? "orange" : "blue"}>{t(`inbox.kinds.${f.inbox.kind}`)}</Badge>
                    </Td>
                    <Td className="text-sm">
                      {f.publishedUrl ? (
                        <a href={f.publishedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-700 hover:underline dark:text-accent-300">
                          {t("list.open")}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : f.publishedAt ? (
                        <span className="text-surface-500">{formatRelative(f.publishedAt, intlLocale())}</span>
                      ) : (
                        <span className="text-surface-400">{t("list.notPublished")}</span>
                      )}
                    </Td>
                    <Td className="text-sm text-surface-500">{f.inbox.kind === "webhook" ? "—" : f.lastIngestAt ? formatRelative(f.lastIngestAt, intlLocale()) : t("list.never")}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
