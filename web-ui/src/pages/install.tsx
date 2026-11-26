import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { AnimatePresence } from "motion/react";
import { AutoHeight, PageMotion, SlideSwap } from "@/components/motion";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Database,
  Globe,
  LoaderCircle,
  Lock,
  Server,
  ShieldCheck,
  Sparkles,
  Upload,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import GuideHeader from "@/components/GuideHeader";
import UploadDialog from "@/components/UploadDialog";
import { createChunkUploadTask, type ChunkUploadTask } from "@/lib/chunkUpload";
import {
  completeInstall,
  fetchInstallStatus,
  testInstallDatabase,
} from "@/lib/hubApi";
import type { InstallTestDBResult } from "@/types/hub";
import SQLiteWarning from "./database/SQLiteWarning";
import { writeLanguageCookie } from "@/utils/language";

const STEP_META = [
  { id: "welcome", label: "欢迎使用" },
  { id: "admin", label: "管理员账户" },
  { id: "site", label: "站点与访问" },
  { id: "database", label: "指标数据库" },
  { id: "confirm", label: "确认启动" },
] as const;

export default function Install() {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(0);
  const [stepDirection, setStepDirection] = useState(1);

  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [sitename, setSitename] = useState("PulseDeck");
  const [description, setDescription] = useState(
    "All-in-one self-hosted server probe, uptime, and node observability deck.",
  );
  const [privateSite, setPrivateSite] = useState(false);
  const [language, setLanguage] = useState<"zh-CN" | "en-US">("zh-CN");
  const [dbPreset, setDbPreset] = useState<"sqlite" | "custom">("sqlite");
  const [defaultSqliteDsn, setDefaultSqliteDsn] = useState("./data/metrics.db");
  const [metricDSN, setMetricDSN] = useState("./data/metrics.db");

  const [testingDb, setTestingDb] = useState(false);
  const [dbTestResult, setDbTestResult] = useState<InstallTestDBResult | null>(
    null,
  );
  const [dbTestError, setDbTestError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const restoreTaskRef = useRef<ChunkUploadTask | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState<boolean | null>(null);

  const goToStep = (next: number) => {
    setStep((current) => {
      const target = Math.max(0, Math.min(STEP_META.length - 1, next));
      setStepDirection(target >= current ? 1 : -1);
      return target;
    });
  };

  useEffect(() => {
    void fetchInstallStatus()
      .then((status) => {
        setReady(status.required);
        if (status.default_sitename) setSitename(status.default_sitename);
        if (status.default_description) setDescription(status.default_description);
        if (status.default_metric_dsn) {
          setDefaultSqliteDsn(status.default_metric_dsn);
          setMetricDSN(status.default_metric_dsn);
        }
      })
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : t("install.connection_error", "无法连接到安装接口"),
        ),
      );
  }, [t]);

  const passwordChecks = useMemo(
    () => [
      { label: "长度至少 8 位字符", ok: password.length >= 8 },
      { label: "包含至少 1 个大写字母 (A-Z)", ok: /[A-Z]/.test(password) },
      { label: "包含至少 1 个小写字母 (a-z)", ok: /[a-z]/.test(password) },
      { label: "包含至少 1 个数字 (0-9)", ok: /\d/.test(password) },
      {
        label: "两次输入密码一致",
        ok: password.length > 0 && password === passwordAgain,
      },
    ],
    [password, passwordAgain],
  );

  const passwordStrong = passwordChecks.slice(0, 4).every((c) => c.ok);
  const passwordMatched = passwordChecks[4].ok;

  const handleTestDb = async () => {
    if (!metricDSN.trim()) {
      setDbTestError("请先填写数据库 DSN 或路径");
      setDbTestResult(null);
      return;
    }
    setTestingDb(true);
    setDbTestError(null);
    setDbTestResult(null);
    try {
      const res = await testInstallDatabase(metricDSN.trim());
      setDbTestResult(res);
    } catch (err) {
      setDbTestError(err instanceof Error ? err.message : "数据库连接测试失败");
    } finally {
      setTestingDb(false);
    }
  };

  const next = () => {
    setError("");
    if (step === 1) {
      if (!username.trim()) return setError("请填写管理员用户名");
      if (!passwordStrong) return setError("请满足全部密码强度要求");
      if (!passwordMatched) return setError("两次输入的密码不一致");
    }
    if (step === 2 && !sitename.trim()) {
      return setError("请填写站点名称");
    }
    if (step === 3 && !metricDSN.trim()) {
      return setError("请填写指标数据库 DSN 或路径");
    }
    goToStep(step + 1);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (step !== 4) return next();
    setBusy(true);
    setError("");
    try {
      await completeInstall({
        username: username.trim(),
        password,
        sitename: sitename.trim(),
        description: description.trim(),
        metric_dsn: metricDSN.trim(),
        private_site: privateSite,
        language,
      });
      setCompleted(true);
      window.setTimeout(() => window.location.assign("/admin/overview"), 1100);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "初始化失败");
      setBusy(false);
    }
  };

  const restoreBackup = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("仅支持 .zip 格式的备份文件");
      return;
    }

    setError("");
    setRestoring(true);
    setRestoreProgress(0);
    const task = createChunkUploadTask("/api/install/upload");
    restoreTaskRef.current = task;
    let restored = false;
    try {
      await task.upload("backup", file, setRestoreProgress);
      restored = true;
      window.setTimeout(() => window.location.assign("/admin/overview"), 4500);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setError(reason instanceof Error ? reason.message : "恢复备份失败");
      }
      setRestoreProgress(0);
    } finally {
      restoreTaskRef.current = null;
      if (!restored) setRestoring(false);
    }
  };

  const cancelRestore = () => {
    restoreTaskRef.current?.cancel();
    setRestoreProgress(0);
  };

  return (
    <div className="min-h-screen bg-[var(--hub-canvas)] text-[var(--hub-ink)]">
      <AnimatePresence mode="wait" initial={false}>
        {ready === false ? (
          <PageMotion
            key="install-completed"
            className="flex min-h-screen items-center justify-center px-4"
          >
            <div className="w-full max-w-md rounded-2xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-8 text-center shadow-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h1 className="mt-4 text-lg font-semibold">PulseDeck 已完成初始化</h1>
              <p className="mt-1.5 text-xs text-[var(--hub-muted)]">
                当前实例已经配置就绪，你可以直接查看状态页或进入后台控制台。
              </p>
              <div className="mt-6 flex items-center justify-center gap-3">
                <a
                  href="/"
                  className="inline-flex h-9 items-center rounded-lg border border-[var(--hub-border)] px-4 text-xs font-medium text-[var(--hub-ink)] no-underline hover:bg-[var(--hub-canvas)]"
                >
                  访问状态页
                </a>
                <a
                  href="/admin/overview"
                  className="inline-flex h-9 items-center rounded-lg bg-zinc-900 px-4 text-xs font-medium text-white no-underline hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  进入控制台
                </a>
              </div>
            </div>
          </PageMotion>
        ) : (
          <PageMotion
            key="install-wizard"
            className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-12"
          >
            <GuideHeader />

            <div className="mt-8">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2.5 py-0.5 font-mono text-[11px] text-[var(--hub-muted)]">
                    <Sparkles className="h-3 w-3" />
                    FIRST-RUN SETUP
                  </span>
                  <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                    初始化 PulseDeck 控制面板
                  </h1>
                </div>
                <span className="font-mono text-xs tabular-nums text-[var(--hub-muted)]">
                  步骤 {step + 1} / {STEP_META.length}
                </span>
              </div>

              {/* 5-step Horizontal Stepper */}
              <div className="mt-6 grid grid-cols-5 gap-2">
                {STEP_META.map((item, idx) => {
                  const done = idx < step || completed;
                  const active = idx === step && !completed;
                  return (
                    <div key={item.id} className="space-y-1.5">
                      <div
                        className={`h-1.5 w-full rounded-full transition-colors ${
                          done
                            ? "bg-emerald-500"
                            : active
                              ? "bg-zinc-900 dark:bg-zinc-100"
                              : "bg-zinc-200 dark:bg-zinc-800"
                        }`}
                      />
                      <div
                        className={`hidden sm:flex items-center gap-1 text-[11px] ${
                          active
                            ? "font-semibold text-[var(--hub-ink)]"
                            : done
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-[var(--hub-muted)]"
                        }`}
                      >
                        <span className="font-mono tabular-nums">{idx + 1}.</span>
                        <span className="truncate">{item.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {error && (
              <div className="mt-5 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/50 dark:text-rose-200">
                <XCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={submit} className="mt-6 flex-1">
              <div className="rounded-2xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-6 shadow-xs sm:p-8">
                <AutoHeight threshold={4} className="overflow-x-clip">
                  <SlideSwap swapKey={step} direction={stepDirection}>
                    {/* Step 1: Welcome */}
                    {step === 0 && (
                      <div className="space-y-6">
                        <div>
                          <h2 className="text-lg font-semibold">
                            欢迎使用 PulseDeck
                          </h2>
                          <p className="mt-1 text-xs leading-relaxed text-[var(--hub-muted)]">
                            PulseDeck 将服务器探针、服务可用性监控与订阅节点纯净度分析融为一体，前后台职责清晰分离，几分钟即可完成部署。
                          </p>
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div className="rounded-xl border border-[var(--hub-border)] bg-[var(--hub-canvas)] p-4">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                              <Server className="h-4 w-4" />
                            </div>
                            <h3 className="mt-3 text-xs font-semibold">服务器探针</h3>
                            <p className="mt-1 text-[11px] leading-relaxed text-[var(--hub-muted)]">
                              实时采集 CPU、内存、磁盘与网络速率，支持一键部署与自动发现。
                            </p>
                          </div>

                          <div className="rounded-xl border border-[var(--hub-border)] bg-[var(--hub-canvas)] p-4">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                              <Activity className="h-4 w-4" />
                            </div>
                            <h3 className="mt-3 text-xs font-semibold">服务可用性监控</h3>
                            <p className="mt-1 text-[11px] leading-relaxed text-[var(--hub-muted)]">
                              内置 HTTP/TCP/Ping 探测与 60 格心跳条，兼容 Uptime Kuma 同步。
                            </p>
                          </div>

                          <div className="rounded-xl border border-[var(--hub-border)] bg-[var(--hub-canvas)] p-4">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                              <Globe className="h-4 w-4" />
                            </div>
                            <h3 className="mt-3 text-xs font-semibold">订阅与节点纯净度</h3>
                            <p className="mt-1 text-[11px] leading-relaxed text-[var(--hub-muted)]">
                              全球节点分布地图、批量测速与 IPPure 原生/住宅 IP 风险评估。
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-[var(--hub-border)] bg-[var(--hub-canvas)]/70 px-4 py-3">
                          <div className="text-xs text-[var(--hub-muted)]">
                            已有历史备份压缩包？可直接从 <span className="font-mono">.zip</span> 备份恢复全部数据。
                          </div>
                          <button
                            type="button"
                            disabled={busy || restoring || ready === null}
                            onClick={() => setRestoreOpen(true)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)] disabled:opacity-50"
                          >
                            {restoring ? (
                              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Upload className="h-3.5 w-3.5" />
                            )}
                            <span>{restoring ? "正在恢复并重启..." : "从备份恢复 (.zip)"}</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Step 2: Admin Account */}
                    {step === 1 && (
                      <div className="space-y-5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)]">
                            <ShieldCheck className="h-4 w-4 text-[var(--hub-ink)]" />
                          </div>
                          <div>
                            <h2 className="text-lg font-semibold">创建管理员账户</h2>
                            <p className="text-xs text-[var(--hub-muted)]">
                              用于登录管理后台、配置探针、监控与插件系统
                            </p>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <label className="mb-1.5 block text-xs font-medium">
                              管理员用户名
                            </label>
                            <input
                              value={username}
                              onChange={(e) => setUsername(e.target.value)}
                              autoComplete="username"
                              autoFocus
                              placeholder="admin"
                              className="h-10 w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 text-sm focus:border-zinc-500 focus:outline-none"
                            />
                          </div>

                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                              <label className="mb-1.5 block text-xs font-medium">
                                管理员密码
                              </label>
                              <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="new-password"
                                placeholder="至少 8 位，含大小写字母与数字"
                                className="h-10 w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 text-sm focus:border-zinc-500 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="mb-1.5 block text-xs font-medium">
                                确认密码
                              </label>
                              <input
                                type="password"
                                value={passwordAgain}
                                onChange={(e) => setPasswordAgain(e.target.value)}
                                autoComplete="new-password"
                                placeholder="再次输入密码"
                                className="h-10 w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 text-sm focus:border-zinc-500 focus:outline-none"
                              />
                            </div>
                          </div>

                          {/* Live Password Strength Checklist */}
                          <div className="rounded-xl border border-[var(--hub-border)] bg-[var(--hub-canvas)] p-3.5">
                            <div className="mb-2 text-[11px] font-medium text-[var(--hub-muted)]">
                              密码安全强度检查
                            </div>
                            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                              {passwordChecks.map((rule) => (
                                <div
                                  key={rule.label}
                                  className={`flex items-center gap-2 text-xs ${
                                    rule.ok
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-[var(--hub-muted)]"
                                  }`}
                                >
                                  <span
                                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                                      rule.ok
                                        ? "border-emerald-500 bg-emerald-500 text-white"
                                        : "border-[var(--hub-border)]"
                                    }`}
                                  >
                                    {rule.ok ? <Check className="h-2.5 w-2.5" /> : null}
                                  </span>
                                  <span>{rule.label}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Step 3: Site & Preferences */}
                    {step === 2 && (
                      <div className="space-y-5">
                        <div>
                          <h2 className="text-lg font-semibold">站点与访问偏好</h2>
                          <p className="mt-1 text-xs text-[var(--hub-muted)]">
                            设置对外状态页的名称、简介、可见性及默认界面语言
                          </p>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <label className="mb-1.5 block text-xs font-medium">
                              站点名称
                            </label>
                            <input
                              value={sitename}
                              onChange={(e) => setSitename(e.target.value)}
                              autoFocus
                              placeholder="PulseDeck"
                              className="h-10 w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 text-sm focus:border-zinc-500 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 block text-xs font-medium">
                              站点描述
                            </label>
                            <textarea
                              rows={3}
                              value={description}
                              onChange={(e) => setDescription(e.target.value)}
                              className="w-full rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 py-2 text-sm focus:border-zinc-500 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 block text-xs font-medium">
                              状态页可见性
                            </label>
                            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                              <button
                                type="button"
                                onClick={() => setPrivateSite(false)}
                                className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                                  !privateSite
                                    ? "border-zinc-900 bg-[var(--hub-canvas)] dark:border-zinc-100"
                                    : "border-[var(--hub-border)] hover:bg-[var(--hub-canvas)]/60"
                                }`}
                              >
                                <Globe className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                                <div>
                                  <div className="text-xs font-semibold">公开状态页</div>
                                  <div className="mt-0.5 text-[11px] text-[var(--hub-muted)]">
                                    访客可直接浏览只读总览、探针与服务状态
                                  </div>
                                </div>
                              </button>

                              <button
                                type="button"
                                onClick={() => setPrivateSite(true)}
                                className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                                  privateSite
                                    ? "border-zinc-900 bg-[var(--hub-canvas)] dark:border-zinc-100"
                                    : "border-[var(--hub-border)] hover:bg-[var(--hub-canvas)]/60"
                                }`}
                              >
                                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                                <div>
                                  <div className="text-xs font-semibold">
                                    私有站点 (仅登录后可见)
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-[var(--hub-muted)]">
                                    所有观测数据与状态页面需登录后查看
                                  </div>
                                </div>
                              </button>
                            </div>
                          </div>

                          <div>
                            <label className="mb-1.5 block text-xs font-medium">
                              默认界面语言
                            </label>
                            <div className="inline-flex rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] p-1">
                              {[
                                { code: "zh-CN" as const, label: "简体中文" },
                                { code: "en-US" as const, label: "English" },
                              ].map((opt) => (
                                <button
                                  key={opt.code}
                                  type="button"
                                  onClick={() => {
                                    setLanguage(opt.code);
                                    void i18n.changeLanguage(opt.code);
                                    writeLanguageCookie(opt.code);
                                  }}
                                  className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors ${
                                    language === opt.code
                                      ? "bg-[var(--hub-surface)] text-[var(--hub-ink)] shadow-xs"
                                      : "text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
                                  }`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Step 4: Metric Database */}
                    {step === 3 && (
                      <div className="space-y-5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)]">
                            <Database className="h-4 w-4 text-[var(--hub-ink)]" />
                          </div>
                          <div>
                            <h2 className="text-lg font-semibold">指标数据库配置</h2>
                            <p className="text-xs text-[var(--hub-muted)]">
                              用于存储历史监控指标与时序图表数据，支持 SQLite 或 PostgreSQL / TimescaleDB
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => {
                              setDbPreset("sqlite");
                              setMetricDSN(defaultSqliteDsn);
                              setDbTestResult(null);
                              setDbTestError(null);
                            }}
                            className={`rounded-xl border p-3.5 text-left transition-colors ${
                              dbPreset === "sqlite"
                                ? "border-zinc-900 bg-[var(--hub-canvas)] dark:border-zinc-100"
                                : "border-[var(--hub-border)] hover:bg-[var(--hub-canvas)]/60"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold">
                                SQLite 本地单文件 (推荐)
                              </span>
                              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                                零依赖
                              </span>
                            </div>
                            <div className="mt-1 font-mono text-[11px] text-[var(--hub-muted)]">
                              {defaultSqliteDsn}
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setDbPreset("custom");
                              if (metricDSN === defaultSqliteDsn) {
                                setMetricDSN(
                                  "postgres://user:password@127.0.0.1:5432/pulsedeck?sslmode=disable",
                                );
                              }
                              setDbTestResult(null);
                              setDbTestError(null);
                            }}
                            className={`rounded-xl border p-3.5 text-left transition-colors ${
                              dbPreset === "custom"
                                ? "border-zinc-900 bg-[var(--hub-canvas)] dark:border-zinc-100"
                                : "border-[var(--hub-border)] hover:bg-[var(--hub-canvas)]/60"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold">
                                自定义 PostgreSQL / TimescaleDB DSN
                              </span>
                              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                                高并发
                              </span>
                            </div>
                            <div className="mt-1 text-[11px] text-[var(--hub-muted)]">
                              适合大量节点或长期高频指标保留
                            </div>
                          </button>
                        </div>

                        <div>
                          <label className="mb-1.5 block text-xs font-medium">
                            数据库连接串 (Metric DSN)
                          </label>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                              value={metricDSN}
                              onChange={(e) => {
                                setMetricDSN(e.target.value);
                                setDbTestResult(null);
                                setDbTestError(null);
                              }}
                              placeholder="./data/metrics.db"
                              className="h-10 flex-1 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-3 font-mono text-xs focus:border-zinc-500 focus:outline-none"
                            />
                            <button
                              type="button"
                              disabled={testingDb || !metricDSN.trim()}
                              onClick={() => void handleTestDb()}
                              className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-4 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)] disabled:opacity-50"
                            >
                              {testingDb ? (
                                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Database className="h-3.5 w-3.5" />
                              )}
                              <span>{testingDb ? "测试中..." : "测试连接"}</span>
                            </button>
                          </div>
                        </div>

                        {dbTestResult && (
                          <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 text-xs text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-200">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                              <span>{dbTestResult.message || "数据库连接测试成功"}</span>
                            </div>
                            <span className="rounded border border-emerald-300 bg-white/80 px-2 py-0.5 font-mono text-[10px] uppercase dark:border-emerald-800 dark:bg-emerald-950">
                              {dbTestResult.driver}
                            </span>
                          </div>
                        )}

                        {dbTestError && (
                          <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-200">
                            <XCircle className="h-4 w-4 shrink-0 text-rose-500" />
                            <span>{dbTestError}</span>
                          </div>
                        )}

                        <SQLiteWarning dsn={metricDSN} motionKey="install-sqlite-warning" />
                      </div>
                    )}

                    {/* Step 5: Confirm & Launch */}
                    {step === 4 && (
                      <div className="space-y-5">
                        {completed ? (
                          <div className="py-6 text-center">
                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                              <CheckCircle2 className="h-6 w-6" />
                            </div>
                            <h2 className="mt-4 text-lg font-semibold">
                              PulseDeck 已准备就绪！
                            </h2>
                            <p className="mt-1 text-xs text-[var(--hub-muted)]">
                              管理员会话已自动登录，正在进入控制中心...
                            </p>
                          </div>
                        ) : (
                          <>
                            <div>
                              <h2 className="text-lg font-semibold">确认配置并启动</h2>
                              <p className="mt-1 text-xs text-[var(--hub-muted)]">
                                确认以下初始化参数后点击「完成并启动」，系统将自动登录并跳转到控制台概览。
                              </p>
                            </div>

                            <div className="divide-y divide-[var(--hub-border)] rounded-xl border border-[var(--hub-border)] bg-[var(--hub-canvas)] text-xs">
                              <div className="flex items-center justify-between gap-4 px-4 py-3">
                                <span className="text-[var(--hub-muted)]">管理员账户</span>
                                <span className="font-mono font-semibold">{username}</span>
                              </div>
                              <div className="flex items-center justify-between gap-4 px-4 py-3">
                                <span className="text-[var(--hub-muted)]">站点名称</span>
                                <span className="font-medium">{sitename}</span>
                              </div>
                              <div className="flex items-center justify-between gap-4 px-4 py-3">
                                <span className="text-[var(--hub-muted)]">访问模式</span>
                                <span>
                                  {privateSite ? "私有站点 (需登录)" : "公开状态页"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-4 px-4 py-3">
                                <span className="text-[var(--hub-muted)]">默认语言</span>
                                <span>
                                  {language === "zh-CN" ? "简体中文 (zh-CN)" : "English (en-US)"}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-4 px-4 py-3">
                                <span className="text-[var(--hub-muted)]">指标数据库</span>
                                <span className="max-w-[65%] truncate font-mono">
                                  {metricDSN}
                                </span>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </SlideSwap>
                </AutoHeight>
              </div>

              {!completed && (
                <div className="mt-5 flex items-center justify-between">
                  <button
                    type="button"
                    disabled={step === 0 || busy || restoring}
                    onClick={() => {
                      setError("");
                      goToStep(step - 1);
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-4 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)] disabled:opacity-40"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>上一步</span>
                  </button>

                  {step < 4 ? (
                    <button
                      type="button"
                      disabled={restoring}
                      onClick={next}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      <span>{step === 0 ? "开始配置" : "下一步"}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={busy || ready === null}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      {busy ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      <span>{busy ? "正在启动..." : "完成并启动 PulseDeck"}</span>
                    </button>
                  )}
                </div>
              )}
            </form>

            <UploadDialog
              open={restoreOpen}
              onOpenChange={setRestoreOpen}
              title="从备份恢复"
              description={error || "选择之前导出的 PulseDeck / Komari 备份压缩包 (.zip)"}
              accept=".zip"
              dragDropText="拖拽备份 .zip 文件到此处"
              clickToBrowseText="或点击选择文件"
              hintText="仅支持 .zip 备份包"
              uploading={restoring}
              progress={restoreProgress}
              uploadingText="正在恢复备份并重启..."
              cancelUploadLabel="取消"
              onCancelUpload={cancelRestore}
              onFileSelected={restoreBackup}
              closeLabel="关闭"
            />
          </PageMotion>
        )}
      </AnimatePresence>
    </div>
  );
}
