// Runtime stub for "@agent-crm/runtime" — the public API of AgentCRM
// extensions. The import map of the admin's index.html (and the extension
// loader's specifier rewrite) points bundles here; every export reads the
// admin's live object globalThis.__AGENTCRM_RUNTIME__.api (populated by
// src/extensions/runtime.ts) — same React, store, router and i18n.
//
// Hand-written. Keep it identical to `runtimeApi` in
// src/extensions/runtime.ts and to types/agentcrm-runtime.d.ts
// (src/extensions/runtime.test.ts checks it).

const G = globalThis.__AGENTCRM_RUNTIME__;
const R = G ? G.api : null;
if (!R) {
  throw new Error(
    "[agentcrm] @agent-crm/runtime is not available: globalThis.__AGENTCRM_RUNTIME__ is not initialised (src/extensions/runtime.ts must be imported first).",
  );
}

export const apiVersion = R.apiVersion;
export const minApiVersion = R.minApiVersion;
export const defineModule = R.defineModule;
export const defineTheme = R.defineTheme;
export const ops = R.ops;
export const useCrm = R.useCrm;
export const useOps = R.useOps;
export const useCan = R.useCan;
export const useCurrentUser = R.useCurrentUser;
export const useCollection = R.useCollection;
export const useObjects = R.useObjects;
export const useObject = R.useObject;
export const useRecords = R.useRecords;
export const useRecord = R.useRecord;
export const useActivities = R.useActivities;
export const usePipelines = R.usePipelines;
export const useViews = R.useViews;
export const useUsers = R.useUsers;
export const useSettings = R.useSettings;
export const useModuleConfig = R.useModuleConfig;
export const useModuleEnabled = R.useModuleEnabled;
export const useAppearance = R.useAppearance;
export const useNavigate = R.useNavigate;
export const useParams = R.useParams;
export const useSearchParams = R.useSearchParams;
export const useLocation = R.useLocation;
export const Link = R.Link;
export const NavLink = R.NavLink;
export const paths = R.paths;
export const recordHref = R.recordHref;
export const addAction = R.addAction;
export const removeAction = R.removeAction;
export const addFilter = R.addFilter;
export const removeFilter = R.removeFilter;
export const doAction = R.doAction;
export const applyFilters = R.applyFilters;
export const registerAiTool = R.registerAiTool;
export const registerAutomationAction = R.registerAutomationAction;
export const Button = R.Button;
export const IconButton = R.IconButton;
export const Input = R.Input;
export const Textarea = R.Textarea;
export const Select = R.Select;
export const Label = R.Label;
export const FormField = R.FormField;
export const Checkbox = R.Checkbox;
export const Switch = R.Switch;
export const Modal = R.Modal;
export const Drawer = R.Drawer;
export const Card = R.Card;
export const Badge = R.Badge;
export const Avatar = R.Avatar;
export const Tabs = R.Tabs;
export const Tooltip = R.Tooltip;
export const Spinner = R.Spinner;
export const EmptyState = R.EmptyState;
export const PageHeader = R.PageHeader;
export const Kbd = R.Kbd;
export const Dropdown = R.Dropdown;
export const Table = R.Table;
export const THead = R.THead;
export const TBody = R.TBody;
export const Tr = R.Tr;
export const Th = R.Th;
export const Td = R.Td;
export const FieldValue = R.FieldValue;
export const FieldInput = R.FieldInput;
export const ObjectIcon = R.ObjectIcon;
export const Markdown = R.Markdown;
export const confirmDialog = R.confirmDialog;
export const toast = R.toast;
export const cn = R.cn;
export const newId = R.newId;
export const i18n = R.i18n;
export const addBundles = R.addBundles;
export const activeLocale = R.activeLocale;
export const intlLocale = R.intlLocale;
export const formatFieldValue = R.formatFieldValue;
export const formatCurrency = R.formatCurrency;
export const formatNumber = R.formatNumber;
export const formatDate = R.formatDate;
export const formatDateTime = R.formatDateTime;
export const formatRelative = R.formatRelative;
export const recordLabel = R.recordLabel;
export const coerceFieldValue = R.coerceFieldValue;
export const isEmptyFieldValue = R.isEmptyFieldValue;
