export type HealthStatus = "operational" | "degraded" | "outage";

export interface SparklinePoint {
  t: string;
  v: number;
}

export interface OverviewProbeNode {
  uuid: string;
  name: string;
  region: string;
  online: boolean;
  cpu: number;
  mem_percent: number;
  net_in: number;
  net_out: number;
}

export interface OverviewProbes {
  total: number;
  online: number;
  offline: number;
  avg_cpu: number;
  avg_mem_percent: number;
  total_net_in_bps: number;
  total_net_out_bps: number;
  sparkline: SparklinePoint[];
  top_nodes: OverviewProbeNode[];
}

export interface OverviewUptimeMonitor {
  id: number;
  name: string;
  type: string;
  source: string;
  status: number; // 0=down, 1=up, 2=pending/degraded
  uptime_24h: number;
  latency_ms: number;
  recent_beats: number[];
}

export interface OverviewUptime {
  total_monitors: number;
  up: number;
  down: number;
  degraded: number;
  overall_uptime_24h: number;
  avg_latency_ms: number;
  sparkline: SparklinePoint[];
  top_monitors: OverviewUptimeMonitor[];
}

export interface OverviewSubscriptionItem {
  id: number;
  name: string;
  node_count: number;
  upload: number;
  download: number;
  total: number;
  expire: number;
  min_latency_ms: number;
  best_fraud_score: number;
}

export interface OverviewCountryCount {
  country_code: string;
  country_name: string;
  lat: number;
  lng: number;
  count: number;
  min_latency_ms: number;
  avg_fraud_score: number;
}

export interface OverviewSubscriptions {
  total_subscriptions: number;
  total_nodes: number;
  available_nodes: number;
  avg_latency_ms: number;
  pure_nodes: number;
  residential_nodes: number;
  sparkline: SparklinePoint[];
  items: OverviewSubscriptionItem[];
  country_counts: OverviewCountryCount[];
}

export interface OverviewEvent {
  id: string;
  source: string;
  severity: "info" | "warning" | "error" | string;
  title: string;
  detail: string;
  created_at: string;
}

export interface OverviewData {
  updated_at: string;
  health_status: HealthStatus;
  active_alerts: number;
  probes: OverviewProbes;
  uptime: OverviewUptime;
  subscriptions: OverviewSubscriptions;
  recent_events: OverviewEvent[];
}

// ============================================================================
// Uptime Types
// ============================================================================

export type UptimeMonitorType = "http" | "tcp" | "ping" | "keyword" | "kuma";

export interface UptimeHeartbeat {
  status: number; // 0=down, 1=up, 2=pending/degraded
  latency_ms: number;
  message: string;
  checked_at: string;
}

export interface UptimeMonitor {
  id: number;
  name: string;
  group: string;
  type: UptimeMonitorType | string;
  source: "local" | "kuma" | string;
  target: string;
  keyword: string;
  interval_sec: number;
  timeout_sec: number;
  enabled: boolean;
  status: number;
  uptime_24h: number;
  uptime_30d: number;
  avg_latency_ms: number;
  last_latency_ms: number;
  last_checked_at: string;
  last_message: string;
  heartbeats: UptimeHeartbeat[];
}

export interface UptimeLatencyPoint {
  t: string;
  avg_ms: number;
  up_rate: number;
}

export interface UptimeSummaryData {
  health_status: HealthStatus;
  overall_uptime: number;
  avg_latency_ms: number;
  total: number;
  up: number;
  down: number;
  paused: number;
  latency_series: UptimeLatencyPoint[];
  monitors: UptimeMonitor[];
}

export interface UptimeIncident {
  id: number | string;
  monitor_id: number;
  monitor_name: string;
  status: "down" | "resolved" | string;
  message: string;
  started_at: string;
  resolved_at?: string;
  duration_sec?: number;
}

export interface KumaSource {
  id: number;
  name: string;
  base_url: string;
  slug: string;
  enabled: boolean;
  last_synced_at?: string;
  last_error?: string;
}

export interface UptimeMonitorPayload {
  name: string;
  group: string;
  type: string;
  target: string;
  keyword?: string;
  interval_sec: number;
  timeout_sec: number;
  enabled: boolean;
}

// ============================================================================
// Subscriptions, Map & IPPure Types
// ============================================================================

export interface SubscriptionItem {
  id: number;
  name: string;
  source_type: "url" | "manual" | string;
  masked_url?: string;
  upload: number;
  download: number;
  total: number;
  expire: number;
  node_count: number;
  available_count: number;
  auto_update_hours: number;
  enabled: boolean;
  last_synced_at?: string;
  last_error?: string;
}

export interface IPPureInfo {
  ip: string;
  asn: number;
  as_organization: string;
  country: string;
  country_code: string;
  region: string;
  city: string;
  longitude: number;
  latitude: number;
  fraud_score: number;
  is_residential: boolean;
  is_broadcast: boolean;
  checked_at: string;
  error?: string;
}

export interface SubscriptionNode {
  id: number;
  subscription_id: number;
  subscription_name: string;
  name: string;
  protocol: string;
  host: string;
  port: number;
  country_code: string;
  country_name: string;
  city: string;
  lat: number;
  lng: number;
  enabled: boolean;
  latency_ms: number; // -1 if failed, 0 if untested
  download_mbps: number;
  test_status: "untested" | "ok" | "timeout" | "error" | string;
  tested_at?: string;
  ippure?: IPPureInfo | null;
}

export interface MapCountry {
  country_code: string;
  country_name: string;
  lat: number;
  lng: number;
  node_count: number;
  available_count: number;
  min_latency_ms: number;
  avg_latency_ms: number;
  avg_fraud_score: number;
  residential_count: number;
}

export interface MapMarker {
  node_id: number;
  name: string;
  country_code: string;
  city: string;
  lat: number;
  lng: number;
  latency_ms: number;
  fraud_score: number;
  is_residential: boolean;
}

export interface SubscriptionMapData {
  countries: MapCountry[];
  markers: MapMarker[];
}
