import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
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

const WALKTHROUGH_STEP_DEFS = [
  {
    titleKey: "pulse.adminOverview.step1Title",
    subtitleKey: "pulse.adminOverview.step1Subtitle",
    descKey: "pulse.adminOverview.step1Desc",
    highlightKeys: [
      "pulse.adminOverview.step1Highlight1",
      "pulse.adminOverview.step1Highlight2",
      "pulse.adminOverview.step1Highlight3",
    ],
    ctaKey: "pulse.adminOverview.step1Cta",
    ctaTo: "/admin/settings/site",
    icon: Sparkles,
  },
  {
    titleKey: "pulse.adminOverview.step2Title",
    subtitleKey: "pulse.adminOverview.step2Subtitle",
    descKey: "pulse.adminOverview.step2Desc",
    highlightKeys: [
      "pulse.adminOverview.step2Highlight1",
      "pulse.adminOverview.step2Highlight2",
      "pulse.adminOverview.step2Highlight3",
    ],
    ctaKey: "pulse.adminOverview.step2Cta",
    ctaTo: "/admin/servers",
    icon: Server,
  },
  {
    titleKey: "pulse.adminOverview.step3Title",
    subtitleKey: "pulse.adminOverview.step3Subtitle",
    descKey: "pulse.adminOverview.step3Desc",
    highlightKeys: [
      "pulse.adminOverview.step3Highlight1",
      "pulse.adminOverview.step3Highlight2",
      "pulse.adminOverview.step3Highlight3",
    ],
    ctaKey: "pulse.adminOverview.step3Cta",
    ctaTo: "/admin/uptime",
    icon: Activity,
  },
  {
    titleKey: "pulse.adminOverview.step4Title",
    subtitleKey: "pulse.adminOverview.step4Subtitle",
    descKey: "pulse.adminOverview.step4Desc",
    highlightKeys: [
      "pulse.adminOverview.step4Highlight1",
      "pulse.adminOverview.step4Highlight2",
      "pulse.adminOverview.step4Highlight3",
    ],
    ctaKey: "pulse.adminOverview.step4Cta",
    ctaTo: "/admin/subscriptions",
    icon: Globe,
  },
];

export default function AdminOverviewPage() {
  const { t } = useTranslation();
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
          Math.max(0, Math.min(WALKTHROUGH_STEP_DEFS.length - 1, obRes.current_step || 0)),
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
        toast.error(err instanceof Error ? err.message : t("pulse.adminOverview.guideUpdateFailed"));
      }
      return null;
    } finally {
      setSavingGuide(false);
    }
  };

  const handleStepChange = (nextIdx: number) => {
    const clamped = Math.max(0, Math.min(WALKTHROUGH_STEP_DEFS.length - 1, nextIdx));
    setGuideStep(clamped);
    void persistOnboarding({ current_step: clamped }, true);
  };

  const handleCompleteGuide = async () => {
    const updated = await persistOnboarding({ completed: true, dismissed: false });
    if (updated) {
      toast.success(t("pulse.adminOverview.guideCompleted"));
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
        title: t("pulse.adminOverview.checkServerTitle"),
        detail:
          counts && counts.servers > 0
            ? t("pulse.adminOverview.checkServerDone", { count: counts.servers })
            : t("pulse.adminOverview.checkServerTodo"),
        done: Boolean(steps?.add_server),
        to: "/admin/servers",
        icon: Server,
      },
      {
        key: "add_uptime",
        title: t("pulse.adminOverview.checkUptimeTitle"),
        detail:
          counts && counts.uptime_monitors > 0
            ? t("pulse.adminOverview.checkUptimeDone", { count: counts.uptime_monitors })
            : t("pulse.adminOverview.checkUptimeTodo"),
        done: Boolean(steps?.add_uptime),
        to: "/admin/uptime",
        icon: Activity,
      },
      {
        key: "add_subscription",
        title: t("pulse.adminOverview.checkSubTitle"),
        detail:
          counts && counts.subscriptions > 0
            ? t("pulse.adminOverview.checkSubDone", {
                subs: counts.subscriptions,
                nodes: counts.subscription_nodes,
              })
            : t("pulse.adminOverview.checkSubTodo"),
        done: Boolean(steps?.add_subscription),
        to: "/admin/subscriptions",
        icon: Globe,
      },
      {
        key: "configure_alerts",
        title: t("pulse.adminOverview.checkAlertTitle"),
        detail: steps?.configure_alerts
          ? t("pulse.adminOverview.checkAlertDone")
          : t("pulse.adminOverview.checkAlertTodo"),
        done: Boolean(steps?.configure_alerts),
        to: "/admin/notification/channels",
        icon: Bell,
      },
    ];
  }, [onboarding, t]);

  const completedChecklistCount = checklistItems.filter((item) => item.done).length;
  const showChecklist =
    onboarding && !onboarding.completed && !onboarding.dismissed;

  const probes = overview?.probes;
  const uptime = overview?.uptime;
  const subs = overview?.subscriptions;
  const events = overview?.recent_events ?? [];

  const activeWalkthrough = WALKTHROUGH_STEP_DEFS[guideStep] ?? WALKTHROUGH_STEP_DEFS[0];
  const WalkthroughIcon = activeWalkthrough.icon;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--hub-ink)]">
            {t("pulse.adminOverview.title")}
          </h1>
          <p className="mt-0.5 text-xs text-[var(--hub-muted)]">
            {t("pulse.adminOverview.subtitle")}
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
            <span>{t("pulse.adminOverview.interactiveGuide")}</span>
          </button>

          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>{t("pulse.common.refresh")}</span>
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
                    {t("pulse.adminOverview.checklistTitle")}
                  </h2>
                  <span className="rounded-full border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2 py-0.5 font-mono text-[11px] tabular-nums text-[var(--hub-muted)]">
                    {t("pulse.adminOverview.checklistProgress", {
                      done: completedChecklistCount,
                      total: checklistItems.length,
                    })}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--hub-muted)]">
                  {t("pulse.adminOverview.checklistSubtitle")}
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
                <span>{t("pulse.adminOverview.completeGuide")}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleDismissGuide()}
                disabled={savingGuide}
                className="inline-flex h-8 items-center rounded-lg border border-[var(--hub-border)] px-3 text-xs font-medium text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
              >
                {t("pulse.adminOverview.later")}
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
                <span>{t("pulse.adminOverview.cardProbes")}</span>
              </div>
              <Link
                to="/admin/servers"
                className="inline-flex items-center gap-1 rounded-md border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2 py-1 text-[11px] font-medium text-[var(--hub-ink)] no-underline hover:border-zinc-300 dark:hover:border-zinc-700"
              >
                <Plus className="h-3 w-3" />
                <span>{t("pulse.adminOverview.addServer")}</span>
              </Link>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] text-[var(--hub-muted)]">{t("pulse.adminOverview.onlineTotal")}</div>
                <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                  {probes
                    ? `${probes.online} / ${probes.total}`
                    : `${onboarding?.counts.servers ?? 0}`}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--hub-muted)]">{t("pulse.adminOverview.avgCpuMem")}</div>
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
                : t("pulse.adminOverview.waitingProbeData")}
            </span>
            <Link
              to="/admin/servers"
              className="inline-flex items-center gap-1 font-medium text-[var(--hub-ink)] no-underline hover:underline"
            >
              <span>{t("pulse.common.manage")}</span>
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
                <span>{t("pulse.adminOverview.cardUptime")}</span>
              </div>
              <Link
                to="/admin/uptime"
                className="inline-flex items-center gap-1 rounded-md border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2 py-1 text-[11px] font-medium text-[var(--hub-ink)] no-underline hover:border-zinc-300 dark:hover:border-zinc-700"
              >
                <Plus className="h-3 w-3" />
                <span>{t("pulse.adminOverview.newMonitor")}</span>
              </Link>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] text-[var(--hub-muted)]">{t("pulse.adminOverview.upTotal")}</div>
                <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                  {uptime
                    ? `${uptime.up} / ${uptime.total_monitors}`
                    : `${onboarding?.counts.uptime_monitors ?? 0}`}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--hub-muted)]">{t("pulse.adminOverview.uptime24h")}</div>
                <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {uptime ? `${uptime.overall_uptime_24h.toFixed(2)}%` : "--%"}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-[var(--hub-border)] pt-3 text-[11px] text-[var(--hub-muted)]">
            <span className="font-mono tabular-nums">
              {t("pulse.adminOverview.avgLatencyDown", {
                latency: uptime ? formatLatency(uptime.avg_latency_ms) : "--",
                down: uptime?.down ?? 0,
              })}
            </span>
            <Link
              to="/admin/uptime"
              className="inline-flex items-center gap-1 font-medium text-[var(--hub-ink)] no-underline hover:underline"
            >
              <span>{t("pulse.common.manage")}</span>
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
                <span>{t("pulse.adminOverview.cardSubs")}</span>
              </div>
              <Link
                to="/admin/subscriptions"
                className="inline-flex items-center gap-1 rounded-md border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2 py-1 text-[11px] font-medium text-[var(--hub-ink)] no-underline hover:border-zinc-300 dark:hover:border-zinc-700"
              >
                <Plus className="h-3 w-3" />
                <span>{t("pulse.adminOverview.importSub")}</span>
              </Link>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] text-[var(--hub-muted)]">{t("pulse.adminOverview.availTotal")}</div>
                <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                  {subs
                    ? `${subs.available_nodes} / ${subs.total_nodes}`
                    : `${onboarding?.counts.subscription_nodes ?? 0}`}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[var(--hub-muted)]">{t("pulse.adminOverview.pureResidential")}</div>
                <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
                  {subs ? `${subs.pure_nodes} · ${subs.residential_nodes}` : "--"}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-[var(--hub-border)] pt-3 text-[11px] text-[var(--hub-muted)]">
            <span className="font-mono tabular-nums">
              {t("pulse.adminOverview.subSourceCount", {
                count: subs?.total_subscriptions ?? onboarding?.counts.subscriptions ?? 0,
              })}
            </span>
            <Link
              to="/admin/subscriptions"
              className="inline-flex items-center gap-1 font-medium text-[var(--hub-ink)] no-underline hover:underline"
            >
              <span>{t("pulse.common.manage")}</span>
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
              {t("pulse.adminOverview.recentEvents")}
            </h2>
            <Link
              to="/admin/logs"
              className="text-xs font-medium text-[var(--hub-muted)] no-underline hover:text-[var(--hub-ink)]"
            >
              {t("pulse.adminOverview.auditLogs")}
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
                {t("pulse.overview.noEvents")}
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
                  {t("pulse.adminOverview.storageTitle")}
                </h2>
              </div>
              <Link
                to="/admin/settings/metrics"
                className="text-xs font-medium text-blue-600 no-underline hover:underline dark:text-blue-400"
              >
                {t("pulse.adminOverview.maintenanceLink")}
              </Link>
            </div>

            <div className="mt-3 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--hub-muted)]">{t("pulse.adminOverview.mainDb")}</span>
                <span className="font-mono tabular-nums">
                  {dbSize?.main?.driver || "sqlite"} ·{" "}
                  {dbSize?.main?.size != null
                    ? formatBytes(dbSize.main.size)
                    : "--"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--hub-muted)]">{t("pulse.adminOverview.metricDb")}</span>
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
                  {t("pulse.adminOverview.localTotal")}
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
                    {t("pulse.adminOverview.modalTitle")}
                  </div>
                  <div className="font-mono text-[11px] text-[var(--hub-muted)]">
                    {t("pulse.adminOverview.modalStep", {
                      current: guideStep + 1,
                      total: WALKTHROUGH_STEP_DEFS.length,
                    })}
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
              {WALKTHROUGH_STEP_DEFS.map((s, idx) => (
                <button
                  key={s.titleKey}
                  type="button"
                  onClick={() => handleStepChange(idx)}
                  className={`h-1.5 rounded-full transition-colors ${
                    idx === guideStep
                      ? "bg-zinc-900 dark:bg-zinc-100"
                      : idx < guideStep
                        ? "bg-emerald-500"
                        : "bg-zinc-200 dark:bg-zinc-800"
                  }`}
                  aria-label={t("pulse.adminOverview.stepAria", { num: idx + 1 })}
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
                    {t(activeWalkthrough.titleKey)}
                  </h3>
                  <p className="text-xs text-[var(--hub-muted)]">
                    {t(activeWalkthrough.subtitleKey)}
                  </p>
                </div>
              </div>

              <p className="text-xs leading-relaxed text-[var(--hub-ink)]/90">
                {t(activeWalkthrough.descKey)}
              </p>

              <div className="space-y-2 rounded-xl border border-[var(--hub-border)] bg-[var(--hub-canvas)] p-3.5">
                {activeWalkthrough.highlightKeys.map((ptKey) => (
                  <div key={ptKey} className="flex items-start gap-2 text-xs">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    <span className="text-[var(--hub-ink)]">{t(ptKey)}</span>
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
                  {t("pulse.adminOverview.later")}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {guideStep > 0 && (
                  <button
                    type="button"
                    onClick={() => handleStepChange(guideStep - 1)}
                    className="inline-flex h-8 items-center rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)]"
                  >
                    {t("pulse.adminOverview.prevStep")}
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
                  <span>{t(activeWalkthrough.ctaKey)}</span>
                  <ArrowRight className="h-3 w-3" />
                </button>

                {guideStep < WALKTHROUGH_STEP_DEFS.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => handleStepChange(guideStep + 1)}
                    className="inline-flex h-8 items-center gap-1 rounded-lg bg-zinc-900 px-3.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    <span>{t("pulse.adminOverview.nextStep")}</span>
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
                    <span>{t("pulse.adminOverview.completeGuide")}</span>
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
