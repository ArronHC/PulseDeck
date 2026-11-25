import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  PauseCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";
import {
  checkUptimeMonitor,
  createKumaSource,
  createUptimeMonitor,
  deleteKumaSource,
  deleteUptimeMonitor,
  fetchUptimeIncidents,
  fetchUptimeMonitorHistory,
  fetchUptimeSummary,
  formatDurationCompact,
  formatLatency,
  formatRelativeTime,
  listKumaSources,
  syncKumaSource,
  updateUptimeMonitor,
} from "@/lib/hubApi";
import type {
  KumaSource,
  UptimeHeartbeat,
  UptimeIncident,
  UptimeMonitor,
  UptimeMonitorPayload,
  UptimeSummaryData,
} from "@/types/hub";
import {
  HeartbeatStrip,
  HubCard,
  HubEmptyState,
  TimeRangePills,
} from "@/components/hub/HubUi";
import { toast } from "sonner";

const DEFAULT_FORM: UptimeMonitorPayload = {
  name: "",
  group: "默认分组",
  type: "http",
  target: "",
  keyword: "",
  interval_sec: 60,
  timeout_sec: 10,
  enabled: true,
};

const UptimePageInner: React.FC = () => {
  const { account } = useAccount();
  const isAdmin = Boolean(account?.logged_in);
  const [searchParams] = useSearchParams();
  const focusMonitorId = Number(searchParams.get("monitor") || 0);

  const [hours, setHours] = useState<number>(24);
  const [summary, setSummary] = useState<UptimeSummaryData | null>(null);
  const [incidents, setIncidents] = useState<UptimeIncident[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedGroup, setSelectedGroup] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<number | null>(
    focusMonitorId > 0 ? focusMonitorId : null,
  );
  const [historyMap, setHistoryMap] = useState<Record<number, UptimeHeartbeat[]>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<number, boolean>>({});
  const [busyActionId, setBusyActionId] = useState<number | null>(null);

  // Admin Modals
  const [monitorModalOpen, setMonitorModalOpen] = useState(false);
  const [editingMonitor, setEditingMonitor] = useState<UptimeMonitor | null>(null);
  const [form, setForm] = useState<UptimeMonitorPayload>(DEFAULT_FORM);
  const [savingMonitor, setSavingMonitor] = useState(false);

  const [kumaModalOpen, setKumaModalOpen] = useState(false);
  const [kumaSources, setKumaSources] = useState<KumaSource[]>([]);
  const [kumaForm, setKumaForm] = useState({
    name: "",
    base_url: "",
    slug: "",
    enabled: true,
  });
  const [kumaBusy, setKumaBusy] = useState(false);

  const loadAll = useCallback(async (h: number) => {
    setLoading(true);
    try {
      const [sumRes, incRes] = await Promise.all([
        fetchUptimeSummary(h),
        fetchUptimeIncidents(30).catch(() => []),
      ]);
      setSummary(sumRes);
      setIncidents(Array.isArray(incRes) ? incRes : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载服务状态失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll(hours);
  }, [hours, loadAll]);

  const loadMonitorHistory = useCallback(
    async (id: number, h: number) => {
      setHistoryLoading((prev) => ({ ...prev, [id]: true }));
      try {
        const res = await fetchUptimeMonitorHistory(id, h);
        const list = Array.isArray(res) ? res : res?.heartbeats ?? [];
        setHistoryMap((prev) => ({ ...prev, [id]: list }));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "加载历史心跳失败");
      } finally {
        setHistoryLoading((prev) => ({ ...prev, [id]: false }));
      }
    },
    [],
  );

  useEffect(() => {
    if (expandedId) {
      void loadMonitorHistory(expandedId, hours);
    }
  }, [expandedId, hours, loadMonitorHistory]);

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const m of summary?.monitors ?? []) {
      if (m.group && m.group.trim()) set.add(m.group.trim());
    }
    return Array.from(set).sort();
  }, [summary?.monitors]);

  const filteredMonitors = useMemo(() => {
    const list = summary?.monitors ?? [];
    if (selectedGroup === "all") return list;
    return list.filter((m) => (m.group || "默认分组") === selectedGroup);
  }, [summary?.monitors, selectedGroup]);

  const openCreateModal = () => {
    setEditingMonitor(null);
    setForm(DEFAULT_FORM);
    setMonitorModalOpen(true);
  };

  const openEditModal = (mon: UptimeMonitor) => {
    setEditingMonitor(mon);
    setForm({
      name: mon.name,
      group: mon.group || "默认分组",
      type: mon.type || "http",
      target: mon.target,
      keyword: mon.keyword || "",
      interval_sec: mon.interval_sec || 60,
      timeout_sec: mon.timeout_sec || 10,
      enabled: mon.enabled,
    });
    setMonitorModalOpen(true);
  };

  const handleSaveMonitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.target.trim()) {
      toast.error("请填写监控名称和目标地址");
      return;
    }
    setSavingMonitor(true);
    try {
      if (editingMonitor) {
        await updateUptimeMonitor(editingMonitor.id, form);
        toast.success("监控项已更新");
      } else {
        await createUptimeMonitor(form);
        toast.success("已添加监控项");
      }
      setMonitorModalOpen(false);
      await loadAll(hours);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingMonitor(false);
    }
  };

  const handleCheckNow = async (id: number) => {
    setBusyActionId(id);
    try {
      await checkUptimeMonitor(id);
      toast.success("已完成即时探测");
      await loadAll(hours);
      if (expandedId === id) {
        await loadMonitorHistory(id, hours);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "检测失败");
    } finally {
      setBusyActionId(null);
    }
  };

  const handleDeleteMonitor = async (mon: UptimeMonitor) => {
    if (!window.confirm(`确定删除监控项「${mon.name}」吗？`)) return;
    setBusyActionId(mon.id);
    try {
      await deleteUptimeMonitor(mon.id);
      toast.success("已删除监控项");
      await loadAll(hours);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setBusyActionId(null);
    }
  };

  const openKumaModal = async () => {
    setKumaModalOpen(true);
    setKumaBusy(true);
    try {
      const list = await listKumaSources();
      setKumaSources(Array.isArray(list) ? list : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载外部 Kuma 源失败");
    } finally {
      setKumaBusy(false);
    }
  };

  const handleAddKuma = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kumaForm.name.trim() || !kumaForm.base_url.trim() || !kumaForm.slug.trim()) {
      toast.error("请完整填写名称、Uptime Kuma URL 与 Status Page Slug");
      return;
    }
    setKumaBusy(true);
    try {
      await createKumaSource(kumaForm);
      setKumaForm({ name: "", base_url: "", slug: "", enabled: true });
      const list = await listKumaSources();
      setKumaSources(Array.isArray(list) ? list : []);
      toast.success("已添加 Uptime Kuma 数据源");
      await loadAll(hours);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加失败");
    } finally {
      setKumaBusy(false);
    }
  };

  const handleSyncKuma = async (id: number) => {
    setKumaBusy(true);
    try {
      await syncKumaSource(id);
      const list = await listKumaSources();
      setKumaSources(Array.isArray(list) ? list : []);
      await loadAll(hours);
      toast.success("同步完成");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "同步失败");
    } finally {
      setKumaBusy(false);
    }
  };

  const handleDeleteKuma = async (id: number) => {
    setKumaBusy(true);
    try {
      await deleteKumaSource(id);
      setKumaSources((prev) => prev.filter((item) => item.id !== id));
      await loadAll(hours);
      toast.success("已移除数据源");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "移除失败");
    } finally {
      setKumaBusy(false);
    }
  };

  const healthBanner = useMemo(() => {
    const status = summary?.health_status ?? "operational";
    if (status === "outage") {
      return {
        title: "部分服务出现中断",
        subtitle: `${summary?.down ?? 0} 个监控处于离线状态`,
        cls: "border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-100",
        Icon: AlertCircle,
        iconCls: "text-rose-500",
      };
    }
    if (status === "degraded") {
      return {
        title: "部分服务性能降级",
        subtitle: "存在延迟波动或异常响应",
        cls: "border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-100",
        Icon: AlertTriangle,
        iconCls: "text-amber-500",
      };
    }
    return {
      title: "所有服务运行正常",
      subtitle: summary
        ? `${summary.up} / ${summary.total} 项监控在线 · 平均延迟 ${formatLatency(summary.avg_latency_ms)}`
        : "正在连接实时状态监控...",
      cls: "border-[var(--hub-border)] bg-[var(--hub-surface)] text-[var(--hub-ink)]",
      Icon: CheckCircle2,
      iconCls: "text-emerald-500",
    };
  }, [summary]);

  const BannerIcon = healthBanner.Icon;

  return (
    <div className="space-y-6">
      {/* Top Operational Status Banner (OpenAI Service Health pattern) */}
      <div
        className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border px-5 py-4 ${healthBanner.cls}`}
      >
        <div className="flex items-center gap-3">
          <BannerIcon className={`h-5 w-5 shrink-0 ${healthBanner.iconCls}`} />
          <div>
            <h1 className="text-base font-semibold tracking-tight">
              {healthBanner.title}
            </h1>
            <p className="text-xs opacity-75 font-mono tabular-nums">
              {healthBanner.subtitle}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/60 dark:text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>

          <TimeRangePills hours={hours} onChange={setHours} />

          <button
            type="button"
            onClick={() => void loadAll(hours)}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2.5 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">刷新</span>
          </button>

          {isAdmin && (
            <>
              <button
                type="button"
                onClick={openKumaModal}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2.5 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)]"
              >
                <Activity className="h-3.5 w-3.5 text-emerald-600" />
                <span>Uptime Kuma 同步</span>
              </button>
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>新建监控</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Group Filter Pills */}
      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedGroup("all")}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              selectedGroup === "all"
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-[var(--hub-border)] bg-[var(--hub-surface)] text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
            }`}
          >
            全部 ({summary?.monitors.length ?? 0})
          </button>
          {groups.map((grp) => (
            <button
              key={grp}
              type="button"
              onClick={() => setSelectedGroup(grp)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                selectedGroup === grp
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-[var(--hub-border)] bg-[var(--hub-surface)] text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
              }`}
            >
              {grp}
            </button>
          ))}
        </div>
      )}

      {/* 12-Col Desktop Split: Left 8 Cols (Uptime Chart + Monitors), Right 4 Cols (Incident History) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-8">
          {/* Overall Uptime & Latency Area Chart */}
          <HubCard className="p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-xs font-medium text-[var(--hub-muted)]">
                  综合服务可用率
                </div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="text-3xl font-semibold tracking-tight font-mono tabular-nums text-[var(--hub-ink)]">
                    {summary ? `${summary.overall_uptime.toFixed(2)}%` : "--%"}
                  </span>
                  <span className="text-xs text-[var(--hub-muted)] font-mono tabular-nums">
                    平均延迟 {formatLatency(summary?.avg_latency_ms)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-[var(--hub-muted)]">
                <span className="text-emerald-600 dark:text-emerald-400">
                  正常 {summary?.up ?? 0}
                </span>
                <span className="text-rose-600 dark:text-rose-400">
                  异常 {summary?.down ?? 0}
                </span>
                <span>暂停 {summary?.paused ?? 0}</span>
              </div>
            </div>

            <div className="mt-4 h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={summary?.latency_series ?? []}
                  margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
                >
                  <defs>
                    <linearGradient id="uptime-latency-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--hub-border)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(val: string) => {
                      const d = new Date(val);
                      return Number.isNaN(d.getTime())
                        ? val
                        : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                    }}
                    tick={{ fontSize: 11, fill: "var(--hub-muted)" }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={28}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--hub-muted)" }}
                    axisLine={false}
                    tickLine={false}
                    unit="ms"
                  />
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const pt = payload[0]?.payload as {
                        t: string;
                        avg_ms: number;
                        up_rate: number;
                      };
                      return (
                        <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 shadow-xl font-mono tabular-nums">
                          <div className="text-[11px] text-zinc-400">
                            {new Date(pt.t).toLocaleString()}
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-4">
                            <span>平均延迟</span>
                            <span className="text-emerald-400">{pt.avg_ms} ms</span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span>可用率</span>
                            <span>{pt.up_rate?.toFixed(2) ?? "100.00"}%</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="avg_ms"
                    stroke="#10B981"
                    strokeWidth={1.8}
                    fill="url(#uptime-latency-fill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </HubCard>

          {/* Monitors List with 60-tick Heartbeat Bar */}
          {filteredMonitors.length === 0 && !loading ? (
            <HubEmptyState
              icon={Activity}
              title="暂无 Uptime 监控项目"
              description={
                isAdmin
                  ? "点击上方「新建监控」添加 HTTP/TCP/Ping 探测，或通过「Uptime Kuma 同步」接入已有状态页。"
                  : "管理员尚未配置服务可用性监控，登录后即可创建监控或同步外部 Uptime Kuma。"
              }
              action={
                isAdmin ? (
                  <button
                    type="button"
                    onClick={openCreateModal}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>创建第一个监控</span>
                  </button>
                ) : undefined
              }
            />
          ) : (
            <HubCard className="divide-y divide-[var(--hub-border)] overflow-hidden">
              {filteredMonitors.map((mon) => {
                const isExpanded = expandedId === mon.id;
                const StatusIcon = !mon.enabled
                  ? PauseCircle
                  : mon.status === 1
                    ? CheckCircle2
                    : mon.status === 0
                      ? AlertCircle
                      : AlertTriangle;
                const statusColor = !mon.enabled
                  ? "text-zinc-400"
                  : mon.status === 1
                    ? "text-emerald-500"
                    : mon.status === 0
                      ? "text-rose-500"
                      : "text-amber-500";
                const detailHistory = historyMap[mon.id] ?? mon.heartbeats ?? [];

                return (
                  <div key={mon.id} className="transition-colors">
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : mon.id)}
                      className="cursor-pointer px-5 py-4 hover:bg-[var(--hub-canvas)]/60"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-[var(--hub-muted)]" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-[var(--hub-muted)]" />
                          )}
                          <StatusIcon className={`h-4 w-4 shrink-0 ${statusColor}`} />
                          <span className="truncate text-sm font-medium text-[var(--hub-ink)]">
                            {mon.name}
                          </span>
                          <span className="rounded border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--hub-muted)]">
                            {mon.type}
                          </span>
                          {mon.source === "kuma" && (
                            <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300">
                              Kuma
                            </span>
                          )}
                          {mon.group && (
                            <span className="hidden sm:inline text-xs text-[var(--hub-muted)]">
                              {mon.group}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 font-mono tabular-nums text-xs">
                          <span className="text-[var(--hub-muted)]">
                            {formatLatency(mon.last_latency_ms)}
                          </span>
                          <span
                            className={`font-semibold ${
                              mon.uptime_24h >= 99
                                ? "text-emerald-600 dark:text-emerald-400"
                                : mon.uptime_24h >= 95
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-rose-600 dark:text-rose-400"
                            }`}
                          >
                            {mon.uptime_24h.toFixed(2)}%
                          </span>

                          {isAdmin && (
                            <div
                              className="flex items-center gap-1 border-l border-[var(--hub-border)] pl-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                disabled={busyActionId === mon.id}
                                onClick={() => void handleCheckNow(mon.id)}
                                title="立即检测"
                                className="rounded p-1 text-[var(--hub-muted)] hover:bg-[var(--hub-canvas)] hover:text-[var(--hub-ink)] disabled:opacity-50"
                              >
                                <Play className="h-3.5 w-3.5" />
                              </button>
                              {mon.source !== "kuma" && (
                                <button
                                  type="button"
                                  onClick={() => openEditModal(mon)}
                                  title="编辑"
                                  className="rounded p-1 text-[var(--hub-muted)] hover:bg-[var(--hub-canvas)] hover:text-[var(--hub-ink)]"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busyActionId === mon.id}
                                onClick={() => void handleDeleteMonitor(mon)}
                                title="删除"
                                className="rounded p-1 text-[var(--hub-muted)] hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/60"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 60-tick Heartbeat Bar */}
                      <div className="mt-3 pl-6">
                        <HeartbeatStrip heartbeats={mon.heartbeats} slots={60} heightClass="h-5" />
                      </div>
                    </div>

                    {/* Expanded Detail Panel */}
                    {isExpanded && (
                      <div className="border-t border-[var(--hub-border)] bg-[var(--hub-canvas)]/50 px-5 py-4 pl-11">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--hub-muted)]">
                          <div className="flex flex-wrap items-center gap-3 font-mono">
                            <span>目标: {mon.target || "--"}</span>
                            <span>间隔: {mon.interval_sec}s</span>
                            <span>30天可用率: {mon.uptime_30d?.toFixed(2) ?? "--"}%</span>
                            <span>最近消息: {mon.last_message || "OK"}</span>
                          </div>
                          <span className="font-mono tabular-nums">
                            最近检查 {formatRelativeTime(mon.last_checked_at)}
                          </span>
                        </div>

                        <div className="mt-3 h-32 w-full">
                          {historyLoading[mon.id] ? (
                            <div className="flex h-full items-center justify-center text-xs text-[var(--hub-muted)]">
                              加载详细延迟曲线中...
                            </div>
                          ) : (
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart
                                data={detailHistory}
                                margin={{ top: 6, right: 8, bottom: 0, left: -18 }}
                              >
                                <defs>
                                  <linearGradient
                                    id={`mon-fill-${mon.id}`}
                                    x1="0"
                                    y1="0"
                                    x2="0"
                                    y2="1"
                                  >
                                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.2} />
                                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid
                                  strokeDasharray="3 3"
                                  stroke="var(--hub-border)"
                                  vertical={false}
                                />
                                <XAxis
                                  dataKey="checked_at"
                                  tickFormatter={(v: string) =>
                                    new Date(v).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })
                                  }
                                  tick={{ fontSize: 10, fill: "var(--hub-muted)" }}
                                  axisLine={false}
                                  tickLine={false}
                                />
                                <YAxis
                                  tick={{ fontSize: 10, fill: "var(--hub-muted)" }}
                                  axisLine={false}
                                  tickLine={false}
                                  unit="ms"
                                />
                                <RechartsTooltip
                                  content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null;
                                    const pt = payload[0]?.payload as UptimeHeartbeat;
                                    return (
                                      <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[11px] font-mono text-zinc-100 shadow-lg">
                                        <div>{new Date(pt.checked_at).toLocaleString()}</div>
                                        <div className="mt-0.5 text-blue-400">
                                          {pt.latency_ms} ms · {pt.message}
                                        </div>
                                      </div>
                                    );
                                  }}
                                />
                                <Area
                                  type="monotone"
                                  dataKey="latency_ms"
                                  stroke="#2563EB"
                                  strokeWidth={1.6}
                                  fill={`url(#mon-fill-${mon.id})`}
                                  isAnimationActive={false}
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </HubCard>
          )}
        </div>

        {/* Right 4 Cols: Incident History Timeline */}
        <div className="lg:col-span-4">
          <HubCard className="p-5">
            <div className="flex items-center justify-between border-b border-[var(--hub-border)] pb-3">
              <h2 className="text-sm font-semibold text-[var(--hub-ink)]">
                事件历史 (Incidents)
              </h2>
              <span className="text-xs font-mono tabular-nums text-[var(--hub-muted)]">
                最近 {incidents.length} 条
              </span>
            </div>

            <div className="mt-3 space-y-4">
              {incidents.length === 0 ? (
                <div className="py-10 text-center text-xs text-[var(--hub-muted)]">
                  近期无中断或异常记录
                </div>
              ) : (
                incidents.map((inc) => {
                  const isResolved = inc.status === "resolved";
                  return (
                    <div
                      key={inc.id}
                      className="relative border-l border-[var(--hub-border)] pl-4"
                    >
                      <span
                        className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--hub-surface)] ${
                          isResolved ? "bg-emerald-500" : "bg-rose-500"
                        }`}
                      />
                      <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--hub-muted)] font-mono tabular-nums">
                        <span>{new Date(inc.started_at).toLocaleString()}</span>
                        {inc.duration_sec !== undefined && inc.duration_sec > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDurationCompact(inc.duration_sec)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-[var(--hub-ink)]">
                        {inc.monitor_name}
                        <span
                          className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            isResolved
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                              : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                          }`}
                        >
                          {isResolved ? "已恢复" : "故障中"}
                        </span>
                      </div>
                      {inc.message && (
                        <p className="mt-0.5 text-xs text-[var(--hub-muted)] break-all">
                          {inc.message}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </HubCard>
        </div>
      </div>

      {/* Create / Edit Monitor Modal */}
      {monitorModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-[2px]"
          onClick={() => setMonitorModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--hub-border)] pb-3">
              <h3 className="text-sm font-semibold text-[var(--hub-ink)]">
                {editingMonitor ? "编辑监控项" : "新建 Uptime 监控"}
              </h3>
              <button
                type="button"
                onClick={() => setMonitorModalOpen(false)}
                className="rounded p-1 text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveMonitor} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="mb-1 block font-medium text-[var(--hub-ink)]">
                  监控名称
                </label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="例如：Personal Blog"
                  className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 py-2 text-sm text-[var(--hub-ink)] focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-medium text-[var(--hub-ink)]">
                    探测协议
                  </label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 py-2 text-sm text-[var(--hub-ink)]"
                  >
                    <option value="http">HTTP / HTTPS</option>
                    <option value="keyword">HTTP 关键词</option>
                    <option value="tcp">TCP 端口</option>
                    <option value="ping">ICMP Ping</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[var(--hub-ink)]">
                    分组
                  </label>
                  <input
                    value={form.group}
                    onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
                    placeholder="Web / API"
                    className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 py-2 text-sm text-[var(--hub-ink)]"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block font-medium text-[var(--hub-ink)]">
                  目标地址 (URL 或 host:port)
                </label>
                <input
                  required
                  value={form.target}
                  onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
                  placeholder={
                    form.type === "tcp"
                      ? "1.2.3.4:443"
                      : form.type === "ping"
                        ? "1.1.1.1"
                        : "https://example.com"
                  }
                  className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 py-2 font-mono text-sm text-[var(--hub-ink)]"
                />
              </div>

              {form.type === "keyword" && (
                <div>
                  <label className="mb-1 block font-medium text-[var(--hub-ink)]">
                    期望包含关键词
                  </label>
                  <input
                    value={form.keyword || ""}
                    onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value }))}
                    placeholder="ok / healthy"
                    className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 py-2 text-sm text-[var(--hub-ink)]"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-medium text-[var(--hub-ink)]">
                    检查间隔 (秒)
                  </label>
                  <input
                    type="number"
                    min={10}
                    value={form.interval_sec}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, interval_sec: Number(e.target.value) || 60 }))
                    }
                    className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 py-2 font-mono text-sm text-[var(--hub-ink)]"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[var(--hub-ink)]">
                    超时时间 (秒)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={form.timeout_sec}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, timeout_sec: Number(e.target.value) || 10 }))
                    }
                    className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 py-2 font-mono text-sm text-[var(--hub-ink)]"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                />
                <span className="text-[var(--hub-ink)]">启用定时探测</span>
              </label>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setMonitorModalOpen(false)}
                  className="rounded-lg border border-[var(--hub-border)] px-3 py-1.5 text-xs font-medium text-[var(--hub-ink)]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={savingMonitor}
                  className="rounded-lg bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {savingMonitor ? "保存中..." : "保存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* External Uptime Kuma Sync Modal */}
      {kumaModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-[2px]"
          onClick={() => setKumaModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--hub-border)] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--hub-ink)]">
                  外部 Uptime Kuma 状态页同步
                </h3>
                <p className="text-xs text-[var(--hub-muted)]">
                  填写 Uptime Kuma 基础地址与公开 Status Page Slug，自动拉取监控状态与心跳
                </p>
              </div>
              <button
                type="button"
                onClick={() => setKumaModalOpen(false)}
                className="rounded p-1 text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddKuma} className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3 text-xs">
              <input
                required
                placeholder="数据源名称"
                value={kumaForm.name}
                onChange={(e) => setKumaForm((f) => ({ ...f, name: e.target.value }))}
                className="rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2.5 py-2 text-[var(--hub-ink)]"
              />
              <input
                required
                placeholder="https://status.example.com"
                value={kumaForm.base_url}
                onChange={(e) => setKumaForm((f) => ({ ...f, base_url: e.target.value }))}
                className="rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2.5 py-2 font-mono text-[var(--hub-ink)]"
              />
              <div className="flex gap-2">
                <input
                  required
                  placeholder="slug (如 default)"
                  value={kumaForm.slug}
                  onChange={(e) => setKumaForm((f) => ({ ...f, slug: e.target.value }))}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2.5 py-2 font-mono text-[var(--hub-ink)]"
                />
                <button
                  type="submit"
                  disabled={kumaBusy}
                  className="shrink-0 rounded-lg bg-zinc-900 px-3 py-2 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  添加
                </button>
              </div>
            </form>

            <div className="mt-4 max-h-60 divide-y divide-[var(--hub-border)] overflow-y-auto rounded-lg border border-[var(--hub-border)]">
              {kumaSources.length === 0 ? (
                <div className="py-6 text-center text-xs text-[var(--hub-muted)]">
                  尚未配置外部 Uptime Kuma 状态页
                </div>
              ) : (
                kumaSources.map((src) => (
                  <div
                    key={src.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--hub-ink)]">{src.name}</div>
                      <div className="truncate font-mono text-[11px] text-[var(--hub-muted)]">
                        {src.base_url}/status/{src.slug}
                      </div>
                      {src.last_error && (
                        <div className="text-[11px] text-rose-500">{src.last_error}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        disabled={kumaBusy}
                        onClick={() => void handleSyncKuma(src.id)}
                        className="rounded-md border border-[var(--hub-border)] px-2 py-1 text-[11px] font-medium hover:bg-[var(--hub-canvas)]"
                      >
                        同步
                      </button>
                      <button
                        type="button"
                        disabled={kumaBusy}
                        onClick={() => void handleDeleteKuma(src.id)}
                        className="rounded-md p-1 text-[var(--hub-muted)] hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const UptimePage: React.FC = () => (
  <AccountProvider>
    <UptimePageInner />
  </AccountProvider>
);

export default UptimePage;
