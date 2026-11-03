// Signed-in shell: collapsible sidebar (feature nav + one entry per
// object), top bar (search trigger, slots, theme, locale, user menu) and
// the routed page.

import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronsLeft, ChevronsRight, Languages, LogOut, Moon, Search, Sun } from "lucide-react";
import { Avatar, Dropdown, IconButton, Kbd, ObjectIcon } from "../components/ui";
import { cn } from "../shared/lib/utils";
import { activeLocale, LOCALE_LABELS, setActiveLocale, SUPPORTED_LOCALES } from "../i18n";
import type { NavItem } from "../features/types";
import { useAuth } from "./AuthContext";
import { useObjects, useSettings } from "./CrmDataContext";
import { getFeatures, getSlot } from "./featureRegistry";
import { paths } from "./paths";
import { emitShellEvent } from "./shellEvents";
import { useTheme } from "./theme";

const SIDEBAR_KEY = "agentcrm.sidebarCollapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

function navItems(role: string): NavItem[] {
  return getFeatures()
    .flatMap((f) => f.navItems ?? [])
    .filter((n) => !n.roles || n.roles.includes(role as never))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

function NavEntry({ to, icon, label, collapsed, badge, end }: { to: string; icon: ReactNode; label: string; collapsed: boolean; badge?: number | null; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          "group flex h-7 items-center gap-2 rounded-md px-2 text-[13px] font-medium transition-colors",
          isActive ? "bg-surface-200/70 text-surface-900 dark:bg-surface-800 dark:text-white" : "text-surface-600 hover:bg-surface-100 hover:text-surface-900 dark:text-surface-400 dark:hover:bg-surface-800/60 dark:hover:text-surface-100",
          collapsed && "justify-center px-0",
        )
      }
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && badge ? <span className="rounded bg-surface-200 px-1 text-2xs text-surface-600 dark:bg-surface-700 dark:text-surface-300">{badge}</span> : null}
    </NavLink>
  );
}

function FeatureNav({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const { t } = useTranslation();
  const badge = item.useBadge?.() ?? null;
  const Icon = item.icon;
  return <NavEntry to={item.to} icon={<Icon />} label={t(item.label)} collapsed={collapsed} badge={badge} end={item.to === "/"} />;
}

function Section({ title, collapsed, children }: { title?: string; collapsed: boolean; children: ReactNode }) {
  return (
    <div className="space-y-px">
      {title && !collapsed && <div className="px-2 pb-1 pt-3 text-2xs font-medium uppercase tracking-wide text-surface-400">{title}</div>}
      {title && collapsed && <div className="mx-2 my-2 h-px bg-surface-200 dark:bg-surface-800" />}
      {children}
    </div>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const objects = useObjects();
  const settings = useSettings();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
    } catch {
      // Not persisted.
    }
  }, [collapsed]);
  const items = navItems(user.role);
  const bySection = (s: NavItem["section"]) => items.filter((i) => (i.section ?? "main") === s);

  return (
    <aside className={cn("flex h-full shrink-0 flex-col border-r border-surface-200 bg-surface-50 transition-[width] duration-150 dark:border-surface-800 dark:bg-surface-900", collapsed ? "w-[52px]" : "w-[220px]")}>
      <div className={cn("flex h-12 shrink-0 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-900 text-xs font-bold text-white dark:bg-white dark:text-surface-900">{(settings.name || "A").slice(0, 1).toUpperCase()}</span>
        {!collapsed && <span className="min-w-0 flex-1 truncate text-sm font-semibold text-surface-900 dark:text-white">{settings.name}</span>}
      </div>
      <div className="px-2 pb-1">
        <button
          type="button"
          onClick={() => emitShellEvent("search.open")}
          title={collapsed ? t("topbar.search") : undefined}
          className={cn("flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800", collapsed && "justify-center px-0")}
        >
          <Search className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">{t("topbar.search")}</span>
              <Kbd>⌘K</Kbd>
            </>
          )}
        </button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <Section collapsed={collapsed}>
          {bySection("main").map((i) => (
            <FeatureNav key={i.id} item={i} collapsed={collapsed} />
          ))}
        </Section>
        <Section title={t("nav.objects")} collapsed={collapsed}>
          {objects.map((o) => (
            <NavEntry key={o.id} to={paths.objectList(o.id)} icon={<ObjectIcon name={o.icon} color={o.color} tile />} label={o.labelPlural} collapsed={collapsed} />
          ))}
        </Section>
        {bySection("workspace").length > 0 && (
          <Section title={t("nav.workspace")} collapsed={collapsed}>
            {bySection("workspace").map((i) => (
              <FeatureNav key={i.id} item={i} collapsed={collapsed} />
            ))}
          </Section>
        )}
      </nav>
      <div className="border-t border-surface-200 px-2 py-2 dark:border-surface-800">
        {bySection("bottom").map((i) => (
          <FeatureNav key={i.id} item={i} collapsed={collapsed} />
        ))}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className={cn("mt-px flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800", collapsed && "justify-center px-0")}
          title={collapsed ? t("nav.expand") : t("nav.collapse")}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          {!collapsed && <span>{t("nav.collapse")}</span>}
        </button>
      </div>
    </aside>
  );
}

export function TopBar() {
  const { t, i18n } = useTranslation();
  const { theme, toggle } = useTheme();
  const auth = useAuth();
  const topBarSlots = getSlot("topBar");
  const locale = activeLocale();
  void i18n.language;
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-surface-200 bg-white px-4 dark:border-surface-800 dark:bg-surface-950">
      <button
        type="button"
        onClick={() => emitShellEvent("search.open")}
        className="flex h-8 w-full max-w-sm items-center gap-2 rounded-md border border-surface-200 bg-surface-50 px-2.5 text-sm text-surface-400 hover:border-surface-300 dark:border-surface-800 dark:bg-surface-900 dark:hover:border-surface-700"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">{t("topbar.search")}</span>
        <Kbd>⌘K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        {topBarSlots.map((C, i) => (
          <C key={i} />
        ))}
        <IconButton label={theme === "dark" ? t("topbar.lightMode") : t("topbar.darkMode")} icon={theme === "dark" ? <Sun /> : <Moon />} onClick={toggle} />
        <Dropdown
          align="end"
          trigger={({ ref, onClick }) => <IconButton ref={ref as never} label={t("topbar.language")} icon={<Languages />} onClick={onClick} />}
          items={SUPPORTED_LOCALES.map((l) => ({ id: l, label: LOCALE_LABELS[l], checked: l === locale, onSelect: () => void setActiveLocale(l) }))}
        />
        <Dropdown
          align="end"
          header={
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-surface-900 dark:text-white">{auth.user.name}</div>
              <div className="truncate text-xs text-surface-500">{auth.user.email}</div>
              <div className="mt-0.5 text-2xs text-surface-400">{t("topbar.role", { role: t(`roles.${auth.role}`) })}</div>
            </div>
          }
          trigger={({ ref, onClick }) => (
            <button ref={ref as never} type="button" onClick={onClick} aria-label={t("topbar.userMenu")} className="ml-1 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60">
              <Avatar name={auth.user.name} src={auth.user.avatarUrl} size="md" />
            </button>
          )}
          items={[
            { id: "settings", label: t("nav.settings"), onSelect: () => (window.location.hash = `#${paths.settings()}`) },
            ...(auth.canSignOut ? [{ id: "signout", label: t("topbar.signOut"), icon: <LogOut />, separator: true, onSelect: () => void auth.signOut() }] : []),
          ]}
        />
      </div>
    </header>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  // Cmd/Ctrl+K opens whatever the search feature registered.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        emitShellEvent("search.open");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="flex h-screen w-full overflow-hidden bg-white text-surface-900 dark:bg-surface-950 dark:text-surface-100">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main key={location.pathname.split("/").slice(0, 3).join("/")} className="min-h-0 flex-1 overflow-auto">
          {children}
        </main>
      </div>
      {getSlot("globalOverlays").map((C, i) => (
        <C key={i} />
      ))}
    </div>
  );
}

