import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Globe,
  LayoutGrid,
  LogIn,
  Moon,
  Search,
  Server,
  Settings,
  Sun,
} from "lucide-react";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";
import { ThemeContext } from "@/contexts/ThemeContext";
import { useSystemTheme } from "@/hooks/useSystemTheme";
import { fetchOverview } from "@/lib/hubApi";
import { loginPath } from "@/utils/loginRedirect";
import type { HealthStatus } from "@/types/hub";
import { HealthPill } from "./HubUi";
import { PulseLogoMark } from "./PulseLogoMark";
import { CommandSearchDialog } from "./CommandSearchDialog";
import LanguageSwitch from "@/components/Language";

interface NavTab {
  key: string;
  labelKey: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  match: (pathname: string) => boolean;
}

const NAV_TABS: NavTab[] = [
  {
    key: "overview",
    labelKey: "pulse.nav.overview",
    to: "/",
    icon: LayoutGrid,
    match: (p) => p === "/",
  },
  {
    key: "servers",
    labelKey: "pulse.nav.servers",
    to: "/servers",
    icon: Server,
    match: (p) => p.startsWith("/servers") || p.startsWith("/instance/"),
  },
  {
    key: "uptime",
    labelKey: "pulse.nav.uptime",
    to: "/uptime",
    icon: Activity,
    match: (p) => p.startsWith("/uptime"),
  },
  {
    key: "subscriptions",
    labelKey: "pulse.nav.subscriptions",
    to: "/subscriptions",
    icon: Globe,
    match: (p) => p.startsWith("/subscriptions"),
  },
  {
    key: "admin",
    labelKey: "pulse.nav.admin",
    to: "/admin/overview",
    icon: Settings,
    match: (p) => p.startsWith("/admin"),
  },
];

const TopHeaderInner: React.FC = () => {
  const { t } = useTranslation();
  const { publicInfo } = usePublicInfo();
  const { account } = useAccount();
  const { appearance, setAppearance } = useContext(ThemeContext);
  const resolvedAppearance = useSystemTheme(appearance);
  const isDark = resolvedAppearance === "dark";

  const location = useLocation();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatus>("operational");
  const [activeAlerts, setActiveAlerts] = useState(0);

  useEffect(() => {
    let active = true;
    const loadHealth = () => {
      fetchOverview(24)
        .then((res) => {
          if (!active || !res) return;
          setHealthStatus(res.health_status ?? "operational");
          setActiveAlerts(res.active_alerts ?? 0);
        })
        .catch(() => {
          // Overview endpoint may not be populated yet; keep neutral operational state
        });
    };
    loadHealth();
    const timer = window.setInterval(loadHealth, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const loginRedirect = useMemo(
    () => loginPath(location.pathname, location.search),
    [location.pathname, location.search],
  );

  const siteName = publicInfo?.sitename || "PulseDeck";

  return (
    <>
      <header className="sticky top-0 z-30 w-full bg-[var(--hub-surface)]/95 backdrop-blur-md">
        {/* Tier 1: Brand + Global Health Pill (left), Search + Theme + Auth (right) */}
        <div className="border-b border-[var(--hub-border)]">
          <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                to="/"
                className="flex min-w-0 items-center gap-2.5 text-[var(--hub-ink)] no-underline"
              >
                <PulseLogoMark className="h-7 w-7 shrink-0" />
                <span className="truncate text-[15px] font-semibold tracking-tight">
                  {siteName}
                </span>
              </Link>

              <div className="hidden sm:flex items-center">
                <span className="mx-1 text-[var(--hub-border)]">/</span>
                <HealthPill
                  status={healthStatus}
                  alerts={activeAlerts}
                  onClick={() => navigate("/uptime")}
                />
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="flex h-8 items-center gap-2 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2.5 text-xs text-[var(--hub-muted)] transition-colors hover:border-zinc-300 hover:text-[var(--hub-ink)] dark:hover:border-zinc-700"
                title={t("pulse.nav.searchShortcut")}
              >
                <Search className="h-3.5 w-3.5" />
                <span className="hidden md:inline">{t("pulse.nav.searchPlaceholder")}</span>
                <kbd className="hidden sm:inline-flex items-center rounded border border-[var(--hub-border)] bg-[var(--hub-surface)] px-1.5 py-0.5 font-mono text-[10px] leading-none">
                  ⌘K
                </kbd>
              </button>

              <button
                type="button"
                onClick={() => setAppearance(isDark ? "light" : "dark")}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] text-[var(--hub-muted)] transition-colors hover:bg-[var(--hub-canvas)] hover:text-[var(--hub-ink)]"
                title={isDark ? t("pulse.nav.switchToLight") : t("pulse.nav.switchToDark")}
                aria-label={t("pulse.nav.toggleTheme")}
              >
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>

              <div className="hidden sm:flex items-center">
                <LanguageSwitch />
              </div>

              <button
                type="button"
                onClick={() => {
                  if (account?.logged_in) {
                    navigate("/admin/overview");
                  } else {
                    navigate(loginRedirect);
                  }
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2.5 text-xs font-medium text-[var(--hub-ink)] transition-colors hover:bg-[var(--hub-canvas)]"
              >
                {account?.logged_in ? (
                  <>
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
                      {(account.username || "A").slice(0, 1).toUpperCase()}
                    </span>
                    <span className="hidden sm:inline max-w-[96px] truncate">
                      {account.username || t("pulse.nav.console")}
                    </span>
                  </>
                ) : (
                  <>
                    <LogIn className="h-3.5 w-3.5 text-[var(--hub-muted)]" />
                    <span>{t("pulse.nav.login")}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Tier 2: Horizontal Underline Tabs (Laravel Cloud Pattern, NO Left Sidebar) */}
        <div className="border-b border-[var(--hub-border)]">
          <div className="mx-auto flex h-11 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <nav
              aria-label={t("pulse.nav.mainNavLabel")}
              className="hub-no-scrollbar flex h-full items-center gap-5 overflow-x-auto"
            >
              {NAV_TABS.filter(
                (tab) => tab.key !== "admin" || Boolean(account?.logged_in),
              ).map((tab) => {
                const active = tab.match(location.pathname);
                const Icon = tab.icon;
                return (
                  <Link
                    key={tab.key}
                    to={tab.to}
                    className={`relative flex h-full shrink-0 items-center gap-1.5 text-[13px] font-medium no-underline transition-colors ${
                      active
                        ? "text-[var(--hub-ink)]"
                        : "text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{t(tab.labelKey)}</span>
                    {active && (
                      <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-[var(--hub-ink)]" />
                    )}
                  </Link>
                );
              })}
            </nav>

            <div className="sm:hidden shrink-0">
              <HealthPill
                compact
                status={healthStatus}
                alerts={activeAlerts}
                onClick={() => navigate("/uptime")}
              />
            </div>
          </div>
        </div>
      </header>

      <CommandSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
};

export const TopHeaderShell: React.FC = () => (
  <AccountProvider>
    <TopHeaderInner />
  </AccountProvider>
);

export default TopHeaderShell;
