import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ExternalLink,
  Palette,
  RefreshCw,
  SlidersHorizontal,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import { fetchInstalledThemes, setThemeActive } from "@/pages/admin/themes/api";
import type { Theme } from "@/pages/admin/themes/types";
import { resolveI18nText } from "@/utils/i18nText";
import { useTranslation } from "react-i18next";

export const ProbeThemeToolbarInner: React.FC<{
  compact?: boolean;
  onReloadFrame?: () => void;
}> = ({ compact = false, onReloadFrame }) => {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const { account } = useAccount();
  const { publicInfo, refresh: refreshPublicInfo } = usePublicInfo();
  const isAdmin = Boolean(account?.logged_in);

  const activeTheme = publicInfo?.theme || "default";
  const isCustomTheme = activeTheme !== "default";

  const [themes, setThemes] = useState<Theme[]>([]);
  const [switching, setSwitching] = useState(false);

  const loadThemes = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const list = await fetchInstalledThemes();
      setThemes(Array.isArray(list) ? list : []);
    } catch {
      // ignore non-critical list error on public view
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadThemes();
  }, [loadThemes, activeTheme]);

  const handleThemeChange = async (nextShort: string) => {
    if (!nextShort || nextShort === activeTheme) return;
    setSwitching(true);
    try {
      await setThemeActive(nextShort);
      await refreshPublicInfo();
      onReloadFrame?.();
      toast.success(
        nextShort === "default"
          ? "已切回默认探针视图"
          : `已切换探针主题为 ${nextShort}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "切换主题失败");
    } finally {
      setSwitching(false);
    }
  };

  if (!isAdmin && !isCustomTheme) {
    return null;
  }

  const activeMeta = themes.find((t) => t.short === activeTheme);
  const activeDisplayName =
    activeTheme === "default"
      ? "默认主题 (Hub)"
      : activeMeta
        ? resolveI18nText(activeMeta.name, i18n.language) || activeTheme
        : activeTheme;

  if (compact) {
    // Inline controls shown on the right side of the default Tab 2 header (admins only)
    if (!isAdmin) return null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        {themes.length > 1 && (
          <label className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2.5 text-xs text-[var(--hub-muted)]">
            <Palette className="h-3.5 w-3.5 shrink-0 text-[var(--hub-ink)]" />
            <select
              aria-label="切换探针主题"
              value={activeTheme}
              disabled={switching}
              onChange={(e) => void handleThemeChange(e.target.value)}
              className="bg-transparent text-xs font-medium text-[var(--hub-ink)] focus:outline-none disabled:opacity-60"
            >
              {themes.map((th) => (
                <option key={th.short} value={th.short}>
                  {th.short === "default"
                    ? "默认主题 (Hub)"
                    : resolveI18nText(th.name, i18n.language) || th.short}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          onClick={() => navigate("/admin/market/themes")}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-ink)] transition-colors hover:bg-[var(--hub-canvas)]"
        >
          <Store className="h-3.5 w-3.5" />
          <span>主题商城</span>
        </button>
      </div>
    );
  }

  // Full slim toolbar rendered above an active third-party Komari Market theme
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--hub-border)] bg-[var(--hub-surface)] px-4 py-2 sm:px-6">
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2.5 py-0.5 font-medium text-[var(--hub-ink)]">
          <Palette className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          <span>探针主题：{activeDisplayName}</span>
        </span>
        {onReloadFrame && (
          <button
            type="button"
            onClick={onReloadFrame}
            title="刷新主题视图"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2 text-xs text-[var(--hub-muted)] transition-colors hover:text-[var(--hub-ink)]"
          >
            <RefreshCw className="h-3 w-3" />
            <span className="hidden sm:inline">刷新</span>
          </button>
        )}
        <a
          href={`/probe-theme/?theme=${encodeURIComponent(activeTheme)}`}
          target="_blank"
          rel="noopener noreferrer"
          title="新标签页打开完整主题"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2 text-xs text-[var(--hub-muted)] transition-colors hover:text-[var(--hub-ink)]"
        >
          <ExternalLink className="h-3 w-3" />
          <span className="hidden sm:inline">独立窗口</span>
        </a>
      </div>

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2 text-xs text-[var(--hub-muted)]">
            <select
              aria-label="切换探针主题"
              value={activeTheme}
              disabled={switching}
              onChange={(e) => void handleThemeChange(e.target.value)}
              className="bg-transparent text-xs font-medium text-[var(--hub-ink)] focus:outline-none disabled:opacity-60"
            >
              <option value="default">默认主题 (Hub)</option>
              {themes
                .filter((th) => th.short !== "default")
                .map((th) => (
                  <option key={th.short} value={th.short}>
                    {resolveI18nText(th.name, i18n.language) || th.short}
                  </option>
                ))}
              {!themes.some((th) => th.short === activeTheme) && (
                <option value={activeTheme}>{activeTheme}</option>
              )}
            </select>
          </label>

          <button
            type="button"
            onClick={() => navigate("/admin/theme_managed")}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2.5 text-xs font-medium text-[var(--hub-ink)] transition-colors hover:bg-[var(--hub-canvas)]"
          >
            <SlidersHorizontal className="h-3 w-3" />
            <span>主题配置</span>
          </button>

          <button
            type="button"
            onClick={() => navigate("/admin/market/themes")}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2.5 text-xs font-medium text-[var(--hub-ink)] transition-colors hover:bg-[var(--hub-canvas)]"
          >
            <Store className="h-3 w-3" />
            <span>主题商城</span>
          </button>
        </div>
      )}
    </div>
  );
};

export const ProbeThemeToolbar: React.FC<{
  compact?: boolean;
  onReloadFrame?: () => void;
}> = (props) => (
  <AccountProvider>
    <ProbeThemeToolbarInner {...props} />
  </AccountProvider>
);

export const ProbeThemeSandboxView: React.FC<{ themeShort: string }> = ({
  themeShort,
}) => {
  const [reloadKey, setReloadKey] = useState(0);
  const src = `/probe-theme/?theme=${encodeURIComponent(themeShort)}&v=${reloadKey}`;

  return (
    <div className="flex flex-col w-full">
      <ProbeThemeToolbar
        compact={false}
        onReloadFrame={() => setReloadKey((k) => k + 1)}
      />
      <iframe
        key={`${themeShort}-${reloadKey}`}
        src={src}
        title={`Komari Theme: ${themeShort}`}
        className="w-full border-0 bg-[var(--hub-canvas)]"
        style={{ height: "calc(100vh - 144px)", minHeight: "680px" }}
      />
    </div>
  );
};
