import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Pause,
  PauseCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  checkUptimeMonitor,
  createKumaSource,
  createUptimeMonitor,
  deleteKumaSource,
  deleteUptimeMonitor,
  fetchUptimeSummary,
  formatLatency,
  formatRelativeTime,
  listKumaSources,
  syncKumaSource,
  updateUptimeMonitor,
} from "@/lib/hubApi";
import type {
  KumaSource,
  UptimeMonitor,
  UptimeMonitorPayload,
  UptimeSummaryData,
} from "@/types/hub";
import { HeartbeatStrip, HubCard, HubEmptyState } from "@/components/hub/HubUi";
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

export default function UptimeManagePage() {
  const [summary, setSummary] = useState<UptimeSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [busyActionId, setBusyActionId] = useState<number | null>(null);

  // Create / Edit Monitor Modal
  const [monitorModalOpen, setMonitorModalOpen] = useState(false);
  const [editingMonitor, setEditingMonitor] = useState<UptimeMonitor | null>(null);
  const [form, setForm] = useState<UptimeMonitorPayload>(DEFAULT_FORM);
  const [savingMonitor, setSavingMonitor] = useState(false);

  // Kuma Sync Modal
  const [kumaModalOpen, setKumaModalOpen] = useState(false);
  const [kumaSources, setKumaSources] = useState<KumaSource[]>([]);
  const [kumaForm, setKumaForm] = useState({
    name: "",
    base_url: "",
    slug: "",
    enabled: true,
  });
  const [kumaBusy, setKumaBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const sumRes = await fetchUptimeSummary(24);
      setSummary(sumRes);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载监控列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const m of summary?.monitors ?? []) {
      if (m.group && m.group.trim()) set.add(m.group.trim());
    }
    return Array.from(set).sort();
  }, [summary?.monitors]);

  const filteredMonitors = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (summary?.monitors ?? []).filter((m) => {
      if (selectedGroup !== "all" && (m.group || "默认分组") !== selectedGroup) {
        return false;
      }
      if (q) {
        const hay = `${m.name} ${m.target} ${m.group} ${m.type} ${m.source}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [summary?.monitors, selectedGroup, search]);

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
        toast.success("已创建监控项");
      }
      setMonitorModalOpen(false);
      await loadAll();
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
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "检测失败");
    } finally {
      setBusyActionId(null);
    }
  };

  const handleToggleEnabled = async (mon: UptimeMonitor) => {
    setBusyActionId(mon.id);
    try {
      await updateUptimeMonitor(mon.id, {
        name: mon.name,
        group: mon.group || "默认分组",
        type: mon.type || "http",
        target: mon.target,
        keyword: mon.keyword || "",
        interval_sec: mon.interval_sec || 60,
        timeout_sec: mon.timeout_sec || 10,
        enabled: !mon.enabled,
      });
      toast.success(mon.enabled ? "已暂停探测" : "已恢复探测");
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "状态切换失败");
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
      await loadAll();
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
      await loadAll();
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
      await loadAll();
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
      await loadAll();
      toast.success("已移除数据源");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "移除失败");
    } finally {
      setKumaBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Admin Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--hub-ink)]">
            服务状态监控管理
          </h1>
          <p className="mt-0.5 text-xs text-[var(--hub-muted)]">
            创建并管理 HTTP/Keyword/TCP/Ping 监控项，或同步外部 Uptime Kuma 状态页
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2.5 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>刷新</span>
          </button>

          <button
            type="button"
            onClick={() => void openKumaModal()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)]"
          >
            <Activity className="h-3.5 w-3.5 text-emerald-600" />
            <span>Uptime Kuma 同步源</span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>新建监控</span>
          </button>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <HubCard className="p-4">
          <div className="text-[11px] text-[var(--hub-muted)]">总监控项</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
            {summary?.total ?? 0}
          </div>
        </HubCard>
        <HubCard className="p-4">
          <div className="text-[11px] text-[var(--hub-muted)]">在线</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {summary?.up ?? 0}
          </div>
        </HubCard>
        <HubCard className="p-4">
          <div className="text-[11px] text-[var(--hub-muted)]">异常中断</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-rose-600 dark:text-rose-400">
            {summary?.down ?? 0}
          </div>
        </HubCard>
        <HubCard className="p-4">
          <div className="text-[11px] text-[var(--hub-muted)]">已暂停</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-[var(--hub-muted)]">
            {summary?.paused ?? 0}
          </div>
        </HubCard>
        <HubCard className="col-span-2 p-4 sm:col-span-1">
          <div className="text-[11px] text-[var(--hub-muted)]">24h 综合可用率</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums">
            {summary ? `${summary.overall_uptime.toFixed(2)}%` : "--%"}
          </div>
        </HubCard>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
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

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--hub-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索名称或目标地址..."
            className="h-8 w-56 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] pl-8 pr-7 text-xs text-[var(--hub-ink)] focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Monitors Table */}
      {filteredMonitors.length === 0 && !loading ? (
        <HubEmptyState
          icon={Activity}
          title="暂无 Uptime 监控项目"
          description="点击右上角「新建监控」添加 HTTP/Keyword/TCP/Ping 探测，或通过「Uptime Kuma 同步源」接入已有状态页。"
          action={
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>创建第一个监控</span>
            </button>
          }
        />
      ) : (
        <HubCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--hub-border)] bg-[var(--hub-canvas)] text-[11px] font-medium text-[var(--hub-muted)]">
                  <th className="px-4 py-2.5">监控名称 / 目标</th>
                  <th className="px-4 py-2.5">类型 / 分组</th>
                  <th className="px-4 py-2.5">间隔</th>
                  <th className="px-4 py-2.5">24h 可用率 / 延迟</th>
                  <th className="px-4 py-2.5 w-44">最近心跳</th>
                  <th className="px-4 py-2.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--hub-border)]">
                {filteredMonitors.map((mon) => {
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
                  const busy = busyActionId === mon.id;

                  return (
                    <tr
                      key={mon.id}
                      className={`transition-colors hover:bg-[var(--hub-canvas)]/60 ${
                        !mon.enabled ? "opacity-60" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StatusIcon className={`h-4 w-4 shrink-0 ${statusColor}`} />
                          <span className="font-medium text-[var(--hub-ink)]">
                            {mon.name}
                          </span>
                          {mon.source === "kuma" && (
                            <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[10px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300">
                              Kuma
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 pl-6 font-mono text-[11px] text-[var(--hub-muted)]">
                          {mon.target || "--"}
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--hub-muted)]">
                            {mon.type}
                          </span>
                          <span className="text-[var(--hub-muted)]">
                            {mon.group || "默认分组"}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap font-mono tabular-nums text-[var(--hub-muted)]">
                        {mon.interval_sec}s
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap font-mono tabular-nums">
                        <div className="flex items-center gap-2">
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
                          <span className="text-[var(--hub-muted)]">
                            {formatLatency(mon.last_latency_ms)}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-[var(--hub-muted)]">
                          {formatRelativeTime(mon.last_checked_at)}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <HeartbeatStrip
                          heartbeats={mon.heartbeats}
                          slots={24}
                          heightClass="h-4"
                        />
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleCheckNow(mon.id)}
                            title="立即探测"
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--hub-border)] bg-[var(--hub-surface)] px-2 py-1 text-[11px] font-medium text-[var(--hub-ink)] hover:bg-[var(--hub-canvas)] disabled:opacity-50"
                          >
                            <Play className="h-3 w-3 text-emerald-600" />
                            <span>探测</span>
                          </button>

                          {mon.source !== "kuma" && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleToggleEnabled(mon)}
                                title={mon.enabled ? "暂停监控" : "启用监控"}
                                className="rounded-md p-1.5 text-[var(--hub-muted)] hover:bg-[var(--hub-canvas)] hover:text-[var(--hub-ink)] disabled:opacity-50"
                              >
                                {mon.enabled ? (
                                  <Pause className="h-3.5 w-3.5" />
                                ) : (
                                  <Play className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => openEditModal(mon)}
                                title="编辑"
                                className="rounded-md p-1.5 text-[var(--hub-muted)] hover:bg-[var(--hub-canvas)] hover:text-[var(--hub-ink)]"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleDeleteMonitor(mon)}
                            title="删除"
                            className="rounded-md p-1.5 text-[var(--hub-muted)] hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/60"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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
                      setForm((f) => ({
                        ...f,
                        interval_sec: Number(e.target.value) || 60,
                      }))
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
                      setForm((f) => ({
                        ...f,
                        timeout_sec: Number(e.target.value) || 10,
                      }))
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

            <form
              onSubmit={handleAddKuma}
              className="mt-4 grid grid-cols-1 gap-2.5 text-xs sm:grid-cols-3"
            >
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
                onChange={(e) =>
                  setKumaForm((f) => ({ ...f, base_url: e.target.value }))
                }
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
}
