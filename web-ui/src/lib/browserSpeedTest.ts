import type { SpeedResultReportItem, SubscriptionNode } from "@/types/hub";

/**
 * Browser-native latency probe running directly inside the user's own network
 * environment (local ISP, local DNS resolver, and any local system proxy/VPN).
 *
 * Uses `fetch(..., { mode: "no-cors" })` + `performance.now()` so probes never
 * touch the PulseDeck server's network path and reflect the visitor's real RTT.
 */

export type BrowserSpeedTestResult = SpeedResultReportItem;

export interface BrowserSpeedTestOptions {
  /** Maximum concurrent probes (defaults to 6). */
  concurrency?: number;
  /** Per-probe timeout in milliseconds (defaults to 5000). */
  timeoutMs?: number;
  /** Optional AbortSignal to cancel remaining and in-flight probes. */
  signal?: AbortSignal;
  /** Invoked immediately before a node begins probing. */
  onNodeStart?: (nodeId: number) => void;
  /** Invoked immediately after a node completes probing. */
  onNodeResult?: (result: BrowserSpeedTestResult) => void;
}

const DEFAULT_CONCURRENCY = 6;
const DEFAULT_TIMEOUT_MS = 5000;
const INSTANT_REJECT_THRESHOLD_MS = 3;

const TLS_PORTS = new Set([443, 8443, 2053, 2083, 2087, 2096]);
const NON_TLS_PORTS = new Set([80, 8080, 8880]);
const TLS_PROTOCOLS = new Set([
  "trojan",
  "vless",
  "hy2",
  "hysteria2",
  "tuic",
  "https",
]);

type ProbeOutcome =
  | { kind: "ok"; elapsed: number }
  | { kind: "timeout"; elapsed: number }
  | { kind: "type_error"; elapsed: number }
  | { kind: "aborted" };

function formatHostForUrl(rawHost: string): string {
  const trimmed = rawHost.trim();
  if (!trimmed) return "";
  if (trimmed.includes(":") && !trimmed.startsWith("[")) {
    return `[${trimmed}]`;
  }
  return trimmed;
}

function buildProbeUrls(node: SubscriptionNode): string[] {
  const host = formatHostForUrl(node.host || "");
  const port = Number(node.port);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return [];
  }

  const isHttpsPage =
    typeof window !== "undefined" && window.location?.protocol === "https:";
  if (isHttpsPage) {
    // Browsers block http:// subresources from https:// pages (Mixed Content).
    return [`https://${host}:${port}/`];
  }

  const proto = (node.protocol || "").trim().toLowerCase();
  if (TLS_PORTS.has(port) || TLS_PROTOCOLS.has(proto)) {
    return [`https://${host}:${port}/`];
  }

  if (NON_TLS_PORTS.has(port) || proto === "http") {
    return [`http://${host}:${port}/`, `https://${host}:${port}/`];
  }

  // Non-HTTP proxy ports (e.g. ss/vmess/socks5) on http: pages: probe http://
  // first to measure TCP SYN+ACK without TLS handshake overhead, with https:// fallback.
  return [`http://${host}:${port}/`, `https://${host}:${port}/`];
}

async function probeOnce(
  url: string,
  timeoutMs: number,
  outerSignal?: AbortSignal,
): Promise<ProbeOutcome> {
  if (outerSignal?.aborted) {
    return { kind: "aborted" };
  }

  const controller = new AbortController();
  let timedOut = false;

  const onOuterAbort = () => {
    controller.abort();
  };
  outerSignal?.addEventListener("abort", onOuterAbort, { once: true });

  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const startedAt = performance.now();
  try {
    await fetch(url, {
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      signal: controller.signal,
    });
    return { kind: "ok", elapsed: performance.now() - startedAt };
  } catch (err) {
    const elapsed = performance.now() - startedAt;
    if (outerSignal?.aborted) {
      return { kind: "aborted" };
    }
    if (
      timedOut ||
      (err instanceof DOMException && err.name === "AbortError")
    ) {
      return { kind: "timeout", elapsed };
    }
    return { kind: "type_error", elapsed };
  } finally {
    globalThis.clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}

async function probeSingleUrl(
  nodeId: number,
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<BrowserSpeedTestResult | null> {
  const first = await probeOnce(url, timeoutMs, signal);
  if (first.kind === "aborted") return null;

  if (first.kind === "ok") {
    // Run a quick 2nd probe so cold DNS lookup doesn't inflate the RTT.
    const second = await probeOnce(url, timeoutMs, signal);
    if (second.kind === "aborted") return null;
    const rtt = second.kind === "ok" ? second.elapsed : first.elapsed;
    return {
      node_id: nodeId,
      latency_ms: Math.max(1, Math.round(rtt)),
      download_mbps: 0,
      test_status: "ok",
      test_message: "本机网络 HTTP/TLS 探测成功",
    };
  }

  if (first.kind === "timeout") {
    return {
      node_id: nodeId,
      latency_ms: -1,
      download_mbps: 0,
      test_status: "timeout",
      test_message: "本机网络探测超时",
    };
  }

  // Browser emitted TypeError (non-HTTP proxy port, self-signed TLS, or local/DNS block).
  const isOffline =
    typeof navigator !== "undefined" && navigator.onLine === false;
  if (isOffline || first.elapsed < INSTANT_REJECT_THRESHOLD_MS) {
    return {
      node_id: nodeId,
      latency_ms: -1,
      download_mbps: 0,
      test_status: "error",
      test_message: "本机网络不可达或请求被拦截",
    };
  }

  // Confirm with a 2nd probe to separate real TCP/TLS round-trips from instant local blocks.
  const second = await probeOnce(url, timeoutMs, signal);
  if (second.kind === "aborted") return null;

  if (second.kind === "ok") {
    return {
      node_id: nodeId,
      latency_ms: Math.max(1, Math.round(second.elapsed)),
      download_mbps: 0,
      test_status: "ok",
      test_message: "本机网络 HTTP/TLS 探测成功",
    };
  }

  if (second.kind === "timeout") {
    return {
      node_id: nodeId,
      latency_ms: -1,
      download_mbps: 0,
      test_status: "timeout",
      test_message: "本机网络探测超时",
    };
  }

  if (second.elapsed < INSTANT_REJECT_THRESHOLD_MS) {
    return {
      node_id: nodeId,
      latency_ms: -1,
      download_mbps: 0,
      test_status: "error",
      test_message: "本机网络不可达或请求被拦截",
    };
  }

  return {
    node_id: nodeId,
    latency_ms: Math.max(1, Math.round(Math.min(first.elapsed, second.elapsed))),
    download_mbps: 0,
    test_status: "ok",
    test_message: "本机网络 TCP/TLS 探测响应 (非HTTP端口)",
  };
}

export async function probeNodeFromBrowser(
  node: SubscriptionNode,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<BrowserSpeedTestResult | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const urls = buildProbeUrls(node);
  if (urls.length === 0) {
    return {
      node_id: node.id,
      latency_ms: -1,
      download_mbps: 0,
      test_status: "error",
      test_message: "节点主机或端口无效",
    };
  }

  let lastResult: BrowserSpeedTestResult | null = null;
  for (let i = 0; i < urls.length; i += 1) {
    const result = await probeSingleUrl(
      node.id,
      urls[i],
      timeoutMs,
      options.signal,
    );
    if (result === null) {
      return null;
    }
    lastResult = result;
    if (result.test_status === "ok" || result.test_status === "timeout") {
      return result;
    }
    // Only try fallback scheme if navigator is online and primary returned "error".
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return result;
    }
  }

  return lastResult;
}

/**
 * Probe a list of subscription nodes concurrently from the user's browser.
 * Emits `onNodeStart` and `onNodeResult` callbacks in real time as each node
 * starts and completes.
 */
export async function runBrowserSpeedTest(
  nodes: SubscriptionNode[],
  options: BrowserSpeedTestOptions = {},
): Promise<BrowserSpeedTestResult[]> {
  const {
    concurrency = DEFAULT_CONCURRENCY,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    onNodeStart,
    onNodeResult,
  } = options;

  if (nodes.length === 0 || signal?.aborted) {
    return [];
  }

  const results: BrowserSpeedTestResult[] = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, nodes.length));

  const worker = async () => {
    while (!signal?.aborted) {
      const idx = cursor;
      cursor += 1;
      if (idx >= nodes.length) break;

      const node = nodes[idx];
      onNodeStart?.(node.id);
      const result = await probeNodeFromBrowser(node, { timeoutMs, signal });
      if (result === null || signal?.aborted) {
        break;
      }
      results.push(result);
      onNodeResult?.(result);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
