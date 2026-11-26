import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  Compass,
  Database,
  Globe,
  HardDrive,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  fetchAdminOnboarding,
  fetchOverview,
  formatLatency,
  formatRelativeTime,
  updateAdminOnboarding,
} from "@/lib/hubApi";
import { api } from "@/lib/http";
import type { AdminOnboardingState, OverviewData } from "@/types/hub";
import { formatBytes, formatSpeed } from "@/utils/unitHelper";
import { PULSE_ONBOARDING_EVENT } from "@/components/admin/PulseAdminShell";
import { toast } from "sonner";

interface DatabaseSizePayload {
  main?: { driver?: string; location?: string; size?: number | null };
  monitoring?: { driver?: string; location?: string; size?: number | null };
  local_total?: number | null;
}

const WALKTHROUGH_STEPS = [
  {
    title: "认识 PulseDeck 前后台分离架构",
    subtitle: "只读观测在前台，资产配置收口在后台",
    description:
      "PulseDeck 将公开可观测状态页（总览、服务器探针、服务状态、订阅分布地图）设为严格只读；所有节点接入、监控创建、订阅导入、测速与告警规则均统一在管理后台集中管理。",
    highlights: [
      "前台状态页零管理弹窗，访客与团队成员可安全浏览",
      "支持服务器探针、Uptime 监控、代理订阅三大核心模块",
      "支持多渠道告警通知、审计日志与远程命令执行",
    ],
    ctaLabel: "查看系统设置",
    ctaTo: "/admin/settings/site",
    icon: Sparkles,
  },
  {
    title: "添加服务器探针节点",
    subtitle: "一键安装 Agent 或启用自动发现",
    description:
      "前往「服务器探针」页面添加主机节点，复制生成的安装命令在目标服务器执行即可上线；若需批量接入多台机器，可在常规设置中开启「自动发现密钥」。",
    highlights: [
      "支持 Linux / Windows / macOS / Docker 一键部署",
      "实时汇报 CPU、内存、磁盘、网络速率与 Ping 延迟",
      "支持流量配额统计与账单到期提醒",
    ],
    ctaLabel: "前往添加服务器",
    ctaTo: "/admin/servers",
    icon: Server,
  },
  {
    title: "添加服务可用性监控",
    subtitle: "HTTP / Keyword / TCP / Ping 与 Uptime Kuma 同步",
    description:
      "在「服务状态监控」中添加需要巡检的网站、API 或端口，或直接接入外部 Uptime Kuma 公开状态页，后台会自动定时探测并生成 60 格心跳条与故障时间线。",
    highlights: [
      "支持 HTTP 状态码、响应关键词、TCP 端口与 ICMP Ping",
      "可同步外部 Uptime Kuma 实例，统一汇总状态视图",
      "支持立即探测、暂停/恢复与历史延迟曲线分析",
    ],
    ctaLabel: "前往配置监控",
    ctaTo: "/admin/uptime",
    icon: Activity,
  },
  {
    title: "导入代理订阅与测速 / 纯净度",
    subtitle: "全球节点分布地图与 IPPure 风险评估",
    description:
      "在「订阅与节点」中导入机场订阅链接（支持 Clash / Base64）或手动粘贴节点分享链接，即可一键并发测速、检测 IPPure 欺诈评分与住宅/原生属性。",
    highlights: [
      "订阅链接敏感参数仅后台可见，前台严格脱敏展示",
      "支持批量延迟测速与单节点 IPPure 住宅/广播 IP 识别",
      "可手动校正节点归属国家、城市与地图坐标",
    ],
    ctaLabel: "前往管理订阅",
    ctaTo: "/admin/subscriptions",
    icon: Globe,
  },
];

export default function AdminOverviewPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [onboarding, setOnboarding] = useState<AdminOnboardingState | null>(null);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [dbSize, setDbSize] = useState<DatabaseSizePayload | null>(null);
  const [loading, setLoading] = useState(true);

  // Walkthrough modal state
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const [savingGuide, setSavingGuide] = useState(false);
  const [autoOpenedOnce, setAutoOpenedOnce] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [obRes, ovRes, dbRes] = await Promise.all([
        fetchAdminOnboarding().catch(() => null),
        fetchOverview(24).catch(() => null),
        api
          .getData<DatabaseSizePayload>("/api/admin/database/size")
          .catch(() => null),
      ]);
      if (obRes) {
        setOnboarding(obRes);
        setGuideStep(
          Math.max(0, Math.min(WALKTHROUGH_STEPS.length - 1, obRes.current_step || 0)),
        );
      }
      if (ovRes) setOverview(ovRes);
      if (dbRes) setDbSize(dbRes);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Auto-open walkthrough once on first visit when not completed and not dismissed
  useEffect(() => {
    if (!onboarding || autoOpenedOnce) return;
    setAutoOpenedOnce(true);
    if (!onboarding.completed && !onboarding.dismissed) {
      setGuideOpen(true);
    }
  }, [onboarding, autoOpenedOnce]);

  // Open walkthrough if URL contains ?guide=1
  useEffect(() => {
    if (searchParams.get("guide") === "1") {
      setGuideOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("guide");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Listen to header "新手引导" button event
  useEffect(() => {
    const handler = () => {
      setGuideStep(0);
      setGuideOpen(true);
    };
    window.addEventListener(PULSE_ONBOARDING_EVENT, handler);
    return () => window.removeEventListener(PULSE_ONBOARDING_EVENT, handler);
  }, []);

  const persistOnboarding = async (
    payload: Parameters<typeof updateAdminOnboarding>[0],
    silent = false,
  ) => {
    setSavingGuide(true);
    try {
      const updated = await updateAdminOnboarding(payload);
      setOnboarding(updated);
      return updated;
    } catch (err) {
      if (!silent) {
        toast.error(err instanceof Error ? err.message : "更新引导状态失败");
      }
      return null;
    } finally {
      setSavingGuide(false);
    }
  };

  const handleStepChange = (nextIdx: number) => {
    const clamped = Math.max(0, Math.min(WALKTHROUGH_STEPS.length - 1, nextIdx));
    setGuideStep(clamped);
    void persistOnboarding({ current_step: clamped }, true);
  };

  const handleCompleteGuide = async () => {
    const updated = await persistOnboarding({ completed: true, dismissed: false });
    if (updated) {
      toast.success("已完成新手引导");
      setGuideOpen(false);
    }
  };

  const handleDismissGuide = async () => {
    const updated = await persistOnboarding({ dismissed: true });
    if (updated) {
      setGuideOpen(false);
    }
  };

  const checklistItems = useMemo(() => {
    const counts = onboarding?.counts;
    const steps = onboarding?.steps;
    return [
      {
        key: "add_server",
        title: "添加服务器探针节点",
        detail:
          counts && counts.servers > 0
            ? `已接入 ${counts.servers} 台服务器`
            : "生成 Agent 安装命令或配置自动发现密钥",
        done: Boolean(steps?.add_server),
        to: "/admin/servers",
        icon: Server,
      },
      {
        key: "add_uptime",
        title: "添加服务可用性监控",
        detail:
          counts && counts.uptime_monitors > 0
            ? `已配置 ${counts.uptime_monitors} 项监控`
            : "创建 HTTP/TCP/Ping 探测或同步 Uptime Kuma",
        done: Boolean(steps?.add_uptime),
        to: "/admin/uptime",
        icon: Activity,
      },
      {
        key: "add_subscription",
        title: "导入代理订阅与节点",
        detail:
          counts && counts.subscriptions > 0
            ? `已导入 ${counts.subscriptions} 个订阅 · ${counts.subscription_nodes} 个节点`
            : "导入订阅链接或手动节点，开启测速与 IPPure 检测",
        done: Boolean(steps?.add_subscription),
        to: "/admin/subscriptions",
        icon: Globe,
      },
      {
        key: "configure_alerts",
        title: "配置通知与告警渠道",
        detail: steps?.configure_alerts
          ? "已启用告警通知渠道"
          : "绑定 Telegram / Webhook / Email 等告警通道",
        done: Boolean(steps?.configure_alerts),
        to: "/admin/notification/channels",
        icon: Bell,
      },
    ];
  }, [onboarding]);

  const completedChecklistCount = checklistItems.filter((item) => item.done).length;
  const showChecklist =
    onboarding && !onboarding.completed && !onboarding.dismissed;

  const probes = overview?.probes;
  const uptime = overview?.uptime;
  const subs = overview?.subscriptions;
  const events = overview?.recent_events ?? [];

  const activeWalkthrough = WALKTHROUGH_STEPS[guideStep] ?? WALKTHROUGH_STEPS[0];
  const WalkthroughIcon = activeWalkthrough.icon;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--hub-ink)]">
            控制台概览
          </h1>
          <p className="mt-0.5 text-xs text-[var(--hub-muted)]">
            集中管理服务器探针、服务状态监控与代理订阅节点
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setGuideStep(0);
              setGuideOpen(true);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)]"
          >
            <Compass className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <span>交互式向导</span>
          </button>

          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>刷新</span>
          </button>
        </div>
      </div>

      {/* Interactive Setup Progress Checklist Card */}
      {showChecklist && (
        <div className="rounded-2xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hub-border)] pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-[var(--hub-ink)]">
                    初始化配置清单
                  </h2>
                  <span className="rounded-full border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2 py-0.5 font-mono text-[11px] tabular-nums text-[var(--hub-muted)]">
                    {completedChecklistCount} / {checklistItems.length} 已完成
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--hub-muted)]">
                  按以下步骤接入监控资产，状态会随数据库记录自动同步
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCompleteGuide()}
                disabled={savingGuide}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                <Check className="h-3.5 w-3.5" />
                <span>完成引导</span>
              </button>
              <button
                type="button"
                onClick={() => void handleDismissGuide()}
                disabled={savingGuide}
                className="inline-flex h-8 items-center rounded-lg border border-[var(--hub-border)] px-3 text-xs font-medium text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
              >
                稍后再说
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-300"
              style={{
                width: `${(completedChecklistCount / checklistItems.length) * 100}%`,
              }}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {checklistItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.key}
                  to={item.to}
                  className="group flex items-center justify-between gap-3 rounded-xl border border-[var(--hub-border)] bg-[var(--hub-canvas)] p-3.5 no-underline transition-colors hover:border-zinc-300 dark:hover:border-zinc-700"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                        item.done
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-[var(--hub-border)] bg-[var(--hub-surface)] text-[var(--hub-muted)]"
                      }`}
                    >
                      {item.done ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Icon className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div
                        className={`truncate text-xs font-semibold ${
                          item.done
                            ? "text-[var(--hub-muted)] line-through"
                            : "text-[var(--hub-ink)]"
                        }`}
                      >
                        {item.title}
                      </div>
                      <div className="truncate text-[11px] text-[var(--hub-muted)]">
                        {item.detail}
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--hub-muted)] transition-transform group-hover:translate-x-0.5" />
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* 3-Domain Unified Quick-Manage Bento Cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 1. Server Probes */}
        <div className="flex flex-col justify-between rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-5">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--hub-muted)]">
                <Server className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>服务器探针</span>
              </div>
              <Link
                to="/admin/servers"
                className="inline-flex items-center gap-1 rounded-md border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2 py-1 text-[11px] font-medium text-[var(--hub-ink)] no-underline hover:border-zinc-300 dark:hover:border-zinc-700"
              >
                <Plus className="h-3 w-3" />
                <span>添加服务器</span>
              </Link>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] text-[var(--hub-muted)]">在线 / 总节点</div>
                <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                  {probes
                    ? `${probes.online} / ${probes.total}`
                    : `${onboarding?.counts.servers ?? 0}`}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--hub-muted)]">平均 CPU / 内存</div>
                <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
                  {probes
                    ? `${probes.avg_cpu.toFixed(0)}% · ${probes.avg_mem_percent.toFixed(0)}%`
                    : "--"}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-[var(--hub-border)] pt-3 text-[11px] text-[var(--hub-muted)]">
            <span className="font-mono tabular-nums">
              {probes
                ? `↓ ${formatSpeed(probes.total_net_in_bps)} · ↑ ${formatSpeed(probes.total_net_out_bps)}`
                : "等待探针数据"}
            </span>
            <Link
              to="/admin/servers"
              className="inline-flex items-center gap-1 font-medium text-[var(--hub-ink)] no-underline hover:underline"
            >
              <span>管理</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {/* 2. Service Uptime Monitors */}
        <div className="flex flex-col justify-between rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-5">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--hub-muted)]">
                <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span>服务状态监控</span>
              </div>
              <Link
                to="/admin/uptime"
                className="inline-flex items-center gap-1 rounded-md border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2 py-1 text-[11px] font-medium text-[var(--hub-ink)] no-underline hover:border-zinc-300 dark:hover:border-zinc-700"
              >
                <Plus className="h-3 w-3" />
                <span>新建监控</span>
              </Link>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] text-[var(--hub-muted)]">正常 / 总监控</div>
                <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                  {uptime
                    ? `${uptime.up} / ${uptime.total_monitors}`
                    : `${onboarding?.counts.uptime_monitors ?? 0}`}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--hub-muted)]">24h 可用率</div>
                <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {uptime ? `${uptime.overall_uptime_24h.toFixed(2)}%` : "--%"}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-[var(--hub-border)] pt-3 text-[11px] text-[var(--hub-muted)]">
            <span className="font-mono tabular-nums">
              平均延迟 {uptime ? formatLatency(uptime.avg_latency_ms) : "--"} · 异常{" "}
              {uptime?.down ?? 0}
            </span>
            <Link
              to="/admin/uptime"
              className="inline-flex items-center gap-1 font-medium text-[var(--hub-ink)] no-underline hover:underline"
            >
              <span>管理</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {/* 3. Subscriptions & Nodes */}
        <div className="flex flex-col justify-between rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-5">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--hub-muted)]">
                <Globe className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <span>订阅与节点</span>
              </div>
              <Link
                to="/admin/subscriptions"
                className="inline-flex items-center gap-1 rounded-md border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2 py-1 text-[11px] font-medium text-[var(--hub-ink)] no-underline hover:border-zinc-300 dark:hover:border-zinc-700"
              >
                <Plus className="h-3 w-3" />
                <span>导入订阅</span>
              </Link>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] text-[var(--hub-muted)]">可用 / 总节点</div>
                <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                  {subs
                    ? `${subs.available_nodes} / ${subs.total_nodes}`
                    : `${onboarding?.counts.subscription_nodes ?? 0}`}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--hub-muted)]">纯净 / 住宅 IP</div>
                <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
                  {subs ? `${subs.pure_nodes} · ${subs.residential_nodes}` : "--"}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-[var(--hub-border)] pt-3 text-[11px] text-[var(--hub-muted)]">
            <span className="font-mono tabular-nums">
              共 {subs?.total_subscriptions ?? onboarding?.counts.subscriptions ?? 0} 个订阅源
            </span>
            <Link
              to="/admin/subscriptions"
              className="inline-flex items-center gap-1 font-medium text-[var(--hub-ink)] no-underline hover:underline"
            >
              <span>管理</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Bottom Row: Recent Events + System Storage */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-5 lg:col-span-7">
          <div className="flex items-center justify-between border-b border-[var(--hub-border)] pb-3">
            <h2 className="text-sm font-semibold text-[var(--hub-ink)]">
              最近事件与状态动态
            </h2>
            <Link
              to="/admin/logs"
              className="text-xs font-medium text-[var(--hub-muted)] no-underline hover:text-[var(--hub-ink)]"
            >
              审计日志 →
            </Link>
          </div>

          <div className="mt-3 divide-y divide-[var(--hub-border)]">
            {events.length > 0 ? (
              events.slice(0, 6).map((evt) => {
                const dotColor =
                  evt.severity === "error"
                    ? "bg-rose-500"
                    : evt.severity === "warning"
                      ? "bg-amber-500"
                      : "bg-emerald-500";
                return (
                  <div
                    key={evt.id}
                    className="flex items-start justify-between gap-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotColor}`}
                      />
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
                    <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums text-[var(--hub-muted)]">
                      <Clock className="h-3 w-3" />
                      {formatRelativeTime(evt.created_at)}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="py-10 text-center text-xs text-[var(--hub-muted)]">
                暂无告警或异常事件，所有服务运行平稳
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 lg:col-span-5">
          {/* System Storage Card */}
          <div className="rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-5">
            <div className="flex items-center justify-between border-b border-[var(--hub-border)] pb-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-[var(--hub-muted)]" />
                <h2 className="text-sm font-semibold text-[var(--hub-ink)]">
                  存储与数据库概览
                </h2>
              </div>
              <Link
                to="/admin/settings/metrics"
                className="text-xs font-medium text-blue-600 no-underline hover:underline dark:text-blue-400"
              >
                维护 / Vacuum →
              </Link>
            </div>

            <div className="mt-3 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--hub-muted)]">主数据库</span>
                <span className="font-mono tabular-nums">
                  {dbSize?.main?.driver || "sqlite"} ·{" "}
                  {dbSize?.main?.size != null
                    ? formatBytes(dbSize.main.size)
                    : "--"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--hub-muted)]">监控指标库</span>
                <span className="font-mono tabular-nums">
                  {dbSize?.monitoring?.driver || "sqlite"} ·{" "}
                  {dbSize?.monitoring?.size != null
                    ? formatBytes(dbSize.monitoring.size)
                    : "--"}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-[var(--hub-border)] pt-2.5">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <HardDrive className="h-3.5 w-3.5 text-[var(--hub-muted)]" />
                  本地总占用
                </span>
                <span className="font-mono font-semibold tabular-nums">
                  {dbSize?.local_total != null
                    ? formatBytes(dbSize.local_total)
                    : "--"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* First-Visit Interactive Walkthrough Modal */}
      {guideOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-[2px]"
          onClick={() => setGuideOpen(false)}
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--hub-border)] bg-[var(--hub-surface)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--hub-border)] px-6 py-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                  <Compass className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-[var(--hub-ink)]">
                    PulseDeck 快速上手引导
                  </div>
                  <div className="font-mono text-[11px] text-[var(--hub-muted)]">
                    步骤 {guideStep + 1} / {WALKTHROUGH_STEPS.length}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                className="rounded-lg p-1 text-[var(--hub-muted)] hover:bg-[var(--hub-canvas)] hover:text-[var(--hub-ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Stepper Pills */}
            <div className="grid grid-cols-4 gap-1.5 border-b border-[var(--hub-border)] bg-[var(--hub-canvas)]/60 px-6 py-2.5">
              {WALKTHROUGH_STEPS.map((s, idx) => (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => handleStepChange(idx)}
                  className={`h-1.5 rounded-full transition-colors ${
                    idx === guideStep
                      ? "bg-zinc-900 dark:bg-zinc-100"
                      : idx < guideStep
                        ? "bg-emerald-500"
                        : "bg-zinc-200 dark:bg-zinc-800"
                  }`}
                  aria-label={`步骤 ${idx + 1}`}
                />
              ))}
            </div>

            {/* Body */}
            <div className="space-y-4 px-6 py-6">
              <div className="flex items-start gap-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--hub-border)] bg-[var(--hub-canvas)]">
                  <WalkthroughIcon className="h-5 w-5 text-[var(--hub-ink)]" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[var(--hub-ink)]">
                    {activeWalkthrough.title}
                  </h3>
                  <p className="text-xs text-[var(--hub-muted)]">
                    {activeWalkthrough.subtitle}
                  </p>
                </div>
              </div>

              <p className="text-xs leading-relaxed text-[var(--hub-ink)]/90">
                {activeWalkthrough.description}
              </p>

              <div className="space-y-2 rounded-xl border border-[var(--hub-border)] bg-[var(--hub-canvas)] p-3.5">
                {activeWalkthrough.highlights.map((pt) => (
                  <div key={pt} className="flex items-start gap-2 text-xs">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    <span className="text-[var(--hub-ink)]">{pt}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--hub-border)] bg-[var(--hub-canvas)]/50 px-6 py-3.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleDismissGuide()}
                  disabled={savingGuide}
                  className="text-xs text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
                >
                  稍后再说
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {guideStep > 0 && (
                  <button
                    type="button"
                    onClick={() => handleStepChange(guideStep - 1)}
                    className="inline-flex h-8 items-center rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)]"
                  >
                    上一步
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    void persistOnboarding({ current_step: guideStep }, true);
                    setGuideOpen(false);
                    navigate(activeWalkthrough.ctaTo);
                  }}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)]"
                >
                  <span>{activeWalkthrough.ctaLabel}</span>
                  <ArrowRight className="h-3 w-3" />
                </button>

                {guideStep < WALKTHROUGH_STEPS.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => handleStepChange(guideStep + 1)}
                    className="inline-flex h-8 items-center gap-1 rounded-lg bg-zinc-900 px-3.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    <span>下一步</span>
                    <ArrowRight className="h-3 w-3" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={savingGuide}
                    onClick={() => void handleCompleteGuide()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>完成引导</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
