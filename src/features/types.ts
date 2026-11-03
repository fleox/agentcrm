// The feature contract. Each folder under src/features/ exports ONE
// `Feature` from its index.ts; src/features/index.ts lists them and the
// app shell (src/app/) aggregates routes, nav items, i18n namespaces and
// slots. A feature never edits another feature's folder: cross-feature
// UI goes through slots.

import type { ComponentType, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { CrmRecord, CrmUser, ObjectDef, UserRole } from "../core/types";
import type { NamespaceBundles } from "../i18n";

export interface FeatureRoute {
  // Path under the HashRouter, e.g. "/tasks", "/objects/:objectId".
  path: string;
  element: ReactNode;
  // Roles allowed (default: everyone signed in).
  roles?: UserRole[];
}

export type NavSection = "main" | "workspace" | "bottom";

export interface NavItem {
  id: string;
  // i18n key, namespaced ("tasks:nav.title") or core ("nav.tasks").
  label: string;
  icon: LucideIcon;
  to: string;
  section?: NavSection;
  order?: number;
  roles?: UserRole[];
  // Small counter shown on the right (e.g. open tasks).
  useBadge?: () => number | null;
}

export interface RecordSlotProps {
  record: CrmRecord;
  object: ObjectDef;
}

// A tab on the record detail page (Timeline, Tasks, Notes, Emails…).
export interface RecordDetailTab {
  id: string;
  label: string; // i18n key
  icon?: LucideIcon;
  order?: number;
  component: ComponentType<RecordSlotProps>;
  // Show only for some objects.
  when?: (object: ObjectDef) => boolean;
}

// A card in the record detail side column (below the fields).
export interface RecordDetailPanel {
  id: string;
  order?: number;
  component: ComponentType<RecordSlotProps>;
  when?: (object: ObjectDef) => boolean;
}

// An action button on the record detail header (e.g. "Send email").
export interface RecordAction {
  id: string;
  label: string; // i18n key
  icon?: LucideIcon;
  order?: number;
  component?: ComponentType<RecordSlotProps>;
  onSelect?: (props: RecordSlotProps) => void;
  when?: (object: ObjectDef) => boolean;
}

// A section of the Settings page contributed by another feature.
export interface SettingsSection {
  id: string;
  label: string; // i18n key
  icon?: LucideIcon;
  order?: number;
  roles?: UserRole[];
  component: ComponentType;
}

// A widget on the dashboard contributed by another feature.
export interface DashboardWidget {
  id: string;
  order?: number;
  // Grid width out of 12.
  span?: 4 | 6 | 8 | 12;
  component: ComponentType;
}

export interface FeatureSlots {
  // Small components in the top bar, left of the theme toggle.
  topBar?: ComponentType[];
  recordDetailTabs?: RecordDetailTab[];
  recordDetailPanels?: RecordDetailPanel[];
  recordActions?: RecordAction[];
  // Always mounted inside the signed-in shell (command palette, assistant
  // panel, background sync…).
  globalOverlays?: ComponentType[];
  settingsSections?: SettingsSection[];
  dashboardWidgets?: DashboardWidget[];
  // Login screen for backends with accounts (firebase, git-json). Shown
  // when store.identity() is null; call onSignedIn once signed in.
  loginScreen?: ComponentType<{ onSignedIn(): void }>;
}

export interface Feature {
  id: string;
  routes: FeatureRoute[];
  // Routes rendered when the admin is NOT configured (setup wizard).
  unconfiguredRoutes?: FeatureRoute[];
  navItems?: NavItem[];
  // Registered as namespace `id` → t(`${id}:key`).
  i18n: NamespaceBundles;
  slots?: FeatureSlots;
  // Runs once when the signed-in shell mounts (subscribe to plugin
  // actions, start timers…). Return a cleanup function.
  onStart?: (env: FeatureEnv) => void | (() => void);
}

// What onStart receives.
export interface FeatureEnv {
  user: CrmUser;
}

export type SlotName = keyof FeatureSlots;
