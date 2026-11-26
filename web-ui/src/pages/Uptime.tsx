import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  LogIn,
  PauseCircle,
  RefreshCw,
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
  fetchUptimeIncidents,
  fetchUptimeMonitorHistory,
  fetchUptimeSummary,
  formatDurationCompact,
  formatLatency,
  formatRelativeTime,
} from "@/lib/hubApi";
import type {
  UptimeHeartbeat,
  UptimeIncident,
  UptimeSummaryData,
} from "@/types/hub";
import {
  HeartbeatStrip,
  HubCard,
  HubEmptyState,
  TimeRangePills,
} from "@/components/hub/HubUi";
import { loginPath } from "@/utils/loginRedirect";
import { toast } from "sonner";

const UptimePageInner: React.FC = () => {
  const { t } = useTranslation();
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
      toast.error(err instanceof Error ? err.message : t("pulse.uptime.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
        toast.error(err instanceof Error ? err.message : t("pulse.uptime.historyFailed"));
      } finally {
        setHistoryLoading((prev) => ({ ...prev, [id]: false }));
      }
    },
    [t],
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
    return list.filter((m) => (m.group || t("pulse.common.defaultGroup")) === selectedGroup);
  }, [summary?.monitors, selectedGroup, t]);

  const healthBanner = useMemo(() => {
    const status = summary?.health_status ?? "operational";
    if (status === "outage") {
      return {
        title: t("pulse.uptime.bannerOutageTitle"),
        subtitle: t("pulse.uptime.bannerOutageSubtitle", { count: summary?.down ?? 0 }),
        cls: "border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-100",
        Icon: AlertCircle,
        iconCls: "text-rose-500",
      };
    }
    if (status === "degraded") {
      return {
        title: t("pulse.uptime.bannerDegradedTitle"),
        subtitle: t("pulse.uptime.bannerDegradedSubtitle"),
        cls: "border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-100",
        Icon: AlertTriangle,
        iconCls: "text-amber-500",
      };
    }
    return {
      title: t("pulse.uptime.bannerOperationalTitle"),
      subtitle: summary
        ? t("pulse.uptime.bannerOperationalSubtitle", {
            up: summary.up,
            total: summary.total,
            latency: formatLatency(summary.avg_latency_ms),
          })
        : t("pulse.uptime.connecting"),
      cls: "border-[var(--hub-border)] bg-[var(--hub-surface)] text-[var(--hub-ink)]",
      Icon: CheckCircle2,
      iconCls: "text-emerald-500",
    };
  }, [summary, t]);

  const BannerIcon = healthBanner.Icon;

  return (
    <div className="space-y-6">
      {/* Top Operational Status Banner (Read-Only Observability) */}
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
            {t("pulse.health.live")}
          </span>

          <TimeRangePills hours={hours} onChange={setHours} />

          <button
            type="button"
            onClick={() => void loadAll(hours)}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2.5 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{t("pulse.common.refresh")}</span>
          </button>

          {isAdmin && (
            <Link
              to="/admin/uptime"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-ink)] no-underline transition-colors hover:bg-[var(--hub-canvas)]"
            >
              <span>{t("pulse.uptime.manageMonitors")}</span>
              <ArrowRight className="h-3.5 w-3.5 text-[var(--hub-muted)]" />
            </Link>
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
            {t("pulse.uptime.allCount", { count: summary?.monitors.length ?? 0 })}
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
                  {t("pulse.uptime.overallUptime")}
                </div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="text-3xl font-semibold tracking-tight font-mono tabular-nums text-[var(--hub-ink)]">
                    {summary ? `${summary.overall_uptime.toFixed(2)}%` : "--%"}
                  </span>
                  <span className="text-xs text-[var(--hub-muted)] font-mono tabular-nums">
                    {t("pulse.uptime.avgLatencyLabel", {
                      latency: formatLatency(summary?.avg_latency_ms),
                    })}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-[var(--hub-muted)]">
                <span className="text-emerald-600 dark:text-emerald-400">
                  {t("pulse.uptime.upCount", { count: summary?.up ?? 0 })}
                </span>
                <span className="text-rose-600 dark:text-rose-400">
                  {t("pulse.uptime.downCount", { count: summary?.down ?? 0 })}
                </span>
                <span>{t("pulse.uptime.pausedCount", { count: summary?.paused ?? 0 })}</span>
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
                            <span>{t("pulse.uptime.tooltipAvgLatency")}</span>
                            <span className="text-emerald-400">{pt.avg_ms} ms</span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span>{t("pulse.uptime.tooltipUptime")}</span>
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
              title={t("pulse.uptime.emptyTitle")}
              description={
                isAdmin
                  ? t("pulse.uptime.emptyAdminDesc")
                  : t("pulse.uptime.emptyGuestDesc")
              }
              action={
                isAdmin ? (
                  <Link
                    to="/admin/uptime"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 text-xs font-medium text-white no-underline hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    <span>{t("pulse.uptime.goToConfig")}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                ) : (
                  <Link
                    to={loginPath("/admin/uptime")}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-ink)] no-underline hover:bg-[var(--hub-canvas)]"
                  >
                    <LogIn className="h-3.5 w-3.5" />
                    <span>{t("pulse.common.adminLogin")}</span>
                  </Link>
                )
              }
            />
          ) : (
            <HubCard className="divide-y divide-[var(--hub-border)]">
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
                            <span>{t("pulse.uptime.target")}: {mon.target || "--"}</span>
                            <span>{t("pulse.uptime.interval")}: {mon.interval_sec}s</span>
                            <span>{t("pulse.uptime.uptime30d")}: {mon.uptime_30d?.toFixed(2) ?? "--"}%</span>
                            <span>{t("pulse.uptime.lastMessage")}: {mon.last_message || "OK"}</span>
                          </div>
                          <span className="font-mono tabular-nums">
                            {t("pulse.uptime.lastChecked", {
                              time: formatRelativeTime(mon.last_checked_at),
                            })}
                          </span>
                        </div>

                        <div className="mt-3 h-32 w-full">
                          {historyLoading[mon.id] ? (
                            <div className="flex h-full items-center justify-center text-xs text-[var(--hub-muted)]">
                              {t("pulse.uptime.loadingHistory")}
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
                {t("pulse.uptime.incidentsTitle")}
              </h2>
              <span className="text-xs font-mono tabular-nums text-[var(--hub-muted)]">
                {t("pulse.uptime.incidentsCount", { count: incidents.length })}
              </span>
            </div>

            <div className="mt-3 space-y-4">
              {incidents.length === 0 ? (
                <div className="py-10 text-center text-xs text-[var(--hub-muted)]">
                  {t("pulse.uptime.noIncidents")}
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
                          {isResolved ? t("pulse.uptime.resolved") : t("pulse.uptime.ongoing")}
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
    </div>
  );
};

const UptimePage: React.FC = () => (
  <AccountProvider>
    <UptimePageInner />
  </AccountProvider>
);

export default UptimePage;
