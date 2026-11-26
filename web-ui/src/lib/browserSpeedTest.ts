import type { SpeedResultReportItem, SubscriptionNode } from "@/types/hub";

const DEFAULT_CONCURRENCY = 6;
const DEFAULT_TIMEOUT_MS = 5000;
const MIN_ROUNDTRIP_MS = 3;

const HTTPS_PORTS = new Set([443, 8443, 2053, 2083, 2087, 2096]);
const HTTP_PORTS = new Set([80, 8080, 8880]);
const TLS_PROTOCOLS = new Set(["trojan", "vless", "hy2", "hysteria2", "tuic", "https"]);

export interface BrowserSpeedTestOptions {
  concurrency?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onNodeStart?: (nodeId: number) => void;
  onNodeResult?: (result: SpeedResultReportItem) => void;
}

type ProbeOutcome =
  | { kind: "ok"; elapsed: number }
  | { kind: "timeout"; elapsed: number }
  | { kind: "type_error"; elapsed: number }
  | { kind: "aborted" };

function formatProbeHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed) return "";
  return trimmed.includes(":") && !trimmed.startsWith("[") ? `[${trimmed}]` : trimmed;
}

function buildProbeUrls(node: Pick<SubscriptionNode, "host" | "port" | "protocol">): string[] {
  const host = formatProbeHost(node.host || "");
  const port = Number(node.port);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return [];
  }
  if (typeof window !== "undefined" && window.location?.protocol === "https:") {
    return [`https://${host}:${port}/`];
  }
  const proto = (node.protocol || "").trim().toLowerCase();
  if (HTTPS_PORTS.has(port) || TLS_PROTOCOLS.has(proto)) {
    return [`https://${host}:${port}/`];
  }
  if (HTTP_PORTS.has(port) || proto === "http") {
    return [`http://${host}:${port}/`, `https://${host}:${port}/`];
  }
  return [`http://${host}:${port}/`, `https://${host}:${port}/`];
}

async function probeOnce(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ProbeOutcome> {
  if (signal?.aborted) {
    return { kind: "aborted" };
  }
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

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
    if (signal?.aborted) {
      return { kind: "aborted" };
    }
    if (timedOut || (err instanceof DOMException && err.name === "AbortError")) {
      return { kind: "timeout", elapsed };
    }
    return { kind: "type_error", elapsed };
  } finally {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function probeUrl(
  nodeId: number,
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<SpeedResultReportItem | null> {
  const first = await probeOnce(url, timeoutMs, signal);
  if (first.kind === "aborted") {
    return null;
  }

  if (first.kind === "ok") {
    const second = await probeOnce(url, timeoutMs, signal);
    if (second.kind === "aborted") {
      return null;
    }
    const latency = second.kind === "ok" ? second.elapsed : first.elapsed;
    return {
      node_id: nodeId,
      latency_ms: Math.max(1, Math.round(latency)),
      download_mbps: 0,
      test_status: "ok",
      test_method: "browser_http",
      test_message: "本机网络 HTTP/TLS 探测成功",
    };
  }

  if (first.kind === "timeout") {
    return {
      node_id: nodeId,
      latency_ms: -1,
      download_mbps: 0,
      test_status: "timeout",
      test_method: "browser_http",
      test_message: "本机网络探测超时",
    };
  }

  if ((typeof navigator !== "undefined" && navigator.onLine === false) || first.elapsed < MIN_ROUNDTRIP_MS) {
    return {
      node_id: nodeId,
      latency_ms: -1,
      download_mbps: 0,
      test_status: "error",
      test_method: "browser_tcp",
      test_message: "本机网络不可达或请求被拦截",
    };
  }

  const second = await probeOnce(url, timeoutMs, signal);
  if (second.kind === "aborted") {
    return null;
  }
  if (second.kind === "ok") {
    return {
      node_id: nodeId,
      latency_ms: Math.max(1, Math.round(second.elapsed)),
      download_mbps: 0,
      test_status: "ok",
      test_method: "browser_http",
      test_message: "本机网络 HTTP/TLS 探测成功",
    };
  }
  if (second.kind === "timeout") {
    return {
      node_id: nodeId,
      latency_ms: -1,
      download_mbps: 0,
      test_status: "timeout",
      test_method: "browser_tcp",
      test_message: "本机网络探测超时",
    };
  }
  if (second.elapsed < MIN_ROUNDTRIP_MS) {
    return {
      node_id: nodeId,
      latency_ms: -1,
      download_mbps: 0,
      test_status: "error",
      test_method: "browser_tcp",
      test_message: "本机网络不可达或请求被拦截",
    };
  }

  return {
    node_id: nodeId,
    latency_ms: Math.max(1, Math.round(Math.min(first.elapsed, second.elapsed))),
    download_mbps: 0,
    test_status: "ok",
    test_method: "browser_tcp",
    test_message: "本机网络 TCP/TLS 探测响应 (非HTTP端口)",
  };
}

/** Probe a single node from the user's browser network. */
export async function probeNodeInBrowser(
  node: SubscriptionNode,
  options: Pick<BrowserSpeedTestOptions, "timeoutMs" | "signal"> = {},
): Promise<SpeedResultReportItem | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const urls = buildProbeUrls(node);
  if (urls.length === 0) {
    return {
      node_id: node.id,
      latency_ms: -1,
      download_mbps: 0,
      test_status: "error",
      test_method: "browser_tcp",
      test_message: "节点主机或端口无效",
    };
  }

  let lastResult: SpeedResultReportItem | null = null;
  for (const url of urls) {
    const result = await probeUrl(node.id, url, timeoutMs, options.signal);
    if (result === null) {
      return null;
    }
    lastResult = result;
    if (
      result.test_status === "ok" ||
      result.test_status === "timeout" ||
      (typeof navigator !== "undefined" && navigator.onLine === false)
    ) {
      return result;
    }
  }
  return lastResult;
}

/** Run bounded-concurrency browser probes across a list of subscription nodes. */
export async function runBrowserSpeedTests(
  nodes: SubscriptionNode[],
  options: BrowserSpeedTestOptions = {},
): Promise<SpeedResultReportItem[]> {
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

  const results: SpeedResultReportItem[] = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, nodes.length));

  const worker = async () => {
    while (!signal?.aborted) {
      const idx = cursor;
      cursor += 1;
      if (idx >= nodes.length) break;

      const node = nodes[idx];
      onNodeStart?.(node.id);
      const res = await probeNodeInBrowser(node, { timeoutMs, signal });
      if (res === null || signal?.aborted) break;

      results.push(res);
      onNodeResult?.(res);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
