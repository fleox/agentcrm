import { createContext, useContext } from "react";
import type { CrmUser } from "../../core/types";

// What FieldValue / FieldInput need from the data layer, provided by
// app/CrmDataContext (so the UI kit never imports the app).
export interface FieldContextValue {
  locale: string;
  currency: string;
  recordLabel(id: string): string | undefined;
  // Search records of an object for relation pickers.
  searchRecords(object: string, query: string, limit?: number): { id: string; label: string; sub?: string }[];
  users: CrmUser[];
  // Link to a record page ("#/objects/<object>/<id>").
  recordHref(object: string, id: string): string;
}

export const FieldContext = createContext<FieldContextValue>({
  locale: "en-US",
  currency: "USD",
  recordLabel: () => undefined,
  searchRecords: () => [],
  users: [],
  recordHref: (object, id) => `#/objects/${object}/${id}`,
});

export function useFieldContext(): FieldContextValue {
  return useContext(FieldContext);
}
