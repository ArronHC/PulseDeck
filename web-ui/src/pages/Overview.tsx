import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock,
  Globe,
  RefreshCw,
  Server,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { fetchOverview, formatExpiryCountdown, formatLatency, formatRelativeTime, getFraudTier } from "@/lib/hubApi";
import type { OverviewData } from "@/types/hub";
import { formatBytes, formatSpeed } from "@/utils/unitHelper";
import { countryCodeToFlagEmoji } from "@/utils/regionCode";
import Flag from "@/components/Flag";
import { HeartbeatStrip, HubCard, TimeRangePills } from "@/components/hub/HubUi";
import { WorldMapCard } from "@/components/hub/WorldMapCard";

const SparklineCard: React.FC<{
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  primaryLabel: string;
  primaryValue: string;
  secondaryLabel: string;
  secondaryValue: string;
  sparkline: Array<{ t: string; v: number }>;
  strokeColor: string;
  fillId: string;
  unit?: string;
  onClick: () => void;
}> = ({
  title,
  icon: Icon,
  primaryLabel,
  primaryValue,
  secondaryLabel,
  secondaryValue,
  sparkline,
  strokeColor,
  fillId,
  unit = "",
  onClick,
}) => {
  const chartData = useMemo(() => {
    if (sparkline && sparkline.length > 1) return sparkline;
    const base = sparkline?.[0]?.v ?? 0;
    return [
      { t: "0", v: base },
      { t: "1", v: base },
    ];
  }, [sparkline]);

  return (
    <HubCard
      onClick={onClick}
      className="flex flex-col justify-between overflow-hidden p-5 hover:shadow-xs"
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--hub-muted)]">
            <Icon className="h-4 w-4 text-[var(--hub-ink)]" />
            <span>{title}</span>
          </div>
          <ArrowRight className="h-3.5 w-3.5 text-[var(--hub-muted)]" />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] text-[var(--hub-muted)]">{primaryLabel}</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight font-mono tabular-nums text-[var(--hub-ink)]">
              {primaryValue}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[var(--hub-muted)]">{secondaryLabel}</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight font-mono tabular-nums text-[var(--hub-ink)]">
              {secondaryValue}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 h-14 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={strokeColor} stopOpacity={0.22} />
                <stop offset="95%" stopColor={strokeColor} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <RechartsTooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const val = payload[0]?.value;
                return (
                  <div className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] font-mono tabular-nums text-zinc-100 shadow-lg">
                    {typeof val === "number" ? `${val.toFixed(1)}${unit}` : val}
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="v"
              stroke={strokeColor}
              strokeWidth={1.75}
              fill={`url(#${fillId})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </HubCard>
  );
};

const Overview: React.FC = () => {
  const navigate = useNavigate();
  const [hours, setHours] = useState<number>(24);
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (h: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOverview(h);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载总览数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(hours);
  }, [hours, load]);

  const probes = data?.probes;
  const uptime = data?.uptime;
  const subs = data?.subscriptions;
  const events = data?.recent_events ?? [];

  const mapCountries = useMemo(
    () =>
      (subs?.country_counts ?? []).map((c) => ({
        country_code: c.country_code,
        country_name: c.country_name,
        lat: c.lat,
        lng: c.lng,
        node_count: c.count,
        available_count: c.count,
        min_latency_ms: c.min_latency_ms,
        avg_latency_ms: c.min_latency_ms,
        avg_fraud_score: c.avg_fraud_score,
        residential_count: 0,
      })),
    [subs?.country_counts],
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--hub-ink)]">
            系统总览
          </h1>
          <p className="mt-0.5 text-xs text-[var(--hub-muted)] font-mono tabular-nums">
            {data?.updated_at
              ? `更新于 ${formatRelativeTime(data.updated_at)}`
              : "实时汇总探针服务器、服务可用性与订阅节点健康度"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <TimeRangePills hours={hours} onChange={setHours} />
          <button
            type="button"
            onClick={() => void load(hours)}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-ink)] transition-colors hover:bg-[var(--hub-canvas)] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>刷新</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200">
          <span>无法连接总览接口 ({error})，部分卡片显示占位状态。</span>
          <button
            type="button"
            onClick={() => void load(hours)}
            className="font-medium underline"
          >
            重试
          </button>
        </div>
      )}

      {/* Row 1: 3 Bento KPI Cards (Cloudflare Pattern) */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SparklineCard
          title="服务器探针"
          icon={Server}
          primaryLabel="在线 / 总数"
          primaryValue={probes ? `${probes.online} / ${probes.total}` : "-- / --"}
          secondaryLabel="平均 CPU / 内存"
          secondaryValue={
            probes
              ? `${probes.avg_cpu.toFixed(0)}% · ${probes.avg_mem_percent.toFixed(0)}%`
              : "--%"
          }
          sparkline={probes?.sparkline ?? []}
          strokeColor="#2563EB"
          fillId="hub-spark-probes"
          unit="%"
          onClick={() => navigate("/servers")}
        />

        <SparklineCard
          title="服务可用性"
          icon={Activity}
          primaryLabel={`${hours >= 24 ? "24h " : ""}可用率`}
          primaryValue={uptime ? `${uptime.overall_uptime_24h.toFixed(2)}%` : "--%"}
          secondaryLabel="平均响应延迟"
          secondaryValue={uptime ? formatLatency(uptime.avg_latency_ms) : "--"}
          sparkline={uptime?.sparkline ?? []}
          strokeColor="#10B981"
          fillId="hub-spark-uptime"
          unit="ms"
          onClick={() => navigate("/uptime")}
        />

        <SparklineCard
          title="订阅与节点"
          icon={Globe}
          primaryLabel="可用 / 总节点"
          primaryValue={
            subs ? `${subs.available_nodes} / ${subs.total_nodes}` : "-- / --"
          }
          secondaryLabel="纯净 / 住宅节点"
          secondaryValue={
            subs ? `${subs.pure_nodes} · ${subs.residential_nodes}` : "--"
          }
          sparkline={subs?.sparkline ?? []}
          strokeColor="#3B82F6"
          fillId="hub-spark-subs"
          unit="ms"
          onClick={() => navigate("/subscriptions")}
        />
      </div>

      {/* Row 2: 3 Module Summary Bento Cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 1. Probe Nodes Summary */}
        <HubCard className="flex flex-col p-5">
          <div className="flex items-center justify-between border-b border-[var(--hub-border)] pb-3">
            <button
              type="button"
              onClick={() => navigate("/servers")}
              className="flex items-center gap-2 text-sm font-semibold text-[var(--hub-ink)] hover:underline"
            >
              <Server className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>探针节点速览</span>
            </button>
            <button
              type="button"
              onClick={() => navigate("/servers")}
              className="text-xs text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
            >
              全部 →
            </button>
          </div>

          <div className="mt-3 flex-1 space-y-2.5">
            {probes?.top_nodes && probes.top_nodes.length > 0 ? (
              probes.top_nodes.slice(0, 5).map((node) => (
                <div
                  key={node.uuid}
                  onClick={() => navigate(`/instance/${node.uuid}`)}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--hub-canvas)]"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        node.online ? "bg-emerald-500" : "bg-rose-500"
                      }`}
                    />
                    <div className="scale-75 -mx-1 shrink-0">
                      <Flag flag={node.region} />
                    </div>
                    <span className="truncate text-xs font-medium text-[var(--hub-ink)]">
                      {node.name}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-3 text-[11px] font-mono tabular-nums text-[var(--hub-muted)]">
                    <div className="hidden sm:flex items-center gap-1.5">
                      <span>C {node.cpu.toFixed(0)}%</span>
                      <div className="h-1.5 w-10 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${Math.min(100, Math.max(0, node.cpu))}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span>M {node.mem_percent.toFixed(0)}%</span>
                      <div className="h-1.5 w-10 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{
                            width: `${Math.min(100, Math.max(0, node.mem_percent))}%`,
                          }}
                        />
                      </div>
                    </div>
                    <span className="w-16 text-right">
                      ↓{formatSpeed(node.net_in)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-xs text-[var(--hub-muted)]">
                暂无在线探针节点
              </div>
            )}
          </div>
        </HubCard>

        {/* 2. Uptime Monitors Summary */}
        <HubCard className="flex flex-col p-5">
          <div className="flex items-center justify-between border-b border-[var(--hub-border)] pb-3">
            <button
              type="button"
              onClick={() => navigate("/uptime")}
              className="flex items-center gap-2 text-sm font-semibold text-[var(--hub-ink)] hover:underline"
            >
              <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>Uptime 监控速览</span>
            </button>
            <button
              type="button"
              onClick={() => navigate("/uptime")}
              className="text-xs text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
            >
              全部 →
            </button>
          </div>

          <div className="mt-3 flex-1 space-y-3">
            {uptime?.top_monitors && uptime.top_monitors.length > 0 ? (
              uptime.top_monitors.slice(0, 5).map((mon) => {
                const StatusIcon =
                  mon.status === 1
                    ? CheckCircle2
                    : mon.status === 0
                      ? AlertCircle
                      : AlertTriangle;
                const iconColor =
                  mon.status === 1
                    ? "text-emerald-500"
                    : mon.status === 0
                      ? "text-rose-500"
                      : "text-amber-500";
                return (
                  <div
                    key={mon.id}
                    onClick={() => navigate(`/uptime?monitor=${mon.id}`)}
                    className="cursor-pointer rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--hub-canvas)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} />
                        <span className="truncate text-xs font-medium text-[var(--hub-ink)]">
                          {mon.name}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 font-mono tabular-nums text-[11px]">
                        <span className="text-[var(--hub-muted)]">
                          {formatLatency(mon.latency_ms)}
                        </span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {mon.uptime_24h.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div className="mt-1.5">
                      <HeartbeatStrip
                        compactBeats={mon.recent_beats}
                        slots={20}
                        heightClass="h-2.5"
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-8 text-center text-xs text-[var(--hub-muted)]">
                暂无 Uptime 监控项
              </div>
            )}
          </div>
        </HubCard>

        {/* 3. Subscriptions & Purity Summary */}
        <HubCard className="flex flex-col p-5">
          <div className="flex items-center justify-between border-b border-[var(--hub-border)] pb-3">
            <button
              type="button"
              onClick={() => navigate("/subscriptions")}
              className="flex items-center gap-2 text-sm font-semibold text-[var(--hub-ink)] hover:underline"
            >
              <ShieldCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>订阅流量与节点健康</span>
            </button>
            <button
              type="button"
              onClick={() => navigate("/subscriptions")}
              className="text-xs text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
            >
              全部 →
            </button>
          </div>

          <div className="mt-3 flex-1 space-y-3">
            {subs?.items && subs.items.length > 0 ? (
              subs.items.slice(0, 4).map((sub) => {
                const used = (sub.upload || 0) + (sub.download || 0);
                const pct =
                  sub.total > 0 ? Math.min(100, (used / sub.total) * 100) : 0;
                const expiry = formatExpiryCountdown(sub.expire);
                const tier = getFraudTier(sub.best_fraud_score);
                return (
                  <div
                    key={sub.id}
                    onClick={() => navigate("/subscriptions")}
                    className="cursor-pointer rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] p-2.5 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-[var(--hub-ink)]">
                        {sub.name}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          expiry.urgent
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                            : "bg-zinc-200/70 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        }`}
                      >
                        {expiry.text}
                      </span>
                    </div>

                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-blue-600 dark:bg-blue-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono tabular-nums text-[var(--hub-muted)]">
                      <span>
                        {sub.total > 0
                          ? `${formatBytes(used)} / ${formatBytes(sub.total)}`
                          : `${sub.node_count} 节点`}
                      </span>
                      <span className="flex items-center gap-2">
                        <span>最低 {formatLatency(sub.min_latency_ms)}</span>
                        <span className="inline-flex items-center gap-1">
                          <span className={`h-1.5 w-1.5 rounded-full ${tier.dotClass}`} />
                          {sub.best_fraud_score >= 0 ? sub.best_fraud_score : "--"}
                        </span>
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-8 text-center text-xs text-[var(--hub-muted)]">
                暂无订阅或节点数据
              </div>
            )}
          </div>
        </HubCard>
      </div>

      {/* Row 3: Recent Events Timeline (Left) + World Distribution Preview (Right) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <HubCard className="p-5 lg:col-span-6">
          <div className="flex items-center justify-between border-b border-[var(--hub-border)] pb-3">
            <h2 className="text-sm font-semibold text-[var(--hub-ink)]">
              最近动态与事件时间线
            </h2>
            <span className="text-xs text-[var(--hub-muted)] font-mono tabular-nums">
              {events.length} 条记录
            </span>
          </div>

          <div className="mt-3 divide-y divide-[var(--hub-border)]">
            {events.length > 0 ? (
              events.slice(0, 7).map((evt) => {
                const dotColor =
                  evt.severity === "error"
                    ? "bg-rose-500"
                    : evt.severity === "warning"
                      ? "bg-amber-500"
                      : "bg-emerald-500";
                return (
                  <div key={evt.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-xs font-medium text-[var(--hub-ink)]">
                            {evt.title}
                          </span>
                          <span className="rounded border border-[var(--hub-border)] px-1.5 py-0 text-[10px] uppercase text-[var(--hub-muted)]">
                            {evt.source}
                          </span>
                        </div>
                        {evt.detail && (
                          <div className="mt-0.5 truncate text-xs text-[var(--hub-muted)]">
                            {evt.detail}
                          </div>
                        )}
                      </div>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-[11px] font-mono tabular-nums text-[var(--hub-muted)]">
                      <Clock className="h-3 w-3" />
                      {formatRelativeTime(evt.created_at)}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="py-10 text-center text-xs text-[var(--hub-muted)]">
                暂无告警或状态变更事件，所有服务运行平稳
              </div>
            )}
          </div>
        </HubCard>

        <HubCard className="p-5 lg:col-span-6">
          <div className="flex items-center justify-between border-b border-[var(--hub-border)] pb-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--hub-ink)]">
                全球节点分布预览
              </h2>
              <p className="text-xs text-[var(--hub-muted)]">
                点击地图进入订阅节点延迟与 IPPure 纯净度分析
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/subscriptions")}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              <span>完整地图</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3">
            <WorldMapCard
              countries={mapCountries}
              compact
              onClickCompact={() => navigate("/subscriptions")}
            />
          </div>

          {mapCountries.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {mapCountries.slice(0, 6).map((c) => (
                <button
                  key={c.country_code}
                  type="button"
                  onClick={() =>
                    navigate(`/subscriptions?country=${encodeURIComponent(c.country_code)}`)
                  }
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2.5 py-1 text-[11px] font-mono tabular-nums text-[var(--hub-ink)] hover:border-zinc-300 dark:hover:border-zinc-700"
                >
                  <span>{countryCodeToFlagEmoji(c.country_code)}</span>
                  <span>{c.country_name || c.country_code}</span>
                  <span className="text-[var(--hub-muted)]">{c.node_count}</span>
                </button>
              ))}
            </div>
          )}
        </HubCard>
      </div>
    </div>
  );
};

export default Overview;
