// Localised labels for the seeded standard schema. Object / field / option /
// stage labels are data (users can rename them), so they are translated once,
// at install time, from the workspace locale. Ids never change.

import type { ObjectDef, Pipeline, ViewDef } from "../types";

interface SchemaLabels {
  objects: Record<string, { singular: string; plural: string }>;
  fields: Record<string, string>; // "<object>.<field>"
  options: Record<string, string>; // "<object>.<field>.<option>"
  stages: Record<string, string>;
  pipelines: Record<string, string>;
  views: Record<string, string>;
}

const FR: SchemaLabels = {
  objects: {
    companies: { singular: "Entreprise", plural: "Entreprises" },
    people: { singular: "Contact", plural: "Contacts" },
    deals: { singular: "Affaire", plural: "Affaires" },
  },
  fields: {
    "companies.name": "Nom",
    "companies.domain": "Domaine",
    "companies.industry": "Secteur",
    "companies.employees": "Effectif",
    "companies.annualRevenue": "Chiffre d'affaires annuel",
    "companies.address": "Adresse",
    "companies.linkedin": "LinkedIn",
    "companies.phone": "Téléphone",
    "companies.tags": "Étiquettes",
    "companies.logo": "Logo",
    "people.firstName": "Prénom",
    "people.lastName": "Nom de famille",
    "people.name": "Nom",
    "people.email": "E-mail",
    "people.phone": "Téléphone",
    "people.jobTitle": "Fonction",
    "people.company": "Entreprise",
    "people.city": "Ville",
    "people.linkedin": "LinkedIn",
    "people.lifecycleStage": "Cycle de vie",
    "people.leadSource": "Source du lead",
    "people.tags": "Étiquettes",
    "people.avatar": "Photo",
    "deals.name": "Nom",
    "deals.amount": "Montant",
    "deals.stage": "Étape",
    "deals.pipeline": "Pipeline",
    "deals.closeDate": "Date de clôture",
    "deals.probability": "Probabilité",
    "deals.company": "Entreprise",
    "deals.contacts": "Contacts",
    "deals.lostReason": "Motif de perte",
  },
  options: {
    "companies.industry.software": "Logiciel",
    "companies.industry.finance": "Finance",
    "companies.industry.healthcare": "Santé",
    "companies.industry.retail": "Commerce",
    "companies.industry.manufacturing": "Industrie",
    "companies.industry.education": "Éducation",
    "companies.industry.media": "Médias",
    "companies.industry.consulting": "Conseil",
    "companies.industry.real-estate": "Immobilier",
    "companies.industry.other": "Autre",
    "people.lifecycleStage.subscriber": "Abonné",
    "people.lifecycleStage.lead": "Lead",
    "people.lifecycleStage.mql": "MQL",
    "people.lifecycleStage.sql": "SQL",
    "people.lifecycleStage.opportunity": "Opportunité",
    "people.lifecycleStage.customer": "Client",
    "people.lifecycleStage.evangelist": "Ambassadeur",
    "people.leadSource.website": "Site web",
    "people.leadSource.referral": "Recommandation",
    "people.leadSource.event": "Événement",
    "people.leadSource.outbound": "Prospection",
    "people.leadSource.partner": "Partenaire",
    "people.leadSource.ads": "Publicité",
    "people.leadSource.social": "Réseaux sociaux",
    "people.leadSource.other": "Autre",
  },
  stages: {
    new: "Nouveau",
    qualified: "Qualifié",
    proposal: "Proposition",
    negotiation: "Négociation",
    won: "Gagné",
    lost: "Perdu",
  },
  pipelines: { sales: "Ventes" },
  views: {
    "companies-all": "Toutes les entreprises",
    "people-all": "Tous les contacts",
    "deals-all": "Toutes les affaires",
    "deals-pipeline": "Pipeline",
  },
};

const BY_LANG: Record<string, SchemaLabels> = { fr: FR };

function labelsFor(locale: string | undefined): SchemaLabels | null {
  if (!locale) return null;
  return BY_LANG[locale.toLowerCase().split(/[-_]/)[0]] ?? null;
}

export function hasSchemaLabels(locale: string | undefined): boolean {
  return labelsFor(locale) !== null;
}

export function localizeObjects(objects: ObjectDef[], locale: string | undefined): ObjectDef[] {
  const L = labelsFor(locale);
  if (!L) return objects;
  const stage = (id: string, label: string) => L.stages[id] ?? label;
  return objects.map((o) => {
    const names = L.objects[o.id];
    return {
      ...o,
      ...(names ? { labelSingular: names.singular, labelPlural: names.plural } : {}),
      fields: o.fields.map((f) => ({
        ...f,
        label: L.fields[`${o.id}.${f.id}`] ?? f.label,
        ...(f.options
          ? {
              options: f.options.map((opt) => ({
                ...opt,
                label:
                  o.id === "deals" && f.id === "stage"
                    ? stage(opt.id, opt.label)
                    : o.id === "deals" && f.id === "pipeline"
                      ? (L.pipelines[opt.id] ?? opt.label)
                      : (L.options[`${o.id}.${f.id}.${opt.id}`] ?? opt.label),
              })),
            }
          : {}),
      })),
    };
  });
}

export function localizePipeline(pipeline: Pipeline, locale: string | undefined): Pipeline {
  const L = labelsFor(locale);
  if (!L) return pipeline;
  return {
    ...pipeline,
    name: L.pipelines[pipeline.id] ?? pipeline.name,
    stages: pipeline.stages.map((s) => ({ ...s, label: L.stages[s.id] ?? s.label })),
  };
}

export function localizeView(view: ViewDef, locale: string | undefined): ViewDef {
  const L = labelsFor(locale);
  if (!L) return view;
  return { ...view, name: L.views[view.id] ?? view.name };
}

// Workspace currency suggested for a UI language.
export function defaultCurrencyFor(locale: string | undefined): string {
  const lang = (locale ?? "").toLowerCase();
  if (lang.startsWith("fr-ca") || lang === "en-ca") return "CAD";
  if (lang.startsWith("fr-ch") || lang.startsWith("de-ch")) return "CHF";
  if (lang.startsWith("en-gb")) return "GBP";
  if (/^(fr|de|es|it|nl|pt|fi|el|ga|sk|sl|et|lv|lt)\b/.test(lang)) return "EUR";
  return "USD";
}
