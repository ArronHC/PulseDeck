// 页面数据预取登记：插件与插件市场（写法见 ./admin.ts 与 @/lib/routeData）
import { getRPC2Client } from "@/contexts/RPC2Context";
import { prefetchRouteQuery, routeQuery, type RouteQuery } from "@/lib/routeData";
import { registerRouteData } from "@/lib/routeRegistry";
import { fetchMarketCatalog, fetchMarketSources } from "@/pages/admin/market/shared/request";
import type { MarketKind, MarketSource, MarketSourceStatus } from "@/pages/admin/market/shared/types";
import type { MarketPlugin } from "@/pages/admin/market/plugins/types";
import type { PluginConfiguration, PluginInfo } from "@/types/plugin";

// ---------------------------------------------------------------------------
// 插件（RPC，经 RPC2Provider 同一个单例）
// ---------------------------------------------------------------------------

const rpcCall = <TResult>(method: string, params?: unknown) =>
  getRPC2Client().call<unknown, TResult>(method, params);

/** 已安装插件列表；非数组结果当作空列表 */
export const fetchPluginList = async () => {
  const result = await rpcCall<PluginInfo[]>("admin:listPlugins");
  return Array.isArray(result) ? result : [];
};

export const pluginsQuery = routeQuery("appearance/plugins", fetchPluginList);

export interface PluginConfigurationResponse {
  configuration?: PluginConfiguration;
  data?: Record<string, any>;
}

/**
 * 某个插件的配置项与已保存的值。attempt 区分「同一插件再次点击」：
 * 页面每次点选都换一个 key，保证重新请求（不复用同一次导航里取过的旧值）。
 */
export const pluginConfigurationQuery = (short: string, attempt = 0) =>
  routeQuery(`appearance/plugin-config/${short}/${attempt}`, () =>
    rpcCall<PluginConfigurationResponse>("admin:getPluginConfiguration", { short }),
  );

registerRouteData("/admin/plugins", () => prefetchRouteQuery(pluginsQuery));
registerRouteData("/admin/plugins/config", (_params, search) => {
  prefetchRouteQuery(pluginsQuery);
  const short = search.get("short");
  if (short) prefetchRouteQuery(pluginConfigurationQuery(short));
});

// ---------------------------------------------------------------------------
// 插件市场
// ---------------------------------------------------------------------------

const marketSourceQueries = {} as Record<MarketKind, RouteQuery<MarketSource[]>>;

/** 市场源列表（每种市场一个固定的 query 对象，页面每次渲染拿到同一个引用） */
export const marketSourcesQuery = (kind: MarketKind) =>
  (marketSourceQueries[kind] ??= routeQuery(`appearance/market-sources/${kind}`, async () => {
    const payload = await fetchMarketSources<MarketSource[]>(kind);
    return payload.data || [];
  }));

export interface PluginMarketData {
  plugins: MarketPlugin[];
  sources: MarketSourceStatus[];
  currentVersion: string;
  installed: PluginInfo[];
}

/** 插件市场：目录 + 已安装插件（失败当作空）+ 面板版本（失败整体失败） */
export async function fetchPluginMarket(force = false): Promise<PluginMarketData> {
  const [catalogPayload, installedResult, versionInfo] = await Promise.all([
    fetchMarketCatalog<{ plugins: MarketPlugin[]; sources: MarketSourceStatus[] }>("plugin", force),
    rpcCall<PluginInfo[]>("admin:listPlugins").catch(() => []),
    rpcCall<{ version: string }>("common:getVersion"),
  ]);
  return {
    plugins: catalogPayload.data?.plugins || [],
    sources: catalogPayload.data?.sources || [],
    currentVersion: versionInfo.version,
    installed: Array.isArray(installedResult) ? installedResult : [],
  };
}

export const pluginMarketQuery = routeQuery("appearance/market-plugins", () => fetchPluginMarket());

const preloadPluginMarket = () => {
  prefetchRouteQuery(pluginMarketQuery);
  prefetchRouteQuery(marketSourcesQuery("plugin"));
};

registerRouteData("/admin/market/plugins", preloadPluginMarket);
registerRouteData("/admin/plugins/market", preloadPluginMarket);
