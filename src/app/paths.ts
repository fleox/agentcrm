// Canonical in-app paths (HashRouter). Use these to link between
// features so URLs stay consistent.

export const paths = {
  dashboard: () => "/",
  objectList: (objectId: string, viewId?: string) => `/objects/${objectId}${viewId ? `?view=${encodeURIComponent(viewId)}` : ""}`,
  record: (objectId: string, recordId: string) => `/objects/${objectId}/${recordId}`,
  tasks: () => "/tasks",
  automations: () => "/automations",
  forms: () => "/forms",
  reports: () => "/reports",
  settings: (section?: string) => `/settings${section ? `/${section}` : ""}`,
};

// For plain <a href> (FieldValue relation chips).
export function recordHref(objectId: string, recordId: string): string {
  return `#${paths.record(objectId, recordId)}`;
}
