import React, { useContext, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  Bell,
  Compass,
  ExternalLink,
  FileText,
  Globe,
  Info,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Radio,
  Server,
  Settings,
  ShieldCheck,
  Sun,
  TerminalSquare,
  Users,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { useAccount } from "@/contexts/AccountContext";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import { ThemeContext } from "@/contexts/ThemeContext";
import { useSystemTheme } from "@/hooks/useSystemTheme";
import { SURFACE_MOTION } from "@/lib/motion";
import { RevealBoundary } from "@/components/motion/reveal";
import { PulseLogoMark } from "@/components/hub/PulseLogoMark";
import LanguageSwitch from "@/components/Language";

interface NavItem {
  key: string;
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  match?: (pathname: string) => boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NOTIFICATION_TABS = [
  { label: "通知渠道", to: "/admin/notification/channels" },
  { label: "离线告警", to: "/admin/notification/offline" },
  { label: "通用告警", to: "/admin/notification/general" },
];

export const PULSE_ONBOARDING_EVENT = "pulsedeck:open-onboarding";

const STATIC_SECTIONS: NavSection[] = [
  {
    title: "总览",
    items: [
      {
        key: "overview",
        label: "控制台概览",
        to: "/admin/overview",
        icon: LayoutDashboard,
        match: (p) => p === "/admin/overview" || p === "/admin",
      },
    ],
  },
  {
    title: "资产与服务",
    items: [
      {
        key: "servers",
        label: "服务器探针",
        to: "/admin/servers",
        icon: Server,
        match: (p) => p.startsWith("/admin/servers"),
      },
      {
        key: "uptime",
        label: "服务状态监控",
        to: "/admin/uptime",
        icon: Activity,
        match: (p) => p.startsWith("/admin/uptime"),
      },
      {
        key: "subscriptions",
        label: "订阅与节点",
        to: "/admin/subscriptions",
        icon: Globe,
        match: (p) => p.startsWith("/admin/subscriptions"),
      },
    ],
  },
  {
    title: "运维与告警",
    items: [
      {
        key: "ping",
        label: "延迟监测 (Ping)",
        to: "/admin/ping",
        icon: Radio,
        match: (p) => p.startsWith("/admin/ping"),
      },
      {
        key: "exec",
        label: "远程执行",
        to: "/admin/exec",
        icon: TerminalSquare,
        match: (p) => p.startsWith("/admin/exec"),
      },
      {
        key: "notification",
        label: "通知与告警",
        to: "/admin/notification/channels",
        icon: Bell,
        match: (p) => p.startsWith("/admin/notification"),
      },
      {
        key: "logs",
        label: "审计日志",
        to: "/admin/logs",
        icon: FileText,
        match: (p) => p.startsWith("/admin/logs"),
      },
    ],
  },
  {
    title: "系统",
    items: [
      {
        key: "settings",
        label: "系统设置",
        to: "/admin/settings/site",
        icon: Settings,
        match: (p) => p.startsWith("/admin/settings"),
      },
      {
        key: "account",
        label: "账户与安全",
        to: "/admin/account",
        icon: ShieldCheck,
        match: (p) => p.startsWith("/admin/account"),
      },
      {
        key: "sessions",
        label: "登录会话",
        to: "/admin/sessions",
        icon: Users,
        match: (p) => p.startsWith("/admin/sessions"),
      },
      {
        key: "about",
        label: "关于",
        to: "/admin/about",
        icon: Info,
        match: (p) => p.startsWith("/admin/about"),
      },
    ],
  },
];

const contentSectionKey = (pathname: string) => {
  if (pathname.startsWith("/admin/settings/")) return "/admin/settings/";
  if (pathname.startsWith("/admin/notification/")) return "/admin/notification/";
  return pathname;
};

export default function PulseAdminShell({ content }: { content: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { account } = useAccount();
  const { publicInfo } = usePublicInfo();
  const { appearance, setAppearance } = useContext(ThemeContext);
  const resolvedAppearance = useSystemTheme(appearance);
  const isDark = resolvedAppearance === "dark";

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, location.search]);

  const isNotificationPage = location.pathname.startsWith("/admin/notification/");
  const isHttps = window.location.protocol === "https:";
  const siteName = publicInfo?.sitename || "PulseDeck";

  const openOnboardingGuide = () => {
    if (location.pathname !== "/admin/overview") {
      navigate("/admin/overview?guide=1");
    } else {
      window.dispatchEvent(new CustomEvent(PULSE_ONBOARDING_EVENT));
    }
  };

  const renderSidebarContent = () => (
    <nav aria-label="控制台导航" className="space-y-5 px-3 py-4">
      {STATIC_SECTIONS.map((section) => (
        <div key={section.title}>
          <div className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-[var(--hub-muted)] uppercase">
            {section.title}
          </div>
          <div className="space-y-0.5">
            {section.items.map((item) => {
              const active = item.match
                ? item.match(location.pathname)
                : location.pathname === item.to;
              const Icon = item.icon;
              const cls = `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium no-underline transition-colors ${
                active
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-[var(--hub-muted)] hover:bg-[var(--hub-canvas)] hover:text-[var(--hub-ink)]"
              }`;

              return (
                <Link key={item.key} to={item.to} className={cls}>
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--hub-canvas)] text-[var(--hub-ink)]">
      {/* Top Header */}
      <header className="z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--hub-border)] bg-[var(--hub-surface)] px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--hub-border)] text-[var(--hub-muted)] hover:text-[var(--hub-ink)] lg:hidden"
            aria-label="切换菜单"
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>

          <Link
            to="/admin/overview"
            className="flex min-w-0 items-center gap-2.5 text-[var(--hub-ink)] no-underline"
          >
            <PulseLogoMark className="h-7 w-7 shrink-0" />
            <span className="truncate text-sm font-semibold tracking-tight">
              {siteName}
            </span>
          </Link>

          <span className="rounded-md border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2 py-0.5 text-[11px] font-medium text-[var(--hub-muted)]">
            控制台
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={openOnboardingGuide}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2.5 text-xs font-medium text-[var(--hub-ink)] transition-colors hover:border-zinc-300 dark:hover:border-zinc-700"
          >
            <Compass className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <span className="hidden sm:inline">新手引导</span>
          </button>

          <Link
            to="/"
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2.5 text-xs font-medium text-[var(--hub-ink)] no-underline transition-colors hover:bg-[var(--hub-canvas)]"
          >
            <span className="hidden sm:inline">返回前台</span>
            <span className="sm:hidden">前台</span>
            <ExternalLink className="h-3 w-3 text-[var(--hub-muted)]" />
          </Link>

          <button
            type="button"
            onClick={() => setAppearance(isDark ? "light" : "dark")}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] text-[var(--hub-muted)] transition-colors hover:bg-[var(--hub-canvas)] hover:text-[var(--hub-ink)]"
            title={isDark ? "切换到亮色模式" : "切换到暗色模式"}
            aria-label="Toggle theme"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <div className="hidden sm:flex items-center">
            <LanguageSwitch />
          </div>

          <div className="flex items-center gap-1.5 border-l border-[var(--hub-border)] pl-2">
            <div className="hidden md:flex items-center gap-1.5 rounded-lg bg-[var(--hub-canvas)] px-2 py-1 text-xs">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
                {(account?.username || "A").slice(0, 1).toUpperCase()}
              </span>
              <span className="max-w-[90px] truncate font-medium">
                {account?.username || "Admin"}
              </span>
            </div>

            <button
              type="button"
              onClick={() => window.open("/api/logout", "_self")}
              title="退出登录"
              aria-label="退出登录"
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2 text-xs text-[var(--hub-muted)] transition-colors hover:border-rose-300 hover:text-rose-600 dark:hover:border-rose-900 dark:hover:text-rose-400"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Two-Region Body */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Desktop Sidebar */}
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-[var(--hub-border)] bg-[var(--hub-surface)] lg:block">
          {renderSidebarContent()}
        </aside>

        {/* Mobile Drawer Sidebar */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 top-14 z-40 flex bg-black/40 backdrop-blur-[1px] lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          >
            <aside
              className="h-full w-64 overflow-y-auto border-r border-[var(--hub-border)] bg-[var(--hub-surface)] shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {renderSidebarContent()}
            </aside>
          </div>
        )}

        {/* Main Content */}
        <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-[1320px]">
            {!isHttps && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200">
                当前未通过 HTTPS 访问控制台，建议在生产环境启用 TLS 反向代理以保护管理员凭证与 Agent 通信。
              </div>
            )}

            {isNotificationPage && (
              <div className="mb-5 flex flex-wrap items-center gap-1.5 border-b border-[var(--hub-border)] pb-3">
                {NOTIFICATION_TABS.map((tab) => {
                  const active = location.pathname === tab.to;
                  return (
                    <Link
                      key={tab.to}
                      to={tab.to}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium no-underline transition-colors ${
                        active
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "border border-[var(--hub-border)] bg-[var(--hub-surface)] text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
                      }`}
                    >
                      {tab.label}
                    </Link>
                  );
                })}
              </div>
            )}

            <motion.div
              key={contentSectionKey(location.pathname)}
              initial={SURFACE_MOTION.route.initial}
              animate={SURFACE_MOTION.route.animate}
              transition={SURFACE_MOTION.route.transition}
            >
              <RevealBoundary>{content}</RevealBoundary>
            </motion.div>
          </div>
        </main>
      </div>
    </div>
  );
}
