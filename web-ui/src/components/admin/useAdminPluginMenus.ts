import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRPC2Call } from "@/contexts/RPC2Context";
import { resolveI18nText } from "@/utils/i18nText";
import { resolvePluginIcon } from "@/utils/iconHelper";
import type { PluginInfo } from "@/types/plugin";
import { normalizeThemeRedirectTarget } from "@/utils/themeConfiguration";

export interface PluginNavItem {
  label: string;
  path: string;
  icon: string;
  reloadDocument?: boolean;
}

export function useAdminPluginMenus(refreshVersion: number) {
  const { call } = useRPC2Call();
  const { i18n } = useTranslation();
  const [pluginMenuItems, setPluginMenuItems] = useState<PluginNavItem[]>([]);

  const currentLanguage =
    i18n.resolvedLanguage ||
    i18n.language ||
    (typeof navigator !== "undefined" ? navigator.language : "");

  useEffect(() => {
    let ignore = false;

    async function loadPluginMenu() {
      try {
        const result = await call<unknown, PluginInfo[]>("admin:listPlugins");
        if (ignore || !Array.isArray(result)) return;

        const pluginIconUrl = (plugin: PluginInfo, icon?: string) =>
          resolvePluginIcon(plugin.short, icon) || "Blocks";

        const items: PluginNavItem[] = [];
        for (const plugin of result) {
          if (!plugin.enabled) continue;
          for (const page of plugin.pages || []) {
            if (page.visibility === "public") continue;
            const label =
              resolveI18nText(page.title, currentLanguage) ||
              resolveI18nText(plugin.name, currentLanguage) ||
              plugin.short;
            const pageType = page.type || "iframe";
            if (pageType === "redirect") {
              const target = normalizeThemeRedirectTarget(page.url);
              if (!target) continue;
              items.push({
                label,
                path: target,
                icon: pluginIconUrl(plugin, page.icon),
                reloadDocument: true,
              });
              continue;
            }
            items.push({
              label,
              path: `/admin/plugin-page?short=${encodeURIComponent(plugin.short)}&file=${encodeURIComponent(page.file || "")}`,
              icon: pluginIconUrl(plugin, page.icon),
            });
          }
        }
        if (!ignore) setPluginMenuItems(items);
      } catch (e) {
        console.warn("加载插件菜单失败:", e);
        if (!ignore) setPluginMenuItems([]);
      }
    }

    void loadPluginMenu();
    return () => {
      ignore = true;
    };
  }, [call, currentLanguage, refreshVersion]);

  return pluginMenuItems;
}
