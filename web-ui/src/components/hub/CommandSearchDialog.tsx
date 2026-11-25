import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Globe, Search, Server, X, ArrowRight } from "lucide-react";
import { useNodeList } from "@/contexts/NodeListContext";
import { useLiveDataMeta } from "@/contexts/LiveDataContext";
import { fetchSubscriptionNodes, fetchUptimeSummary, formatLatency } from "@/lib/hubApi";
import type { SubscriptionNode, UptimeMonitor } from "@/types/hub";
import { countryCodeToFlagEmoji } from "@/utils/regionCode";

interface SearchResultItem {
  id: string;
  kind: "server" | "monitor" | "node";
  title: string;
  subtitle: string;
  badge?: string;
  statusTone: "emerald" | "rose" | "amber" | "neutral";
  to: string;
}

export function CommandSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { nodeList } = useNodeList();
  const { online } = useLiveDataMeta();
  const onlineSet = useMemo(() => new Set(online ?? []), [online]);

  const [query, setQuery] = useState("");
  const [monitors, setMonitors] = useState<UptimeMonitor[]>([]);
  const [subNodes, setSubNodes] = useState<SubscriptionNode[]>([]);
  const [loadingExtra, setLoadingExtra] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      } else if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    setTimeout(() => inputRef.current?.focus(), 20);

    let cancelled = false;
    setLoadingExtra(true);
    Promise.all([
      fetchUptimeSummary(24).catch(() => null),
      fetchSubscriptionNodes().catch(() => []),
    ])
      .then(([uptimeRes, nodesRes]) => {
        if (cancelled) return;
        setMonitors(uptimeRes?.monitors ?? []);
        setSubNodes(Array.isArray(nodesRes) ? nodesRes : []);
      })
      .finally(() => {
        if (!cancelled) setLoadingExtra(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const items = useMemo<SearchResultItem[]>(() => {
    const q = query.trim().toLowerCase();
    const results: SearchResultItem[] = [];

    for (const srv of nodeList ?? []) {
      const haystack = `${srv.name} ${srv.region} ${srv.group} ${srv.os}`.toLowerCase();
      if (!q || haystack.includes(q)) {
        const isUp = onlineSet.has(srv.uuid);
        results.push({
          id: `srv-${srv.uuid}`,
          kind: "server",
          title: srv.name,
          subtitle: `${srv.region || "UN"} · ${srv.group || "默认分组"} · ${srv.os || "Linux"}`,
          badge: isUp ? "在线" : "离线",
          statusTone: isUp ? "emerald" : "rose",
          to: `/instance/${srv.uuid}`,
        });
      }
    }

    for (const mon of monitors) {
      const haystack = `${mon.name} ${mon.target} ${mon.group} ${mon.type}`.toLowerCase();
      if (!q || haystack.includes(q)) {
        results.push({
          id: `mon-${mon.id}`,
          kind: "monitor",
          title: mon.name,
          subtitle: `${mon.type.toUpperCase()} · ${mon.target}`,
          badge: `${mon.uptime_24h.toFixed(1)}% · ${formatLatency(mon.last_latency_ms)}`,
          statusTone: mon.status === 1 ? "emerald" : mon.status === 0 ? "rose" : "amber",
          to: `/uptime?monitor=${mon.id}`,
        });
      }
    }

    for (const node of subNodes) {
      const haystack = `${node.name} ${node.country_code} ${node.country_name} ${node.city} ${node.protocol} ${node.subscription_name}`.toLowerCase();
      if (!q || haystack.includes(q)) {
        const flag = node.country_code ? countryCodeToFlagEmoji(node.country_code) : "🌐";
        results.push({
          id: `node-${node.id}`,
          kind: "node",
          title: node.name,
          subtitle: `${flag} ${node.city || node.country_name || node.country_code} · ${node.protocol.toUpperCase()} · ${node.subscription_name}`,
          badge:
            node.latency_ms > 0
              ? `${node.latency_ms}ms`
              : node.ippure && node.ippure.fraud_score >= 0
                ? `纯净 ${node.ippure.fraud_score}`
                : node.protocol.toUpperCase(),
          statusTone:
            node.latency_ms < 0 ? "rose" : node.latency_ms > 0 ? "emerald" : "neutral",
          to: `/subscriptions?search=${encodeURIComponent(node.name)}`,
        });
      }
    }

    return results.slice(0, 30);
  }, [nodeList, onlineSet, monitors, subNodes, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!open) return null;

  const handleSelect = (item: SearchResultItem) => {
    onOpenChange(false);
    navigate(item.to);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (items.length ? (prev + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        items.length ? (prev - 1 + items.length) % items.length : 0,
      );
    } else if (e.key === "Enter" && items[selectedIndex]) {
      e.preventDefault();
      handleSelect(items[selectedIndex]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 pt-[12vh] backdrop-blur-[2px]"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--hub-border)] px-4 py-3">
          <Search className="h-4 w-4 text-[var(--hub-muted)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索探针服务器、Uptime 监控、订阅节点..."
            className="w-full bg-transparent text-sm text-[var(--hub-ink)] placeholder:text-[var(--hub-muted)] focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="rounded p-0.5 text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center rounded border border-[var(--hub-border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--hub-muted)]">
            ESC
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--hub-muted)]">
              {loadingExtra ? "正在加载索引..." : "未找到匹配的服务器、监控或节点"}
            </div>
          ) : (
            <div className="space-y-0.5">
              {items.map((item, idx) => {
                const active = idx === selectedIndex;
                const Icon =
                  item.kind === "server"
                    ? Server
                    : item.kind === "monitor"
                      ? Activity
                      : Globe;
                const dotClass =
                  item.statusTone === "emerald"
                    ? "bg-emerald-500"
                    : item.statusTone === "rose"
                      ? "bg-rose-500"
                      : item.statusTone === "amber"
                        ? "bg-amber-500"
                        : "bg-zinc-400";
                const kindLabel =
                  item.kind === "server"
                    ? "探针"
                    : item.kind === "monitor"
                      ? "监控"
                      : "节点";
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => handleSelect(item)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                      active
                        ? "bg-zinc-100 dark:bg-zinc-800/80"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--hub-border)] bg-[var(--hub-canvas)] text-[var(--hub-muted)]">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
                          <span className="truncate text-sm font-medium text-[var(--hub-ink)]">
                            {item.title}
                          </span>
                          <span className="rounded border border-[var(--hub-border)] px-1 py-0 text-[10px] text-[var(--hub-muted)]">
                            {kindLabel}
                          </span>
                        </div>
                        <div className="truncate text-xs text-[var(--hub-muted)]">
                          {item.subtitle}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {item.badge && (
                        <span className="font-mono tabular-nums text-xs text-[var(--hub-muted)]">
                          {item.badge}
                        </span>
                      )}
                      <ArrowRight className="h-3.5 w-3.5 text-[var(--hub-muted)]" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--hub-border)] bg-[var(--hub-canvas)] px-4 py-2 text-[11px] text-[var(--hub-muted)]">
          <span>↑↓ 选择 · Enter 跳转</span>
          <span className="font-mono tabular-nums">{items.length} 条结果</span>
        </div>
      </div>
    </div>
  );
}
