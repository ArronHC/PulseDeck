import i18n from "@/i18n/config";
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
  SubscriptionCapabilities,
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

export interface NodeFilterParams {
  subscription_id?: number | string;
  country?: string;
  search?: string;
  only_enabled?: boolean;
}

function buildNodeFilterQuery(params?: NodeFilterParams): string {
  const qs = new URLSearchParams();
  if (params?.subscription_id !== undefined && params.subscription_id !== "") {
    qs.set("subscription_id", String(params.subscription_id));
  }
  if (params?.country) qs.set("country", params.country);
  if (params?.search) qs.set("search", params.search);
  if (params?.only_enabled) qs.set("only_enabled", "true");
  const encoded = qs.toString();
  return encoded ? `?${encoded}` : "";
}

export function fetchSubscriptionNodes(
  params?: NodeFilterParams,
): Promise<SubscriptionNode[]> {
  return api.getData<SubscriptionNode[]>(
    `/api/subscriptions/nodes${buildNodeFilterQuery(params)}`,
  );
}

export function fetchAdminSubscriptionNodes(
  params?: NodeFilterParams,
): Promise<SubscriptionNode[]> {
  return api.getData<SubscriptionNode[]>(
    `/api/admin/subscriptions/nodes${buildNodeFilterQuery(params)}`,
  );
}

export function fetchSubscriptionMap(): Promise<SubscriptionMapData> {
  return api.getData<SubscriptionMapData>("/api/subscriptions/map");
}

export function fetchIPPureSelf(): Promise<IPPureInfo | null> {
  return api.getData<IPPureInfo | null>("/api/subscriptions/ippure-self");
}

export function fetchAdminIPPureSelf(): Promise<IPPureInfo | null> {
  return api.getData<IPPureInfo | null>("/api/admin/subscriptions/ippure-self");
}

export function fetchSubscriptionCapabilities(): Promise<SubscriptionCapabilities> {
  return api.getData<SubscriptionCapabilities>(
    "/api/admin/subscriptions/capabilities",
  );
}

export function createSubscription(payload: {
  name: string;
  url?: string;
  raw_content?: string;
  auto_update_hours?: number;
  auto_speed_hours?: number;
  auto_purity_hours?: number;
  expire_alert_days?: number;
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
    auto_speed_hours: number;
    auto_purity_hours: number;
    expire_alert_days: number;
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

export function reportSpeedResults(
  results: SpeedResultReportItem[],
): Promise<SubscriptionNode[]> {
  return api.postData<SubscriptionNode[]>(
    "/api/admin/subscriptions/speed-results",
    { results },
  );
}

export interface SpeedTestStreamStartEvent {
  total: number;
  mode?: string;
}

export interface SpeedTestStreamNodeEvent {
  completed: number;
  total: number;
  node: SubscriptionNode;
}

export interface SpeedTestStreamErrorEvent {
  message?: string;
}

export interface SpeedTestStreamDoneEvent {
  completed?: number;
  total?: number;
}

export interface SpeedTestStreamHandlers {
  onStart?: (event: SpeedTestStreamStartEvent) => void;
  onNode?: (event: SpeedTestStreamNodeEvent) => void;
  onError?: (event: SpeedTestStreamErrorEvent) => void;
  onDone?: (event: SpeedTestStreamDoneEvent) => void;
}

function dispatchSpeedStreamEvent(
  eventName: string,
  rawData: string,
  handlers: SpeedTestStreamHandlers,
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
      handlers.onStart?.(parsed as SpeedTestStreamStartEvent);
      break;
    case "node":
      handlers.onNode?.(parsed as SpeedTestStreamNodeEvent);
      break;
    case "error":
      handlers.onError?.(parsed as SpeedTestStreamErrorEvent);
      break;
    case "done":
      handlers.onDone?.(parsed as SpeedTestStreamDoneEvent);
      break;
  }
}

function parseSseEventBlock(
  block: string,
  handlers: SpeedTestStreamHandlers,
): void {
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

/** Stream server-side node speedtests over SSE with cancellation support. */
export async function streamTestSubscriptionSpeed(
  payload: {
    node_ids?: number[];
    subscription_id?: number;
    mode?: "tcp" | "http" | "download";
    concurrency?: number;
  },
  handlers: SpeedTestStreamHandlers,
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
    let parsed: unknown = null;
    try {
      const text = await response.text();
      if (text) {
        parsed = JSON.parse(text);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "message" in parsed &&
          typeof (parsed as { message?: unknown }).message === "string" &&
          (parsed as { message: string }).message
        ) {
          message = (parsed as { message: string }).message;
        }
      }
    } catch {
      // Ignore body parse errors and keep HTTP status message.
    }
    throw new ApiError(response.status, message, parsed, response.statusText);
  }

  if (!response.body) {
    throw new Error(i18n.t("pulse.common.streamNotSupported"));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const flush = (final: boolean) => {
    const trailingCR = !final && buffer.endsWith("\r");
    let normalized = (trailingCR ? buffer.slice(0, -1) : buffer).replace(/\r\n/g, "\n");
    if (final) {
      normalized = normalized.replace(/\r/g, "\n");
    }
    const blocks = normalized.split("\n\n");
    if (final) {
      buffer = "";
      for (const block of blocks) {
        if (block.trim()) parseSseEventBlock(block, handlers);
      }
    } else {
      const remainder = blocks.pop() ?? "";
      for (const block of blocks) {
        if (block.trim()) parseSseEventBlock(block, handlers);
      }
      buffer = trailingCR ? `${remainder}\r` : remainder;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        flush(true);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      flush(false);
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
    const label = i18n.t("pulse.purity.untested");
    return {
      label,
      shortLabel: label,
      tone: "neutral",
      badgeClass:
        "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800/80 dark:text-zinc-400 dark:border-zinc-700",
      dotClass: "bg-zinc-400",
    };
  }
  if (score <= 25) {
    const label = i18n.t("pulse.purity.veryPure");
    return {
      label,
      shortLabel: label,
      tone: "emerald",
      badgeClass:
        "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70",
      dotClass: "bg-emerald-500",
    };
  }
  if (score <= 50) {
    const label = i18n.t("pulse.purity.lowRisk");
    return {
      label,
      shortLabel: label,
      tone: "blue",
      badgeClass:
        "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/70",
      dotClass: "bg-blue-500",
    };
  }
  if (score <= 75) {
    const label = i18n.t("pulse.purity.mediumRisk");
    return {
      label,
      shortLabel: label,
      tone: "amber",
      badgeClass:
        "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70",
      dotClass: "bg-amber-500",
    };
  }
  const label = i18n.t("pulse.purity.highRisk");
  return {
    label,
    shortLabel: label,
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
  if (ms < 0) return i18n.t("pulse.common.timeout");
  return `${Math.round(ms)} ms`;
}

export function formatExpiryCountdown(expireUnix: number | undefined | null): {
  text: string;
  urgent: boolean;
} {
  if (!expireUnix || expireUnix <= 0) {
    return { text: i18n.t("pulse.common.longTerm"), urgent: false };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const diff = expireUnix - nowSec;
  if (diff <= 0) {
    return { text: i18n.t("pulse.common.expired"), urgent: true };
  }
  const days = Math.floor(diff / 86400);
  if (days >= 365) {
    return {
      text: i18n.t("pulse.common.remainingYears", { count: Math.floor(days / 365) }),
      urgent: false,
    };
  }
  if (days >= 1) {
    return {
      text: i18n.t("pulse.common.remainingDays", { count: days }),
      urgent: days <= 7,
    };
  }
  const hours = Math.max(1, Math.floor(diff / 3600));
  return {
    text: i18n.t("pulse.common.remainingHours", { count: hours }),
    urgent: true,
  };
}

export function formatRelativeTime(iso: string | undefined | null): string {
  if (!iso) return "--";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return i18n.t("pulse.common.secondsAgo", { count: diffSec });
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return i18n.t("pulse.common.minutesAgo", { count: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return i18n.t("pulse.common.hoursAgo", { count: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  return i18n.t("pulse.common.daysAgo", { count: diffDay });
}

export type TestMethodTone =
  | "emerald"
  | "blue"
  | "indigo"
  | "sky"
  | "zinc"
  | "amber";

export interface TestMethodDisplay {
  label: string;
  tone: TestMethodTone;
  title: string;
  badgeClass: string;
}

/** Format speedtest method identifier into concise badge metadata and tooltip. */
export function formatTestMethod(method?: string): TestMethodDisplay | null {
  const key = (method || "").trim();
  if (!key) return null;
  switch (key) {
    case "proxy_http":
      return {
        label: i18n.t("pulse.speedMethod.proxyHttpLabel"),
        tone: "emerald",
        title: i18n.t("pulse.speedMethod.proxyHttpTitle"),
        badgeClass:
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-300",
      };
    case "proxy_download":
      return {
        label: i18n.t("pulse.speedMethod.proxyDownloadLabel"),
        tone: "blue",
        title: i18n.t("pulse.speedMethod.proxyDownloadTitle"),
        badgeClass:
          "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/70 dark:bg-blue-950/60 dark:text-blue-300",
      };
    case "browser_http":
      return {
        label: i18n.t("pulse.speedMethod.browserHttpLabel"),
        tone: "indigo",
        title: i18n.t("pulse.speedMethod.browserHttpTitle"),
        badgeClass:
          "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800/70 dark:bg-indigo-950/60 dark:text-indigo-300",
      };
    case "browser_probe":
      return {
        label: i18n.t("pulse.speedMethod.browserProbeLabel"),
        tone: "amber",
        title: i18n.t("pulse.speedMethod.browserProbeTitle"),
        badgeClass:
          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-300",
      };
    case "browser_tcp":
      return {
        label: i18n.t("pulse.speedMethod.browserTcpLabel"),
        tone: "amber",
        title: i18n.t("pulse.speedMethod.browserTcpTitle"),
        badgeClass:
          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-300",
      };
    case "tcp":
      return {
        label: i18n.t("pulse.speedMethod.tcpLabel"),
        tone: "zinc",
        title: i18n.t("pulse.speedMethod.tcpTitle"),
        badgeClass:
          "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300",
      };
    case "tcp_fallback":
      return {
        label: i18n.t("pulse.speedMethod.tcpFallbackLabel"),
        tone: "amber",
        title: i18n.t("pulse.speedMethod.tcpFallbackTitle"),
        badgeClass:
          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-300",
      };
    default:
      return {
        label: key,
        tone: "zinc",
        title: key,
        badgeClass:
          "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300",
      };
  }
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
