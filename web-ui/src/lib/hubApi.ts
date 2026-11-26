import { ApiError, api, requestData } from "@/lib/http";
import type {
  AdminOnboardingState,
  AdminOnboardingUpdatePayload,
  InstallCompletePayload,
  InstallStatusData,
  InstallTestDBResult,
  IPPureInfo,
  KumaSource,
  OverviewData,
  SpeedResultReportItem,
  SubscriptionItem,
  SubscriptionMapData,
  SubscriptionNode,
  UptimeHeartbeat,
  UptimeIncident,
  UptimeMonitor,
  UptimeMonitorPayload,
  UptimeSummaryData,
} from "@/types/hub";

// ============================================================================
// Overview
// ============================================================================

export function fetchOverview(hours = 24): Promise<OverviewData> {
  return api.getData<OverviewData>(`/api/overview?hours=${hours}`);
}

// ============================================================================
// Uptime
// ============================================================================

export function fetchUptimeSummary(hours = 24): Promise<UptimeSummaryData> {
  return api.getData<UptimeSummaryData>(`/api/uptime/summary?hours=${hours}`);
}

export function fetchUptimeMonitorHistory(
  id: number,
  hours = 24,
): Promise<{ heartbeats: UptimeHeartbeat[] } | UptimeHeartbeat[]> {
  return api.getData(`/api/uptime/monitors/${id}/history?hours=${hours}`);
}

export function fetchUptimeIncidents(limit = 30): Promise<UptimeIncident[]> {
  return api.getData<UptimeIncident[]>(`/api/uptime/incidents?limit=${limit}`);
}

export function createUptimeMonitor(payload: UptimeMonitorPayload): Promise<UptimeMonitor> {
  return api.postData<UptimeMonitor>("/api/admin/uptime/monitors", payload);
}

export function updateUptimeMonitor(
  id: number,
  payload: Partial<UptimeMonitorPayload>,
): Promise<UptimeMonitor> {
  return requestData<UptimeMonitor>(`/api/admin/uptime/monitors/${id}`, {
    method: "PUT",
    json: payload,
  });
}

export function deleteUptimeMonitor(id: number): Promise<void> {
  return requestData<void>(`/api/admin/uptime/monitors/${id}`, {
    method: "DELETE",
  });
}

export function checkUptimeMonitor(id: number): Promise<UptimeHeartbeat> {
  return api.postData<UptimeHeartbeat>(`/api/admin/uptime/monitors/${id}/check`, {});
}

export function listKumaSources(): Promise<KumaSource[]> {
  return api.getData<KumaSource[]>("/api/admin/uptime/kuma-sources");
}

export function createKumaSource(payload: {
  name: string;
  base_url: string;
  slug: string;
  enabled: boolean;
}): Promise<KumaSource> {
  return api.postData<KumaSource>("/api/admin/uptime/kuma-sources", payload);
}

export function deleteKumaSource(id: number): Promise<void> {
  return requestData<void>(`/api/admin/uptime/kuma-sources/${id}`, {
    method: "DELETE",
  });
}

export function syncKumaSource(id: number): Promise<unknown> {
  return api.postData(`/api/admin/uptime/kuma-sources/${id}/sync`, {});
}

// ============================================================================
// Subscriptions, Map, Speedtest & IPPure
// ============================================================================

export function fetchSubscriptions(): Promise<SubscriptionItem[]> {
  return api.getData<SubscriptionItem[]>("/api/subscriptions");
}

export function fetchAdminSubscriptions(): Promise<SubscriptionItem[]> {
  return api.getData<SubscriptionItem[]>("/api/admin/subscriptions");
}

// ============================================================================
// Install Wizard & Admin Onboarding
// ============================================================================

export function fetchInstallStatus(): Promise<InstallStatusData> {
  return requestData<InstallStatusData>("/api/install/status", { cache: "no-store" });
}

export function testInstallDatabase(metric_dsn: string): Promise<InstallTestDBResult> {
  return requestData<InstallTestDBResult>("/api/install/test-db", {
    method: "POST",
    json: { metric_dsn },
    cache: "no-store",
  });
}

export function completeInstall(payload: InstallCompletePayload): Promise<unknown> {
  return requestData("/api/install/complete", {
    method: "POST",
    json: payload,
    cache: "no-store",
  });
}

export function fetchAdminOnboarding(): Promise<AdminOnboardingState> {
  return api.getData<AdminOnboardingState>("/api/admin/onboarding", {
    cache: "no-store",
  });
}

export function updateAdminOnboarding(
  payload: AdminOnboardingUpdatePayload,
): Promise<AdminOnboardingState> {
  return api.postData<AdminOnboardingState>("/api/admin/onboarding", payload, {
    cache: "no-store",
  });
}

export function fetchSubscriptionNodes(params?: {
  subscription_id?: number | string;
  country?: string;
  search?: string;
  only_enabled?: boolean;
}): Promise<SubscriptionNode[]> {
  const qs = new URLSearchParams();
  if (params?.subscription_id !== undefined && params.subscription_id !== "") {
    qs.set("subscription_id", String(params.subscription_id));
  }
  if (params?.country) qs.set("country", params.country);
  if (params?.search) qs.set("search", params.search);
  if (params?.only_enabled) qs.set("only_enabled", "true");
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return api.getData<SubscriptionNode[]>(`/api/subscriptions/nodes${suffix}`);
}

export function fetchSubscriptionMap(): Promise<SubscriptionMapData> {
  return api.getData<SubscriptionMapData>("/api/subscriptions/map");
}

export function fetchIPPureSelf(): Promise<IPPureInfo | null> {
  return api.getData<IPPureInfo | null>("/api/subscriptions/ippure-self");
}

export function createSubscription(payload: {
  name: string;
  url?: string;
  raw_content?: string;
  auto_update_hours?: number;
}): Promise<SubscriptionItem> {
  return api.postData<SubscriptionItem>("/api/admin/subscriptions", payload);
}

export function updateSubscription(
  id: number,
  payload: Partial<{
    name: string;
    url: string;
    raw_content: string;
    auto_update_hours: number;
    enabled: boolean;
  }>,
): Promise<SubscriptionItem> {
  return requestData<SubscriptionItem>(`/api/admin/subscriptions/${id}`, {
    method: "PUT",
    json: payload,
  });
}

export function deleteSubscription(id: number): Promise<void> {
  return requestData<void>(`/api/admin/subscriptions/${id}`, {
    method: "DELETE",
  });
}

export function refreshSubscription(id: number): Promise<SubscriptionItem> {
  return api.postData<SubscriptionItem>(`/api/admin/subscriptions/${id}/refresh`, {});
}

export function patchSubscriptionNode(
  id: number,
  payload: Partial<{
    enabled: boolean;
    country_code: string;
    city: string;
    lat: number;
    lng: number;
  }>,
): Promise<SubscriptionNode> {
  return requestData<SubscriptionNode>(`/api/admin/subscriptions/nodes/${id}`, {
    method: "PATCH",
    json: payload,
  });
}

export function testSubscriptionSpeed(payload: {
  node_ids?: number[];
  subscription_id?: number;
  mode?: "tcp" | "http" | "download";
  concurrency?: number;
}): Promise<unknown> {
  return api.postData("/api/admin/subscriptions/test-speed", payload);
}

export function reportSubscriptionSpeedResults(
  results: SpeedResultReportItem[],
): Promise<SubscriptionNode[]> {
  return api.postData<SubscriptionNode[]>(
    "/api/admin/subscriptions/speed-results",
    { results },
  );
}

export interface SpeedStreamHandlers {
  onStart?: (data: { total: number }) => void;
  onNode?: (data: {
    completed: number;
    total: number;
    node: SubscriptionNode;
  }) => void;
  onError?: (data: { message: string }) => void;
  onDone?: (data: { completed: number; total: number }) => void;
}

function dispatchSpeedStreamEvent(
  eventName: string,
  rawData: string,
  handlers: SpeedStreamHandlers,
): void {
  if (!rawData) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    return;
  }
  switch (eventName) {
    case "start":
      handlers.onStart?.(parsed as { total: number });
      break;
    case "node":
      handlers.onNode?.(
        parsed as { completed: number; total: number; node: SubscriptionNode },
      );
      break;
    case "error":
      handlers.onError?.(parsed as { message: string });
      break;
    case "done":
      handlers.onDone?.(parsed as { completed: number; total: number });
      break;
    default:
      break;
  }
}

function parseSseBlock(block: string, handlers: SpeedStreamHandlers): void {
  const lines = block.split("\n");
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      const value = line.slice(5);
      dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
    }
  }

  if (dataLines.length > 0) {
    dispatchSpeedStreamEvent(eventName, dataLines.join("\n"), handlers);
  }
}

export async function testSubscriptionSpeedStream(
  payload: {
    node_ids?: number[];
    subscription_id?: number;
    mode?: "tcp" | "http" | "download";
    concurrency?: number;
  },
  handlers: SpeedStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/admin/subscriptions/test-speed/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}${response.statusText ? " " + response.statusText : ""}`;
    let body: unknown = null;
    try {
      const text = await response.text();
      if (text) {
        body = JSON.parse(text);
        if (
          typeof body === "object" &&
          body !== null &&
          "message" in body &&
          typeof (body as { message?: unknown }).message === "string" &&
          (body as { message: string }).message
        ) {
          message = (body as { message: string }).message;
        }
      }
    } catch {
      // Ignore non-JSON error body
    }
    throw new ApiError(response.status, message, body, response.statusText);
  }

  if (!response.body) {
    throw new Error("当前浏览器不支持流式响应读取");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const drainBlocks = (flushAll: boolean) => {
    // Normalize CRLF safely: hold back a trailing '\r' unless flushing at EOF.
    const endsWithCR = !flushAll && buffer.endsWith("\r");
    const safePart = endsWithCR ? buffer.slice(0, -1) : buffer;
    let normalized = safePart.replace(/\r\n/g, "\n");
    if (flushAll) {
      normalized = normalized.replace(/\r/g, "\n");
    }

    const parts = normalized.split("\n\n");
    if (flushAll) {
      buffer = "";
      for (const part of parts) {
        if (part.trim()) parseSseBlock(part, handlers);
      }
    } else {
      const remainder = parts.pop() ?? "";
      for (const part of parts) {
        if (part.trim()) parseSseBlock(part, handlers);
      }
      buffer = endsWithCR ? `${remainder}\r` : remainder;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        drainBlocks(true);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      drainBlocks(false);
    }
  } finally {
    reader.releaseLock();
  }
}

export function testSubscriptionPurity(payload: {
  node_ids?: number[];
  subscription_id?: number;
  proxy_url?: string;
  direct?: boolean;
}): Promise<unknown> {
  return api.postData("/api/admin/subscriptions/test-purity", payload);
}

export function checkIPPureNow(payload?: {
  proxy_url?: string;
}): Promise<IPPureInfo> {
  return api.postData<IPPureInfo>("/api/admin/subscriptions/ippure-check", payload ?? {});
}

// ============================================================================
// Shared UI Formatters & Classification Helpers
// ============================================================================

export function getFraudTier(score: number | undefined | null): {
  label: string;
  shortLabel: string;
  tone: "emerald" | "blue" | "amber" | "rose" | "neutral";
  badgeClass: string;
  dotClass: string;
} {
  if (score === undefined || score === null || score < 0) {
    return {
      label: "未检测",
      shortLabel: "未检测",
      tone: "neutral",
      badgeClass:
        "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800/80 dark:text-zinc-400 dark:border-zinc-700",
      dotClass: "bg-zinc-400",
    };
  }
  if (score <= 25) {
    return {
      label: "极纯净",
      shortLabel: "极纯净",
      tone: "emerald",
      badgeClass:
        "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70",
      dotClass: "bg-emerald-500",
    };
  }
  if (score <= 50) {
    return {
      label: "低风险",
      shortLabel: "低风险",
      tone: "blue",
      badgeClass:
        "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/70",
      dotClass: "bg-blue-500",
    };
  }
  if (score <= 75) {
    return {
      label: "中风险",
      shortLabel: "中风险",
      tone: "amber",
      badgeClass:
        "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70",
      dotClass: "bg-amber-500",
    };
  }
  return {
    label: "高风险",
    shortLabel: "高风险",
    tone: "rose",
    badgeClass:
      "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/70",
    dotClass: "bg-rose-500",
  };
}

export function getLatencyBadgeClass(ms: number): string {
  if (ms < 0) {
    return "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/70";
  }
  if (ms === 0) {
    return "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700";
  }
  if (ms <= 80) {
    return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70";
  }
  if (ms <= 180) {
    return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/70";
  }
  return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70";
}

export function formatLatency(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || ms === 0) return "--";
  if (ms < 0) return "超时";
  return `${Math.round(ms)} ms`;
}

export function formatExpiryCountdown(expireUnix: number | undefined | null): {
  text: string;
  urgent: boolean;
} {
  if (!expireUnix || expireUnix <= 0) {
    return { text: "长期有效", urgent: false };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const diff = expireUnix - nowSec;
  if (diff <= 0) {
    return { text: "已过期", urgent: true };
  }
  const days = Math.floor(diff / 86400);
  if (days >= 365) {
    return { text: `剩余 ${Math.floor(days / 365)} 年`, urgent: false };
  }
  if (days >= 1) {
    return { text: `剩余 ${days} 天`, urgent: days <= 7 };
  }
  const hours = Math.max(1, Math.floor(diff / 3600));
  return { text: `剩余 ${hours} 小时`, urgent: true };
}

export function formatRelativeTime(iso: string | undefined | null): string {
  if (!iso) return "--";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s 前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m 前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h 前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d 前`;
}

export function formatDurationCompact(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0) return "0s";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  if (mins < 60) return remSec ? `${mins}m ${remSec}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMin = mins % 60;
  return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
}
