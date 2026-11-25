import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Gauge,
  Globe,
  Info,
  LogIn,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";
import {
  checkIPPureNow,
  createSubscription,
  deleteSubscription,
  fetchIPPureSelf,
  fetchSubscriptionMap,
  fetchSubscriptionNodes,
  fetchSubscriptions,
  formatExpiryCountdown,
  formatLatency,
  formatRelativeTime,
  getFraudTier,
  getLatencyBadgeClass,
  patchSubscriptionNode,
  refreshSubscription,
  testSubscriptionPurity,
  testSubscriptionSpeed,
} from "@/lib/hubApi";
import type {
  IPPureInfo,
  SubscriptionItem,
  SubscriptionMapData,
  SubscriptionNode,
} from "@/types/hub";
import { formatBytes } from "@/utils/unitHelper";
import { countryCodeToFlagEmoji } from "@/utils/regionCode";
import { HubCard, HubEmptyState } from "@/components/hub/HubUi";
import { WorldMapCard, type MapMode } from "@/components/hub/WorldMapCard";
import { toast } from "sonner";
import { loginPath } from "@/utils/loginRedirect";

const SubscriptionsPageInner: React.FC = () => {
  const { account } = useAccount();
  const isAdmin = Boolean(account?.logged_in);
  const [searchParams, setSearchParams] = useSearchParams();

  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [nodes, setNodes] = useState<SubscriptionNode[]>([]);
  const [mapData, setMapData] = useState<SubscriptionMapData>({
    countries: [],
    markers: [],
  });
  const [ippureSelf, setIppureSelf] = useState<IPPureInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [busyGlobal, setBusyGlobal] = useState<string | null>(null);
  const [busyNodeId, setBusyNodeId] = useState<number | null>(null);

  // Map & Table filters
  const [mapMode, setMapMode] = useState<MapMode>("latency");
  const [selectedCountry, setSelectedCountry] = useState<string>(
    searchParams.get("country") || "",
  );
  const [selectedSubId, setSelectedSubId] = useState<string>("all");
  const [selectedProtocol, setSelectedProtocol] = useState<string>("all");
  const [onlyAvailable, setOnlyAvailable] = useState<boolean>(false);
  const [searchText, setSearchText] = useState<string>(
    searchParams.get("search") || "",
  );

  // IPPure instant check bar
  const [purityBarOpen, setPurityBarOpen] = useState<boolean>(true);
  const [proxyCheckUrl, setProxyCheckUrl] = useState<string>("");
  const [checkingSelfPurity, setCheckingSelfPurity] = useState<boolean>(false);
  const [liveCheckResult, setLiveCheckResult] = useState<IPPureInfo | null>(null);

  // Purity popover
  const [inspectedNode, setInspectedNode] = useState<SubscriptionNode | null>(null);

  // Add Subscription / Raw Nodes Modal
  const [addModalOpen, setAddModalOpen] = useState<boolean>(false);
  const [addMode, setAddMode] = useState<"url" | "manual">("url");
  const [subForm, setSubForm] = useState({
    name: "",
    url: "",
    raw_content: "",
    auto_update_hours: 12,
  });
  const [savingSub, setSavingSub] = useState<boolean>(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [subsRes, nodesRes, mapRes, selfRes] = await Promise.all([
        fetchSubscriptions().catch(() => []),
        fetchSubscriptionNodes().catch(() => []),
        fetchSubscriptionMap().catch(() => ({ countries: [], markers: [] })),
        fetchIPPureSelf().catch(() => null),
      ]);
      setSubscriptions(Array.isArray(subsRes) ? subsRes : []);
      setNodes(Array.isArray(nodesRes) ? nodesRes : []);
      setMapData(mapRes || { countries: [], markers: [] });
      setIppureSelf(selfRes);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSelectCountry = (code: string) => {
    setSelectedCountry(code);
    const next = new URLSearchParams(searchParams);
    if (code) next.set("country", code);
    else next.delete("country");
    setSearchParams(next, { replace: true });
  };

  const protocols = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) {
      if (n.protocol) set.add(n.protocol.toLowerCase());
    }
    return Array.from(set).sort();
  }, [nodes]);

  const filteredNodes = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return nodes.filter((n) => {
      if (selectedSubId !== "all" && String(n.subscription_id) !== selectedSubId) {
        return false;
      }
      if (
        selectedCountry &&
        (n.country_code || "").toUpperCase() !== selectedCountry.toUpperCase()
      ) {
        return false;
      }
      if (
        selectedProtocol !== "all" &&
        (n.protocol || "").toLowerCase() !== selectedProtocol
      ) {
        return false;
      }
      if (onlyAvailable && (!n.enabled || n.latency_ms < 0)) {
        return false;
      }
      if (q) {
        const hay = `${n.name} ${n.host} ${n.city} ${n.country_name} ${n.country_code} ${n.protocol} ${n.subscription_name} ${n.ippure?.ip || ""} ${n.ippure?.as_organization || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    nodes,
    selectedSubId,
    selectedCountry,
    selectedProtocol,
    onlyAvailable,
    searchText,
  ]);

  const sortedCountries = useMemo(
    () =>
      [...(mapData.countries ?? [])].sort((a, b) => b.node_count - a.node_count),
    [mapData.countries],
  );

  const maxCountryCount = useMemo(
    () => Math.max(1, ...sortedCountries.map((c) => c.node_count)),
    [sortedCountries],
  );

  const handleCreateSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subForm.name.trim()) {
      toast.error("请输入订阅或分组名称");
      return;
    }
    if (addMode === "url" && !subForm.url.trim()) {
      toast.error("请输入订阅链接 URL");
      return;
    }
    if (addMode === "manual" && !subForm.raw_content.trim()) {
      toast.error("请粘贴节点链接 (每行一条)");
      return;
    }
    setSavingSub(true);
    try {
      await createSubscription({
        name: subForm.name.trim(),
        url: addMode === "url" ? subForm.url.trim() : undefined,
        raw_content: addMode === "manual" ? subForm.raw_content.trim() : undefined,
        auto_update_hours: subForm.auto_update_hours,
      });
      toast.success("已添加订阅并解析节点");
      setAddModalOpen(false);
      setSubForm({ name: "", url: "", raw_content: "", auto_update_hours: 12 });
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加失败");
    } finally {
      setSavingSub(false);
    }
  };

  const handleRefreshAll = async () => {
    setBusyGlobal("refresh");
    try {
      const urlSubs = subscriptions.filter((s) => s.source_type === "url" && s.enabled);
      await Promise.all(urlSubs.map((s) => refreshSubscription(s.id)));
      toast.success(`已刷新 ${urlSubs.length} 个订阅`);
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刷新订阅失败");
    } finally {
      setBusyGlobal(null);
    }
  };

  const handleGlobalSpeedtest = async (subscriptionId?: number) => {
    setBusyGlobal("speed");
    try {
      await testSubscriptionSpeed({
        subscription_id: subscriptionId,
        mode: "http",
        concurrency: 8,
      });
      toast.success("测速已完成");
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "测速失败");
    } finally {
      setBusyGlobal(null);
    }
  };

  const handleGlobalPurity = async (subscriptionId?: number) => {
    setBusyGlobal("purity");
    try {
      await testSubscriptionPurity({
        subscription_id: subscriptionId,
      });
      toast.success("IPPure 纯净度检测已完成");
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "纯净度检测失败");
    } finally {
      setBusyGlobal(null);
    }
  };

  const handleCheckSelfOrProxy = async () => {
    setCheckingSelfPurity(true);
    try {
      const res = await checkIPPureNow({
        proxy_url: proxyCheckUrl.trim() || undefined,
      });
      setLiveCheckResult(res);
      if (!proxyCheckUrl.trim()) {
        setIppureSelf(res);
      }
      toast.success("IPPure 检测完成");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "IPPure 请求失败");
    } finally {
      setCheckingSelfPurity(false);
    }
  };

  const activePurityCard = liveCheckResult || ippureSelf;

  return (
    <div className="space-y-6">
      {/* Header & Admin Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--hub-ink)]">
            订阅与节点监控
          </h1>
          <p className="mt-0.5 text-xs text-[var(--hub-muted)]">
            全球分布地图、并发延迟测速与 IPPure 住宅/原生 IP 纯净度检测
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2.5 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>刷新</span>
          </button>

          {isAdmin ? (
            <>
              <button
                type="button"
                disabled={busyGlobal !== null}
                onClick={() => void handleRefreshAll()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2.5 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)] disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${busyGlobal === "refresh" ? "animate-spin" : ""}`}
                />
                <span>刷新全部订阅</span>
              </button>
              <button
                type="button"
                disabled={busyGlobal !== null}
                onClick={() => void handleGlobalSpeedtest()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2.5 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)] disabled:opacity-60"
              >
                <Zap className="h-3.5 w-3.5 text-blue-600" />
                <span>{busyGlobal === "speed" ? "测速中..." : "一键测速"}</span>
              </button>
              <button
                type="button"
                disabled={busyGlobal !== null}
                onClick={() => void handleGlobalPurity()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2.5 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)] disabled:opacity-60"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                <span>{busyGlobal === "purity" ? "检测中..." : "一键测纯净度"}</span>
              </button>
              <button
                type="button"
                onClick={() => setAddModalOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>添加订阅/节点</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                window.location.href = loginPath(
                  window.location.pathname,
                  window.location.search,
                );
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)]"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>管理员登录后可测速/添加订阅</span>
            </button>
          )}
        </div>
      </div>

      {/* Top Subscription Cards Strip */}
      {subscriptions.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {subscriptions.map((sub) => {
            const used = (sub.upload || 0) + (sub.download || 0);
            const pct =
              sub.total > 0 ? Math.min(100, (used / sub.total) * 100) : 0;
            const expiry = formatExpiryCountdown(sub.expire);
            return (
              <HubCard key={sub.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--hub-ink)]">
                        {sub.name}
                      </span>
                      <span className="rounded border border-[var(--hub-border)] px-1.5 py-0 font-mono text-[10px] uppercase text-[var(--hub-muted)]">
                        {sub.source_type}
                      </span>
                    </div>
                    {sub.masked_url && (
                      <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--hub-muted)]">
                        {sub.masked_url}
                      </div>
                    )}
                  </div>

                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${
                      expiry.urgent
                        ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    }`}
                  >
                    {expiry.text}
                  </span>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-[var(--hub-muted)]">
                    <span>
                      {sub.total > 0
                        ? `${formatBytes(used)} / ${formatBytes(sub.total)} (${pct.toFixed(1)}%)`
                        : "手动节点池"}
                    </span>
                    <span>
                      可用 {sub.available_count} / {sub.node_count}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-blue-600 dark:bg-blue-500"
                      style={{ width: `${sub.total > 0 ? pct : 100}%` }}
                    />
                  </div>
                </div>

                {sub.last_error && (
                  <div className="mt-2 truncate text-[11px] text-rose-500">
                    同步错误: {sub.last_error}
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between border-t border-[var(--hub-border)] pt-2.5 text-[11px] text-[var(--hub-muted)]">
                  <span className="font-mono tabular-nums">
                    同步于 {formatRelativeTime(sub.last_synced_at)}
                  </span>

                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      {sub.source_type === "url" && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await refreshSubscription(sub.id);
                              toast.success("已刷新订阅");
                              await loadAll();
                            } catch (err) {
                              toast.error(
                                err instanceof Error ? err.message : "刷新失败",
                              );
                            }
                          }}
                          title="刷新订阅"
                          className="rounded p-1 hover:bg-[var(--hub-canvas)] hover:text-[var(--hub-ink)]"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleGlobalSpeedtest(sub.id)}
                        title="测速此订阅"
                        className="rounded p-1 hover:bg-[var(--hub-canvas)] hover:text-blue-600"
                      >
                        <Zap className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleGlobalPurity(sub.id)}
                        title="检测纯净度"
                        className="rounded p-1 hover:bg-[var(--hub-canvas)] hover:text-emerald-600"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.confirm(`确定删除订阅「${sub.name}」？`)) return;
                          try {
                            await deleteSubscription(sub.id);
                            toast.success("已删除订阅");
                            await loadAll();
                          } catch (err) {
                            toast.error(
                              err instanceof Error ? err.message : "删除失败",
                            );
                          }
                        }}
                        title="删除订阅"
                        className="rounded p-1 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/60"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </HubCard>
            );
          })}
        </div>
      )}

      {/* Middle Split: Left 7 Cols World Map + Right 5 Cols Region Breakdown Table */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <WorldMapCard
            countries={mapData.countries ?? []}
            markers={mapData.markers ?? []}
            mode={mapMode}
            onModeChange={setMapMode}
            selectedCountry={selectedCountry}
            onSelectCountry={handleSelectCountry}
          />
        </div>

        <HubCard className="flex flex-col p-4 lg:col-span-5">
          <div className="flex items-center justify-between border-b border-[var(--hub-border)] pb-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--hub-ink)]">
                国家/地区分布明细
              </h3>
              <p className="text-xs text-[var(--hub-muted)]">
                点击行筛选下方节点列表
              </p>
            </div>
            {selectedCountry && (
              <button
                type="button"
                onClick={() => handleSelectCountry("")}
                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                清除筛选
              </button>
            )}
          </div>

          <div className="mt-2 flex-1 max-h-[340px] overflow-y-auto divide-y divide-[var(--hub-border)]">
            {sortedCountries.length === 0 ? (
              <div className="py-16 text-center text-xs text-[var(--hub-muted)]">
                暂无国家分布数据
              </div>
            ) : (
              sortedCountries.map((c) => {
                const isSelected =
                  selectedCountry.toUpperCase() === c.country_code.toUpperCase();
                const tier = getFraudTier(c.avg_fraud_score);
                const widthPct = Math.max(8, (c.node_count / maxCountryCount) * 100);
                return (
                  <button
                    key={c.country_code}
                    type="button"
                    onClick={() =>
                      handleSelectCountry(isSelected ? "" : c.country_code)
                    }
                    className={`flex w-full items-center justify-between gap-3 px-2 py-2.5 text-left transition-colors ${
                      isSelected
                        ? "bg-blue-50/70 dark:bg-blue-950/30"
                        : "hover:bg-[var(--hub-canvas)]"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base leading-none">
                          {countryCodeToFlagEmoji(c.country_code)}
                        </span>
                        <span className="truncate text-xs font-medium text-[var(--hub-ink)]">
                          {c.country_name || c.country_code}
                        </span>
                        <span className="font-mono tabular-nums text-[11px] text-[var(--hub-muted)]">
                          {c.node_count}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-blue-500/80"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 font-mono tabular-nums text-[11px]">
                      <span
                        className={`rounded border px-1.5 py-0.5 ${getLatencyBadgeClass(
                          c.min_latency_ms,
                        )}`}
                      >
                        {formatLatency(c.min_latency_ms)}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 ${tier.badgeClass}`}
                      >
                        {c.avg_fraud_score >= 0
                          ? `${Math.round(c.avg_fraud_score)}`
                          : "--"}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </HubCard>
      </div>

      {/* IPPure Instant Purity Check Bar */}
      <HubCard className="overflow-hidden">
        <div
          onClick={() => setPurityBarOpen((o) => !o)}
          className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--hub-canvas)]/50"
        >
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-semibold text-[var(--hub-ink)]">
              IPPure 即时 IP 纯净度检测
            </span>
            <span className="hidden sm:inline text-xs text-[var(--hub-muted)]">
              调用 my.ippure.com/v1/info 识别欺诈分、ASN 与住宅/广播属性
            </span>
          </div>

          <div className="flex items-center gap-2">
            {activePurityCard && !activePurityCard.error && (
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums ${
                  getFraudTier(activePurityCard.fraud_score).badgeClass
                }`}
              >
                {activePurityCard.ip} · 评分 {activePurityCard.fraud_score} (
                {getFraudTier(activePurityCard.fraud_score).shortLabel})
              </span>
            )}
            {purityBarOpen ? (
              <ChevronUp className="h-4 w-4 text-[var(--hub-muted)]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[var(--hub-muted)]" />
            )}
          </div>
        </div>

        {purityBarOpen && (
          <div className="border-t border-[var(--hub-border)] bg-[var(--hub-canvas)]/40 px-4 py-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              {activePurityCard ? (
                activePurityCard.error ? (
                  <div className="text-xs text-rose-600">
                    最近检测失败: {activePurityCard.error}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-lg border font-mono text-sm font-bold tabular-nums ${
                          getFraudTier(activePurityCard.fraud_score).badgeClass
                        }`}
                      >
                        {activePurityCard.fraud_score}
                      </div>
                      <div>
                        <div className="font-mono font-semibold text-[var(--hub-ink)]">
                          {activePurityCard.ip}
                        </div>
                        <div className="text-[11px] text-[var(--hub-muted)]">
                          {countryCodeToFlagEmoji(activePurityCard.country_code || "")}{" "}
                          {activePurityCard.country} · {activePurityCard.city || activePurityCard.region}
                        </div>
                      </div>
                    </div>

                    <div className="h-7 w-px bg-[var(--hub-border)] hidden sm:block" />

                    <div className="space-y-0.5 font-mono text-[11px]">
                      <div className="text-[var(--hub-ink)]">
                        AS{activePurityCard.asn} · {activePurityCard.as_organization}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded border px-1.5 py-0 text-[10px] ${
                            activePurityCard.is_residential
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300"
                              : "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                          }`}
                        >
                          {activePurityCard.is_residential ? "住宅 IP" : "机房 IP"}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0 text-[10px] ${
                            !activePurityCard.is_broadcast
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300"
                              : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300"
                          }`}
                        >
                          {activePurityCard.is_broadcast ? "广播 IP" : "原生 IP"}
                        </span>
                        <span className="text-[var(--hub-muted)]">
                          {formatRelativeTime(activePurityCard.checked_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <div className="text-xs text-[var(--hub-muted)]">
                  尚无本机出口或指定代理的 IPPure 检测记录
                </div>
              )}

              {isAdmin && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={proxyCheckUrl}
                    onChange={(e) => setProxyCheckUrl(e.target.value)}
                    placeholder="可选代理 http:// 或 socks5:// (留空测本机出口)"
                    className="h-8 w-64 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2.5 font-mono text-xs text-[var(--hub-ink)] placeholder:text-[var(--hub-muted)]"
                  />
                  <button
                    type="button"
                    disabled={checkingSelfPurity}
                    onClick={() => void handleCheckSelfOrProxy()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    <Gauge className="h-3.5 w-3.5" />
                    <span>
                      {checkingSelfPurity
                        ? "检测中..."
                        : proxyCheckUrl.trim()
                          ? "检测代理 IPPure"
                          : "检测当前出口 IPPure"}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </HubCard>

      {/* Bottom Full-Width Node Table */}
      {nodes.length === 0 && !loading ? (
        <HubEmptyState
          icon={Globe}
          title="暂无订阅节点"
          description={
            isAdmin
              ? "点击右上角「添加订阅/节点」导入机场订阅 URL 或手动粘贴节点链接，即可开启全球分布与 IPPure 纯净度分析。"
              : "管理员尚未导入订阅或节点。"
          }
          action={
            isAdmin ? (
              <button
                type="button"
                onClick={() => setAddModalOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>导入第一个订阅</span>
              </button>
            ) : undefined
          }
        />
      ) : (
        <HubCard className="overflow-hidden">
          {/* Table Filter Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hub-border)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--hub-muted)]" />
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="搜索节点名、IP、ASN、地区..."
                  className="h-8 w-56 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] pl-8 pr-7 text-xs text-[var(--hub-ink)] focus:outline-none"
                />
                {searchText && (
                  <button
                    type="button"
                    onClick={() => setSearchText("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              <select
                value={selectedSubId}
                onChange={(e) => setSelectedSubId(e.target.value)}
                className="h-8 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2.5 text-xs text-[var(--hub-ink)]"
              >
                <option value="all">全部订阅</option>
                {subscriptions.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name}
                  </option>
                ))}
              </select>

              <select
                value={selectedProtocol}
                onChange={(e) => setSelectedProtocol(e.target.value)}
                className="h-8 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2.5 text-xs text-[var(--hub-ink)]"
              >
                <option value="all">全部协议</option>
                {protocols.map((p) => (
                  <option key={p} value={p}>
                    {p.toUpperCase()}
                  </option>
                ))}
              </select>

              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2.5 py-1.5 text-xs text-[var(--hub-ink)]">
                <input
                  type="checkbox"
                  checked={onlyAvailable}
                  onChange={(e) => setOnlyAvailable(e.target.checked)}
                />
                <span>仅看可用</span>
              </label>

              {selectedCountry && (
                <button
                  type="button"
                  onClick={() => handleSelectCountry("")}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-xs font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-300"
                >
                  <span>地区: {selectedCountry}</span>
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <span className="font-mono tabular-nums text-xs text-[var(--hub-muted)]">
              显示 {filteredNodes.length} / {nodes.length} 节点
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--hub-border)] bg-[var(--hub-canvas)] text-[11px] font-medium text-[var(--hub-muted)]">
                  <th className="px-4 py-2.5">节点名称 / 协议</th>
                  <th className="px-4 py-2.5">地区</th>
                  <th className="px-4 py-2.5">延迟</th>
                  <th className="px-4 py-2.5">下载速度</th>
                  <th className="px-4 py-2.5">IPPure 纯净度</th>
                  {isAdmin && <th className="px-4 py-2.5 text-right">操作</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--hub-border)]">
                {filteredNodes.map((node) => {
                  const tier = getFraudTier(node.ippure?.fraud_score);
                  return (
                    <tr
                      key={node.id}
                      className={`transition-colors hover:bg-[var(--hub-canvas)]/70 ${
                        !node.enabled ? "opacity-55" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[var(--hub-ink)]">
                            {node.name}
                          </span>
                          <span className="rounded border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-1.5 py-0 font-mono text-[10px] uppercase text-[var(--hub-muted)]">
                            {node.protocol}
                          </span>
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-[var(--hub-muted)]">
                          {node.host}:{node.port} · {node.subscription_name}
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm leading-none">
                            {countryCodeToFlagEmoji(node.country_code || "")}
                          </span>
                          <span className="text-[var(--hub-ink)]">
                            {node.city || node.country_name || node.country_code || "--"}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap font-mono tabular-nums">
                        <span
                          className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-medium ${getLatencyBadgeClass(
                            node.latency_ms,
                          )}`}
                        >
                          {formatLatency(node.latency_ms)}
                        </span>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap font-mono tabular-nums text-[var(--hub-ink)]">
                        {node.download_mbps > 0
                          ? `${node.download_mbps.toFixed(1)} Mbps`
                          : "--"}
                      </td>

                      <td className="px-4 py-3">
                        {node.ippure ? (
                          node.ippure.error ? (
                            <span
                              title={node.ippure.error}
                              className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"
                            >
                              <Info className="h-3.5 w-3.5 shrink-0" />
                              <span className="max-w-[180px] truncate">
                                {node.ippure.error}
                              </span>
                            </span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setInspectedNode(node)}
                                className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] tabular-nums font-medium ${tier.badgeClass}`}
                              >
                                <span>{node.ippure.fraud_score}</span>
                                <span>{tier.shortLabel}</span>
                              </button>
                              <span className="rounded border border-[var(--hub-border)] px-1.5 py-0.5 text-[10px] text-[var(--hub-ink)]">
                                {node.ippure.is_residential ? "住宅" : "机房"}
                              </span>
                              <span className="rounded border border-[var(--hub-border)] px-1.5 py-0.5 text-[10px] text-[var(--hub-muted)]">
                                {node.ippure.is_broadcast ? "广播" : "原生"}
                              </span>
                            </div>
                          )
                        ) : (
                          <span className="text-[11px] text-[var(--hub-muted)]">
                            未检测
                          </span>
                        )}
                      </td>

                      {isAdmin && (
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={busyNodeId === node.id}
                              onClick={async () => {
                                setBusyNodeId(node.id);
                                try {
                                  await testSubscriptionSpeed({
                                    node_ids: [node.id],
                                    mode: "http",
                                  });
                                  await loadAll();
                                  toast.success("单节点测速完成");
                                } catch (err) {
                                  toast.error(
                                    err instanceof Error ? err.message : "测速失败",
                                  );
                                } finally {
                                  setBusyNodeId(null);
                                }
                              }}
                              title="测速"
                              className="rounded p-1.5 text-[var(--hub-muted)] hover:bg-[var(--hub-canvas)] hover:text-blue-600 disabled:opacity-50"
                            >
                              <Zap className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={busyNodeId === node.id}
                              onClick={async () => {
                                setBusyNodeId(node.id);
                                try {
                                  await testSubscriptionPurity({ node_ids: [node.id] });
                                  await loadAll();
                                  toast.success("单节点纯净度检测完成");
                                } catch (err) {
                                  toast.error(
                                    err instanceof Error
                                      ? err.message
                                      : "纯净度检测失败",
                                  );
                                } finally {
                                  setBusyNodeId(null);
                                }
                              }}
                              title="测纯净度"
                              className="rounded p-1.5 text-[var(--hub-muted)] hover:bg-[var(--hub-canvas)] hover:text-emerald-600 disabled:opacity-50"
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={busyNodeId === node.id}
                              onClick={async () => {
                                setBusyNodeId(node.id);
                                try {
                                  await patchSubscriptionNode(node.id, {
                                    enabled: !node.enabled,
                                  });
                                  await loadAll();
                                } catch (err) {
                                  toast.error(
                                    err instanceof Error ? err.message : "更新失败",
                                  );
                                } finally {
                                  setBusyNodeId(null);
                                }
                              }}
                              title={node.enabled ? "禁用节点" : "启用节点"}
                              className={`rounded px-2 py-1 text-[11px] font-medium ${
                                node.enabled
                                  ? "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/60"
                                  : "text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                              }`}
                            >
                              {node.enabled ? "启用" : "停用"}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </HubCard>
      )}

      {/* IPPure Detail Popover Modal */}
      {inspectedNode && inspectedNode.ippure && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-[2px]"
          onClick={() => setInspectedNode(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--hub-border)] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--hub-ink)]">
                  IPPure 详情 · {inspectedNode.name}
                </h3>
                <p className="text-xs text-[var(--hub-muted)] font-mono">
                  {inspectedNode.ippure.ip}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedNode(null)}
                className="rounded p-1 text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--hub-muted)]">欺诈风险评分</span>
                <span
                  className={`rounded border px-2 py-0.5 font-mono tabular-nums font-semibold ${
                    getFraudTier(inspectedNode.ippure.fraud_score).badgeClass
                  }`}
                >
                  {inspectedNode.ippure.fraud_score} / 100 ·{" "}
                  {getFraudTier(inspectedNode.ippure.fraud_score).label}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--hub-muted)]">ASN / 运营商</span>
                <span className="font-mono text-[var(--hub-ink)] text-right">
                  AS{inspectedNode.ippure.asn} · {inspectedNode.ippure.as_organization}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--hub-muted)]">归属地</span>
                <span className="text-[var(--hub-ink)]">
                  {countryCodeToFlagEmoji(inspectedNode.ippure.country_code || "")}{" "}
                  {inspectedNode.ippure.country} · {inspectedNode.ippure.region} ·{" "}
                  {inspectedNode.ippure.city}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--hub-muted)]">经纬度坐标</span>
                <span className="font-mono tabular-nums text-[var(--hub-ink)]">
                  {inspectedNode.ippure.latitude.toFixed(4)},{" "}
                  {inspectedNode.ippure.longitude.toFixed(4)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--hub-muted)]">网络属性</span>
                <span className="text-[var(--hub-ink)]">
                  {inspectedNode.ippure.is_residential ? "住宅 IP" : "机房 IP"} /{" "}
                  {inspectedNode.ippure.is_broadcast ? "广播 IP" : "原生 IP"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--hub-muted)]">检测时间</span>
                <span className="font-mono tabular-nums text-[var(--hub-muted)]">
                  {new Date(inspectedNode.ippure.checked_at).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Subscription / Manual Nodes Modal */}
      {addModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-[2px]"
          onClick={() => setAddModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--hub-border)] pb-3">
              <h3 className="text-sm font-semibold text-[var(--hub-ink)]">
                添加订阅 / 手动节点
              </h3>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="rounded p-1 text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 inline-flex rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setAddMode("url")}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  addMode === "url"
                    ? "bg-[var(--hub-surface)] text-[var(--hub-ink)] shadow-xs"
                    : "text-[var(--hub-muted)]"
                }`}
              >
                订阅链接 (Clash / Base64)
              </button>
              <button
                type="button"
                onClick={() => setAddMode("manual")}
                className={`rounded-md px-3 py-1.5 font-medium ${
                  addMode === "manual"
                    ? "bg-[var(--hub-surface)] text-[var(--hub-ink)] shadow-xs"
                    : "text-[var(--hub-muted)]"
                }`}
              >
                手动节点列表
              </button>
            </div>

            <form onSubmit={handleCreateSubscription} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-medium text-[var(--hub-ink)]">
                  名称
                </label>
                <input
                  required
                  value={subForm.name}
                  onChange={(e) =>
                    setSubForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="例如：主用高速订阅"
                  className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 py-2 text-sm text-[var(--hub-ink)]"
                />
              </div>

              {addMode === "url" ? (
                <>
                  <div>
                    <label className="mb-1 block font-medium text-[var(--hub-ink)]">
                      订阅 URL
                    </label>
                    <input
                      required
                      value={subForm.url}
                      onChange={(e) =>
                        setSubForm((f) => ({ ...f, url: e.target.value }))
                      }
                      placeholder="https://sub.example.com/api/v1/client/subscribe?token=..."
                      className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 py-2 font-mono text-sm text-[var(--hub-ink)]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-medium text-[var(--hub-ink)]">
                      自动更新间隔 (小时，0 为关闭)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={subForm.auto_update_hours}
                      onChange={(e) =>
                        setSubForm((f) => ({
                          ...f,
                          auto_update_hours: Number(e.target.value) || 0,
                        }))
                      }
                      className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 py-2 font-mono text-sm text-[var(--hub-ink)]"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="mb-1 block font-medium text-[var(--hub-ink)]">
                    节点分享链接 (每行一条，支持 vless/vmess/trojan/ss/hy2/socks5/http)
                  </label>
                  <textarea
                    required
                    rows={5}
                    value={subForm.raw_content}
                    onChange={(e) =>
                      setSubForm((f) => ({ ...f, raw_content: e.target.value }))
                    }
                    placeholder="vless://...&#10;trojan://...&#10;socks5://user:pass@1.2.3.4:1080#Home"
                    className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 py-2 font-mono text-xs text-[var(--hub-ink)]"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="rounded-lg border border-[var(--hub-border)] px-3 py-1.5 font-medium text-[var(--hub-ink)]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={savingSub}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-1.5 font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  <Activity className="h-3.5 w-3.5" />
                  <span>{savingSub ? "解析保存中..." : "保存并解析"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const SubscriptionsPage: React.FC = () => (
  <AccountProvider>
    <SubscriptionsPageInner />
  </AccountProvider>
);

export default SubscriptionsPage;
