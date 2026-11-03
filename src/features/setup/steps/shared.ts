import { defaultCurrencyFor } from "../../../core/schema/localize";
import type { TFunction } from "i18next";
import { SetupError } from "../services/installers";
import type { ExistingDataset, FirebaseInput, GitInput, HostingInput, JournalInput, WorkspaceInput, DataModel } from "../services/installers";

export interface WizardState {
  model: DataModel;
  journal: JournalInput & { confirm: string; folderName: string | null };
  git: GitInput & { folderName: string | null };
  firebase: FirebaseInput;
  hosting: HostingInput & { folderName: string | null };
  workspace: WorkspaceInput;
  // Join the dataset detected at the location instead of creating one.
  join: boolean;
  existing: ExistingDataset | null;
}

export type Patch<T> = (patch: Partial<T>) => void;

export function setupErrorMessage(t: TFunction, err: unknown): string {
  if (err instanceof SetupError) {
    const base = t(`setup:errors.${err.kind}`, { detail: err.detail ?? "" });
    return err.detail && !base.includes(err.detail) ? `${base} — ${err.detail}` : base;
  }
  return (err as Error)?.message ?? String(err);
}

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "CHF", "AUD", "JPY", "SEK", "NOK", "DKK", "PLN", "BRL", "INR", "SGD"];

export function initialWizardState(): WizardState {
  return {
    model: "journal",
    journal: { locationId: "s3", settings: { s3Preset: "r2", endpoint: "", region: "auto", forcePathStyle: true }, root: "agentcrm", encrypted: true, passphrase: "", confirm: "", folderName: null },
    git: { provider: "github", owner: "", repo: "", project: "", branch: "main", dir: "crm", apiBaseUrl: "", token: "", folderName: null },
    firebase: {
      apiKey: "",
      authDomain: "",
      projectId: "",
      storageBucket: "",
      messagingSenderId: "",
      appId: "",
      adminEmail: "",
      adminPassword: "",
      signInMethods: ["password", "google"],
      signup: "invite",
      allowedDomains: "",
    },
    hosting: { optionId: "none", settings: {}, folder: "admin", folderName: null },
    workspace: { name: "", currency: defaultCurrencyFor(typeof navigator !== "undefined" ? navigator.language : undefined), adminName: "", adminEmail: "", demo: false },
    join: false,
    existing: null,
  };
}
