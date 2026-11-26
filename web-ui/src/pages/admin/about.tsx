import { useEffect, useMemo, useState } from "react";
import { Activity, Blocks, Globe, Server, ShieldCheck } from "lucide-react";
import { useRPC2Call } from "@/contexts/RPC2Context";
import { SettingCardCollapse } from "@/components/admin/SettingCard";
import { Apache2_LICENSE, MIT_LICENSE } from "@/utils/field";
import webDependencies from "@/utils/openSource.web.json";
import goDependencies from "@/utils/openSource.go.json";

const ACKNOWLEDGMENTS = [
  {
    name: "Komari",
    role: "底层探针、WebSocket/RPC 协议与插件扩展引擎",
    url: "https://github.com/komari-monitor/komari",
    license: "MIT",
  },
  {
    name: "Uptime Kuma",
    role: "心跳监测理念与外部 Status Page 兼容数据源",
    url: "https://github.com/louislam/uptime-kuma",
    license: "MIT",
  },
  {
    name: "IPPure",
    role: "出口 IP 欺诈分、ASN 与住宅/原生 IP 纯净度识别接口",
    url: "https://ippure.com",
    license: "Service",
  },
  {
    name: "Radix Themes & Tailwind CSS",
    role: "界面基础原语与设计令牌系统",
    url: "https://tailwindcss.com",
    license: "MIT",
  },
];

export default function AboutPage() {
  const { call } = useRPC2Call();
  const [versionInfo, setVersionInfo] = useState<{
    version?: string;
    hash?: string;
  } | null>(null);
  const [tab, setTab] = useState<"overview" | "licenses">("overview");

  useEffect(() => {
    let active = true;
    void call<unknown, { version?: string; hash?: string }>("common:getVersion")
      .then((res) => {
        if (active && res) setVersionInfo(res);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [call]);

  const dependencies = useMemo(
    () =>
      [
        ...webDependencies,
        ...goDependencies.map((entry) => ({ ...entry, dev: false })),
      ]
        .map((entry) => ({
          ...entry,
          license:
            entry.license === "(Unlicense OR Apache-2.0)"
              ? "Apache-2.0"
              : entry.license,
        }))
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
            a.version.localeCompare(b.version),
        ),
    [],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--hub-ink)]">
            关于 PulseDeck
          </h1>
          <p className="mt-0.5 text-xs text-[var(--hub-muted)]">
            一体化自托管服务器探针、服务可用性与代理节点可观测性控制台
          </p>
        </div>

        <div className="inline-flex rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setTab("overview")}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              tab === "overview"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
            }`}
          >
            产品与架构
          </button>
          <button
            type="button"
            onClick={() => setTab("licenses")}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              tab === "licenses"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
            }`}
          >
            开源致谢与许可证
          </button>
        </div>
      </div>

      {tab === "overview" ? (
        <div className="space-y-5">
          {/* Product Identity Card */}
          <div className="rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 14h4l2-7 4 14 2-7h4" />
                  </svg>
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-[var(--hub-ink)]">
                      PulseDeck v2
                    </h2>
                    <span className="rounded-full border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2 py-0.5 font-mono text-[11px] text-[var(--hub-muted)]">
                      {versionInfo?.version
                        ? `${versionInfo.version}${versionInfo.hash ? ` (${versionInfo.hash.slice(0, 7)})` : ""}`
                        : "v2.0"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--hub-muted)]">
                    前台只读状态展示 · 后台统一资产管理 · 完整插件扩展生态
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-[var(--hub-border)] bg-[var(--hub-canvas)] p-4">
                <Server className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <div className="mt-2.5 text-xs font-semibold">探针节点引擎</div>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--hub-muted)]">
                  实时指标采集、Ping 延迟任务、流量配额与账单追踪。
                </p>
              </div>
              <div className="rounded-xl border border-[var(--hub-border)] bg-[var(--hub-canvas)] p-4">
                <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <div className="mt-2.5 text-xs font-semibold">服务可用性监控</div>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--hub-muted)]">
                  HTTP/Keyword/TCP/Ping 定时探测与 Uptime Kuma 同步源。
                </p>
              </div>
              <div className="rounded-xl border border-[var(--hub-border)] bg-[var(--hub-canvas)] p-4">
                <Globe className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <div className="mt-2.5 text-xs font-semibold">订阅与 IP 纯净度</div>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--hub-muted)]">
                  机场订阅解析、全球拓扑分布图、并发测速与 IPPure 风险评估。
                </p>
              </div>
              <div className="rounded-xl border border-[var(--hub-border)] bg-[var(--hub-canvas)] p-4">
                <Blocks className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <div className="mt-2.5 text-xs font-semibold">插件扩展机制</div>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--hub-muted)]">
                  支持插件市场安装、独立权限沙箱、自定义页面与通知渠道扩展。
                </p>
              </div>
            </div>
          </div>

          {/* Core Acknowledgments */}
          <div className="rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-6">
            <div className="flex items-center gap-2 border-b border-[var(--hub-border)] pb-3">
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-semibold text-[var(--hub-ink)]">
                核心技术栈与开源致谢
              </h3>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {ACKNOWLEDGMENTS.map((item) => (
                <div
                  key={item.name}
                  className="flex items-start justify-between gap-3 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] p-3.5"
                >
                  <div>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-[var(--hub-ink)] hover:underline"
                    >
                      {item.name}
                    </a>
                    <p className="mt-1 text-[11px] text-[var(--hub-muted)]">
                      {item.role}
                    </p>
                  </div>
                  <span className="shrink-0 rounded border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--hub-muted)]">
                    {item.license}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="space-y-3">
            <SettingCardCollapse
              title="MIT License"
              description="PulseDeck & Komari Engine Open Source License"
            >
              <pre className="text-wrap text-xs">{MIT_LICENSE}</pre>
            </SettingCardCollapse>
            <SettingCardCollapse
              title="Apache License 2.0"
              description="Version 2.0, January 2004"
            >
              <pre className="text-wrap text-xs">{Apache2_LICENSE}</pre>
            </SettingCardCollapse>
          </div>

          <div className="rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-5">
            <h2 className="text-sm font-semibold text-[var(--hub-ink)]">
              第三方开源依赖 ({dependencies.length})
            </h2>
            <ul className="mt-3 grid grid-cols-1 gap-1.5 text-xs text-[var(--hub-muted)] sm:grid-cols-2">
              {dependencies.map((entry) => (
                <li key={`${entry.name}@${entry.version}`} className="truncate">
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-[var(--hub-ink)] hover:underline"
                  >
                    {entry.name}
                  </a>{" "}
                  <span className="font-mono text-[11px]">
                    {entry.version.startsWith("v")
                      ? entry.version
                      : `v${entry.version}`}
                  </span>
                  {" · "}
                  <span>{entry.license}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
