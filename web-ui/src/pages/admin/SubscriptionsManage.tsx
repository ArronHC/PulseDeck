import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Gauge,
  Globe,
  Info,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  checkIPPureNow,
  createSubscription,
  deleteSubscription,
  fetchAdminSubscriptions,
  fetchIPPureSelf,
  fetchSubscriptionNodes,
  formatExpiryCountdown,
  formatLatency,
  formatRelativeTime,
  getFraudTier,
  getLatencyBadgeClass,
  patchSubscriptionNode,
  refreshSubscription,
  testSubscriptionPurity,
  testSubscriptionSpeed,
  updateSubscription,
} from "@/lib/hubApi";
import type {
  IPPureInfo,
  SubscriptionItem,
  SubscriptionNode,
} from "@/types/hub";
import { formatBytes } from "@/utils/unitHelper";
import { countryCodeToFlagEmoji } from "@/utils/regionCode";
import { HubCard, HubEmptyState } from "@/components/hub/HubUi";
import { toast } from "sonner";

export default function SubscriptionsManagePage() {
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [nodes, setNodes] = useState<SubscriptionNode[]>([]);
  const [ippureSelf, setIppureSelf] = useState<IPPureInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [busyGlobal, setBusyGlobal] = useState<string | null>(null);
  const [busyNodeId, setBusyNodeId] = useState<number | null>(null);

  // Filters
  const [selectedSubId, setSelectedSubId] = useState<string>("all");
  const [selectedProtocol, setSelectedProtocol] = useState<string>("all");
  const [selectedCountry, setSelectedCountry] = useState<string>("all");
  const [searchText, setSearchText] = useState<string>("");

  // IPPure live check
  const [proxyCheckUrl, setProxyCheckUrl] = useState<string>("");
  const [checkingPurity, setCheckingPurity] = useState<boolean>(false);
  const [liveCheckResult, setLiveCheckResult] = useState<IPPureInfo | null>(null);

  // IPPure node detail modal
  const [inspectedNode, setInspectedNode] = useState<SubscriptionNode | null>(null);

  // Add / Edit Subscription Modal
  const [subModalOpen, setSubModalOpen] = useState<boolean>(false);
  const [editingSub, setEditingSub] = useState<SubscriptionItem | null>(null);
  const [subMode, setSubMode] = useState<"url" | "manual">("url");
  const [subForm, setSubForm] = useState({
    name: "",
    url: "",
    raw_content: "",
    auto_update_hours: 12,
    enabled: true,
  });
  const [savingSub, setSavingSub] = useState<boolean>(false);

  // Edit Node Geo Modal
  const [editingNode, setEditingNode] = useState<SubscriptionNode | null>(null);
  const [nodeGeoForm, setNodeGeoForm] = useState({
    country_code: "",
    city: "",
    lat: "",
    lng: "",
  });
  const [savingNodeGeo, setSavingNodeGeo] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [subsRes, nodesRes, selfRes] = await Promise.all([
        fetchAdminSubscriptions().catch(() => []),
        fetchSubscriptionNodes().catch(() => []),
        fetchIPPureSelf().catch(() => null),
      ]);
      setSubscriptions(Array.isArray(subsRes) ? subsRes : []);
      setNodes(Array.isArray(nodesRes) ? nodesRes : []);
      setIppureSelf(selfRes);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const protocols = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) {
      if (n.protocol) set.add(n.protocol.toLowerCase());
    }
    return Array.from(set).sort();
  }, [nodes]);

  const countries = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nodes) {
      if (n.country_code) {
        map.set(n.country_code.toUpperCase(), n.country_name || n.country_code);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [nodes]);

  const filteredNodes = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return nodes.filter((n) => {
      if (selectedSubId !== "all" && String(n.subscription_id) !== selectedSubId) {
        return false;
      }
      if (
        selectedCountry !== "all" &&
        (n.country_code || "").toUpperCase() !== selectedCountry
      ) {
        return false;
      }
      if (
        selectedProtocol !== "all" &&
        (n.protocol || "").toLowerCase() !== selectedProtocol
      ) {
        return false;
      }
      if (q) {
        const hay = `${n.name} ${n.host} ${n.city} ${n.country_name} ${n.country_code} ${n.protocol} ${n.subscription_name} ${n.ippure?.ip || ""} ${n.ippure?.as_organization || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [nodes, selectedSubId, selectedCountry, selectedProtocol, searchText]);

  const openAddModal = () => {
    setEditingSub(null);
    setSubMode("url");
    setSubForm({
      name: "",
      url: "",
      raw_content: "",
      auto_update_hours: 12,
      enabled: true,
    });
    setSubModalOpen(true);
  };

  const openEditSubModal = (sub: SubscriptionItem) => {
    setEditingSub(sub);
    setSubMode(sub.source_type === "manual" ? "manual" : "url");
    setSubForm({
      name: sub.name,
      url: sub.url || "",
      raw_content: sub.raw_content || "",
      auto_update_hours: sub.auto_update_hours ?? 12,
      enabled: sub.enabled,
    });
    setSubModalOpen(true);
  };

  const handleSaveSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subForm.name.trim()) {
      toast.error("请输入订阅或分组名称");
      return;
    }
    if (!editingSub && subMode === "url" && !subForm.url.trim()) {
      toast.error("请输入订阅链接 URL");
      return;
    }
    if (!editingSub && subMode === "manual" && !subForm.raw_content.trim()) {
      toast.error("请粘贴节点链接 (每行一条)");
      return;
    }
    setSavingSub(true);
    try {
      if (editingSub) {
        await updateSubscription(editingSub.id, {
          name: subForm.name.trim(),
          url: subMode === "url" && subForm.url.trim() ? subForm.url.trim() : undefined,
          raw_content:
            subMode === "manual" && subForm.raw_content.trim()
              ? subForm.raw_content.trim()
              : undefined,
          auto_update_hours: subForm.auto_update_hours,
          enabled: subForm.enabled,
        });
        toast.success("已更新订阅配置");
      } else {
        await createSubscription({
          name: subForm.name.trim(),
          url: subMode === "url" ? subForm.url.trim() : undefined,
          raw_content: subMode === "manual" ? subForm.raw_content.trim() : undefined,
          auto_update_hours: subForm.auto_update_hours,
        });
        toast.success("已添加订阅并解析节点");
      }
      setSubModalOpen(false);
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
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
    setCheckingPurity(true);
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
      setCheckingPurity(false);
    }
  };

  const openNodeGeoModal = (node: SubscriptionNode) => {
    setEditingNode(node);
    setNodeGeoForm({
      country_code: node.country_code || "",
      city: node.city || "",
      lat: node.lat ? String(node.lat) : "",
      lng: node.lng ? String(node.lng) : "",
    });
  };

  const handleSaveNodeGeo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNode) return;
    setSavingNodeGeo(true);
    try {
      const latNum = nodeGeoForm.lat.trim() ? Number(nodeGeoForm.lat) : undefined;
      const lngNum = nodeGeoForm.lng.trim() ? Number(nodeGeoForm.lng) : undefined;
      await patchSubscriptionNode(editingNode.id, {
        country_code: nodeGeoForm.country_code.trim().toUpperCase(),
        city: nodeGeoForm.city.trim(),
        ...(latNum !== undefined && !Number.isNaN(latNum) ? { lat: latNum } : {}),
        ...(lngNum !== undefined && !Number.isNaN(lngNum) ? { lng: lngNum } : {}),
      });
      toast.success("节点归属地信息已更新");
      setEditingNode(null);
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失败");
    } finally {
      setSavingNodeGeo(false);
    }
  };

  const activePurityCard = liveCheckResult || ippureSelf;

  return (
    <div className="space-y-6">
      {/* Header & Admin Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--hub-ink)]">
            订阅与节点管理
          </h1>
          <p className="mt-0.5 text-xs text-[var(--hub-muted)]">
            导入机场订阅与手动节点池，执行批量延迟测速、IPPure 纯净度探测与地区坐标修正
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
            <span>{busyGlobal === "speed" ? "测速中..." : "批量测速"}</span>
          </button>

          <button
            type="button"
            disabled={busyGlobal !== null}
            onClick={() => void handleGlobalPurity()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2.5 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)] disabled:opacity-60"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>{busyGlobal === "purity" ? "检测中..." : "批量测纯净度"}</span>
          </button>

          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>添加订阅/节点</span>
          </button>
        </div>
      </div>

      {/* Subscription Sources */}
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
                      {!sub.enabled && (
                        <span className="rounded bg-zinc-200 px-1.5 py-0 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                          停用
                        </span>
                      )}
                    </div>
                    {(sub.masked_url || sub.url) && (
                      <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--hub-muted)]">
                        {sub.masked_url || sub.url}
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
                  <div className="flex items-center justify-between font-mono text-[11px] tabular-nums text-[var(--hub-muted)]">
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

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEditSubModal(sub)}
                      title="编辑订阅"
                      className="rounded p-1 hover:bg-[var(--hub-canvas)] hover:text-[var(--hub-ink)]"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
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
                </div>
              </HubCard>
            );
          })}
        </div>
      )}

      {/* IPPure Instant Check Panel */}
      <HubCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hub-border)] pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-semibold text-[var(--hub-ink)]">
              IPPure 即时检测控制台
            </span>
            <span className="hidden sm:inline text-xs text-[var(--hub-muted)]">
              支持留空检测服务端本机出口，或输入 http:// / socks5:// 代理地址实时验证
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={proxyCheckUrl}
              onChange={(e) => setProxyCheckUrl(e.target.value)}
              placeholder="可选代理 http:// 或 socks5:// (留空测本机出口)"
              className="h-8 w-64 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2.5 font-mono text-xs text-[var(--hub-ink)] placeholder:text-[var(--hub-muted)]"
            />
            <button
              type="button"
              disabled={checkingPurity}
              onClick={() => void handleCheckSelfOrProxy()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              <Gauge className="h-3.5 w-3.5" />
              <span>
                {checkingPurity
                  ? "检测中..."
                  : proxyCheckUrl.trim()
                    ? "检测代理 IPPure"
                    : "检测当前出口 IPPure"}
              </span>
            </button>
          </div>
        </div>

        <div className="pt-3">
          {activePurityCard ? (
            activePurityCard.error ? (
              <div className="text-xs text-rose-600">
                检测失败: {activePurityCard.error}
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
                      {activePurityCard.country} ·{" "}
                      {activePurityCard.city || activePurityCard.region}
                    </div>
                  </div>
                </div>

                <div className="hidden h-7 w-px bg-[var(--hub-border)] sm:block" />

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
              尚无检测记录，点击右侧按钮立即运行 IPPure 出口纯净度检测。
            </div>
          )}
        </div>
      </HubCard>

      {/* Node Pool Management Table */}
      {nodes.length === 0 && !loading ? (
        <HubEmptyState
          icon={Globe}
          title="暂无订阅节点"
          description="点击右上角「添加订阅/节点」导入机场订阅 URL 或手动粘贴节点链接，即可开启测速、地图分布与 IPPure 纯净度管理。"
          action={
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>导入第一个订阅</span>
            </button>
          }
        />
      ) : (
        <HubCard className="overflow-hidden">
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

              <select
                value={selectedCountry}
                onChange={(e) => setSelectedCountry(e.target.value)}
                className="h-8 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2.5 text-xs text-[var(--hub-ink)]"
              >
                <option value="all">全部地区</option>
                {countries.map(([code, name]) => (
                  <option key={code} value={code}>
                    {code} · {name}
                  </option>
                ))}
              </select>
            </div>

            <span className="font-mono text-xs tabular-nums text-[var(--hub-muted)]">
              显示 {filteredNodes.length} / {nodes.length} 节点
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--hub-border)] bg-[var(--hub-canvas)] text-[11px] font-medium text-[var(--hub-muted)]">
                  <th className="px-4 py-2.5">节点名称 / 协议</th>
                  <th className="px-4 py-2.5">地区与坐标</th>
                  <th className="px-4 py-2.5">延迟</th>
                  <th className="px-4 py-2.5">下载速度</th>
                  <th className="px-4 py-2.5">IPPure 纯净度</th>
                  <th className="px-4 py-2.5 text-right">操作</th>
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
                                className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums ${tier.badgeClass}`}
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

                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            disabled={busyNodeId === node.id}
                            onClick={() => openNodeGeoModal(node)}
                            title="编辑地区与坐标"
                            className="rounded p-1.5 text-[var(--hub-muted)] hover:bg-[var(--hub-canvas)] hover:text-[var(--hub-ink)] disabled:opacity-50"
                          >
                            <MapPin className="h-3.5 w-3.5" />
                          </button>
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
                            title="单节点测速"
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
                <p className="font-mono text-xs text-[var(--hub-muted)]">
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
                  className={`rounded border px-2 py-0.5 font-mono font-semibold tabular-nums ${
                    getFraudTier(inspectedNode.ippure.fraud_score).badgeClass
                  }`}
                >
                  {inspectedNode.ippure.fraud_score} / 100 ·{" "}
                  {getFraudTier(inspectedNode.ippure.fraud_score).label}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--hub-muted)]">ASN / 运营商</span>
                <span className="text-right font-mono text-[var(--hub-ink)]">
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

      {/* Add / Edit Subscription Modal */}
      {subModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-[2px]"
          onClick={() => setSubModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--hub-border)] pb-3">
              <h3 className="text-sm font-semibold text-[var(--hub-ink)]">
                {editingSub ? `编辑订阅 · ${editingSub.name}` : "添加订阅 / 手动节点"}
              </h3>
              <button
                type="button"
                onClick={() => setSubModalOpen(false)}
                className="rounded p-1 text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!editingSub && (
              <div className="mt-4 inline-flex rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setSubMode("url")}
                  className={`rounded-md px-3 py-1.5 font-medium ${
                    subMode === "url"
                      ? "bg-[var(--hub-surface)] text-[var(--hub-ink)] shadow-xs"
                      : "text-[var(--hub-muted)]"
                  }`}
                >
                  订阅链接 (Clash / Base64)
                </button>
                <button
                  type="button"
                  onClick={() => setSubMode("manual")}
                  className={`rounded-md px-3 py-1.5 font-medium ${
                    subMode === "manual"
                      ? "bg-[var(--hub-surface)] text-[var(--hub-ink)] shadow-xs"
                      : "text-[var(--hub-muted)]"
                  }`}
                >
                  手动节点列表
                </button>
              </div>
            )}

            <form onSubmit={handleSaveSubscription} className="mt-4 space-y-3 text-xs">
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

              {subMode === "url" ? (
                <>
                  <div>
                    <label className="mb-1 block font-medium text-[var(--hub-ink)]">
                      订阅 URL {editingSub ? "(留空保留原链接)" : ""}
                    </label>
                    <input
                      required={!editingSub}
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
                    required={!editingSub}
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

              {editingSub && (
                <label className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    checked={subForm.enabled}
                    onChange={(e) =>
                      setSubForm((f) => ({ ...f, enabled: e.target.checked }))
                    }
                  />
                  <span className="text-[var(--hub-ink)]">启用此订阅</span>
                </label>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSubModalOpen(false)}
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
                  <span>{savingSub ? "保存中..." : "保存并解析"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Node Geo Modal */}
      {editingNode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-[2px]"
          onClick={() => setEditingNode(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--hub-border)] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--hub-ink)]">
                  修正节点地理位置
                </h3>
                <p className="text-xs text-[var(--hub-muted)]">{editingNode.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingNode(null)}
                className="rounded p-1 text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveNodeGeo} className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-medium text-[var(--hub-ink)]">
                    国家代码 (ISO Alpha-2)
                  </label>
                  <input
                    value={nodeGeoForm.country_code}
                    onChange={(e) =>
                      setNodeGeoForm((f) => ({ ...f, country_code: e.target.value }))
                    }
                    placeholder="HK / JP / US / SG"
                    className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 py-2 font-mono text-sm uppercase text-[var(--hub-ink)]"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[var(--hub-ink)]">
                    城市名称
                  </label>
                  <input
                    value={nodeGeoForm.city}
                    onChange={(e) =>
                      setNodeGeoForm((f) => ({ ...f, city: e.target.value }))
                    }
                    placeholder="Tokyo / Hong Kong"
                    className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 py-2 text-sm text-[var(--hub-ink)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-medium text-[var(--hub-ink)]">
                    纬度 (Lat)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={nodeGeoForm.lat}
                    onChange={(e) =>
                      setNodeGeoForm((f) => ({ ...f, lat: e.target.value }))
                    }
                    placeholder="35.6762"
                    className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 py-2 font-mono text-sm text-[var(--hub-ink)]"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[var(--hub-ink)]">
                    经度 (Lng)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={nodeGeoForm.lng}
                    onChange={(e) =>
                      setNodeGeoForm((f) => ({ ...f, lng: e.target.value }))
                    }
                    placeholder="139.6503"
                    className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 py-2 font-mono text-sm text-[var(--hub-ink)]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingNode(null)}
                  className="rounded-lg border border-[var(--hub-border)] px-3 py-1.5 font-medium text-[var(--hub-ink)]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={savingNodeGeo}
                  className="rounded-lg bg-zinc-900 px-3.5 py-1.5 font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {savingNodeGeo ? "保存中..." : "保存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
