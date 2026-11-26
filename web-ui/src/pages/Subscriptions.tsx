import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Globe,
  Info,
  LogIn,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";
import {
  fetchIPPureSelf,
  fetchSubscriptionMap,
  fetchSubscriptionNodes,
  fetchSubscriptions,
  formatExpiryCountdown,
  formatLatency,
  formatRelativeTime,
  formatTestMethod,
  getFraudTier,
  getLatencyBadgeClass,
} from "@/lib/hubApi";
import type {
  IPPureInfo,
  SubscriptionItem,
  SubscriptionMapData,
  SubscriptionNode,
} from "@/types/hub";
import { formatBytes } from "@/utils/unitHelper";
import { countryCodeToFlagEmoji } from "@/utils/regionCode";
import { HubCard, HubEmptyState } from "@/components/hub/HubUi";
import {
  defaultDirForField,
  type NodeSortField,
  NodeSortSelect,
  SortableTableHeader,
  type SortDirection,
  sortSubscriptionNodes,
} from "@/components/hub/NodeSortControls";
import { WorldMapCard, type MapMode } from "@/components/hub/WorldMapCard";
import { loginPath } from "@/utils/loginRedirect";

const SubscriptionsPageInner: React.FC = () => {
  const { t } = useTranslation();
  const { account } = useAccount();
  const isAdmin = Boolean(account?.logged_in);
  const [searchParams, setSearchParams] = useSearchParams();

  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [nodes, setNodes] = useState<SubscriptionNode[]>([]);
  const [mapData, setMapData] = useState<SubscriptionMapData>({
    countries: [],
    markers: [],
  });
  const [ippureSelf, setIppureSelf] = useState<IPPureInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Map & Table filters
  const [mapMode, setMapMode] = useState<MapMode>("latency");
  const [selectedCountry, setSelectedCountry] = useState<string>(
    searchParams.get("country") || "",
  );
  const [selectedSubId, setSelectedSubId] = useState<string>("all");
  const [selectedProtocol, setSelectedProtocol] = useState<string>("all");
  const [onlyAvailable, setOnlyAvailable] = useState<boolean>(false);
  const [searchText, setSearchText] = useState<string>(
    searchParams.get("search") || "",
  );
  const [sortBy, setSortBy] = useState<NodeSortField>("default");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  // Read-only IPPure self summary banner
  const [purityBarOpen, setPurityBarOpen] = useState<boolean>(true);

  // Purity popover
  const [inspectedNode, setInspectedNode] = useState<SubscriptionNode | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [subsRes, nodesRes, mapRes, selfRes] = await Promise.all([
        fetchSubscriptions().catch(() => []),
        fetchSubscriptionNodes().catch(() => []),
        fetchSubscriptionMap().catch(() => ({ countries: [], markers: [] })),
        fetchIPPureSelf().catch(() => null),
      ]);
      setSubscriptions(Array.isArray(subsRes) ? subsRes : []);
      setNodes(Array.isArray(nodesRes) ? nodesRes : []);
      setMapData(mapRes || { countries: [], markers: [] });
      setIppureSelf(selfRes);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSelectCountry = (code: string) => {
    setSelectedCountry(code);
    const next = new URLSearchParams(searchParams);
    if (code) next.set("country", code);
    else next.delete("country");
    setSearchParams(next, { replace: true });
  };

  const protocols = useMemo(() => {
    const set = new Set<string>();
    for (const n of nodes) {
      if (n.protocol) set.add(n.protocol.toLowerCase());
    }
    return Array.from(set).sort();
  }, [nodes]);

  const handleToggleSort = (column: NodeSortField) => {
    if (sortBy === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir(defaultDirForField(column));
    }
  };

  const filteredNodes = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const filtered = nodes.filter((n) => {
      if (selectedSubId !== "all" && String(n.subscription_id) !== selectedSubId) {
        return false;
      }
      if (
        selectedCountry &&
        (n.country_code || "").toUpperCase() !== selectedCountry.toUpperCase()
      ) {
        return false;
      }
      if (
        selectedProtocol !== "all" &&
        (n.protocol || "").toLowerCase() !== selectedProtocol
      ) {
        return false;
      }
      if (onlyAvailable && (!n.enabled || n.test_status !== "ok")) {
        return false;
      }
      if (q) {
        const hay = `${n.name} ${n.host} ${n.city} ${n.country_name} ${n.country_code} ${n.protocol} ${n.subscription_name} ${n.ippure?.ip || ""} ${n.ippure?.as_organization || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return sortSubscriptionNodes(filtered, sortBy, sortDir);
  }, [
    nodes,
    selectedSubId,
    selectedCountry,
    selectedProtocol,
    onlyAvailable,
    searchText,
    sortBy,
    sortDir,
  ]);

  const sortedCountries = useMemo(
    () =>
      [...(mapData.countries ?? [])].sort((a, b) => b.node_count - a.node_count),
    [mapData.countries],
  );

  const maxCountryCount = useMemo(
    () => Math.max(1, ...sortedCountries.map((c) => c.node_count)),
    [sortedCountries],
  );

  return (
    <div className="space-y-6">
      {/* Header (Read-Only Observability) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--hub-ink)]">
            {t("pulse.subscriptions.title")}
          </h1>
          <p className="mt-0.5 text-xs text-[var(--hub-muted)]">
            {t("pulse.subscriptions.subtitle")}
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
            <span>{t("pulse.common.refresh")}</span>
          </button>

          {isAdmin && (
            <Link
              to="/admin/subscriptions"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-ink)] no-underline transition-colors hover:bg-[var(--hub-canvas)]"
            >
              <span>{t("pulse.subscriptions.manageSubs")}</span>
              <ArrowRight className="h-3.5 w-3.5 text-[var(--hub-muted)]" />
            </Link>
          )}
        </div>
      </div>

      {/* Top Subscription Cards Strip (Read-Only) */}
      {subscriptions.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {subscriptions.map((sub) => {
            const used = (sub.upload || 0) + (sub.download || 0);
            const pct =
              sub.total > 0 ? Math.min(100, (used / sub.total) * 100) : 0;
            const expiry = formatExpiryCountdown(sub.expire);
            return (
              <HubCard key={sub.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--hub-ink)]">
                        {sub.name}
                      </span>
                      <span className="rounded border border-[var(--hub-border)] px-1.5 py-0 font-mono text-[10px] uppercase text-[var(--hub-muted)]">
                        {sub.source_type}
                      </span>
                    </div>
                    {sub.masked_url && (
                      <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--hub-muted)]">
                        {sub.masked_url}
                      </div>
                    )}
                  </div>

                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${
                      expiry.urgent
                        ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    }`}
                  >
                    {expiry.text}
                  </span>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-[var(--hub-muted)]">
                    <span>
                      {sub.total > 0
                        ? `${formatBytes(used)} / ${formatBytes(sub.total)} (${pct.toFixed(1)}%)`
                        : t("pulse.subscriptions.manualPool")}
                    </span>
                    <span>
                      {t("pulse.subscriptions.availableCount", {
                        avail: sub.available_count,
                        total: sub.node_count,
                      })}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-blue-600 dark:bg-blue-500"
                      style={{ width: `${sub.total > 0 ? pct : 100}%` }}
                    />
                  </div>
                </div>

                {sub.last_error && (
                  <div className="mt-2 truncate text-[11px] text-rose-500">
                    {t("pulse.subscriptions.syncError", { error: sub.last_error })}
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between border-t border-[var(--hub-border)] pt-2.5 text-[11px] text-[var(--hub-muted)]">
                  <span className="font-mono tabular-nums">
                    {t("pulse.subscriptions.syncedAt", {
                      time: formatRelativeTime(sub.last_synced_at),
                    })}
                  </span>
                  <span className="font-mono text-[10px]">
                    {sub.enabled ? t("pulse.common.enabled") : t("pulse.common.disabled")}
                  </span>
                </div>
              </HubCard>
            );
          })}
        </div>
      )}

      {/* Middle Split: Left 7 Cols World Map + Right 5 Cols Region Breakdown Table */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <WorldMapCard
            countries={mapData.countries ?? []}
            markers={mapData.markers ?? []}
            mode={mapMode}
            onModeChange={setMapMode}
            selectedCountry={selectedCountry}
            onSelectCountry={handleSelectCountry}
          />
        </div>

        <HubCard className="flex flex-col p-4 lg:col-span-5">
          <div className="flex items-center justify-between border-b border-[var(--hub-border)] pb-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--hub-ink)]">
                {t("pulse.subscriptions.countryBreakdownTitle")}
              </h3>
              <p className="text-xs text-[var(--hub-muted)]">
                {t("pulse.subscriptions.countryBreakdownSubtitle")}
              </p>
            </div>
            {selectedCountry && (
              <button
                type="button"
                onClick={() => handleSelectCountry("")}
                className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                {t("pulse.subscriptions.clearFilter")}
              </button>
            )}
          </div>

          <div className="mt-2 flex-1 max-h-[340px] overflow-y-auto divide-y divide-[var(--hub-border)]">
            {sortedCountries.length === 0 ? (
              <div className="py-16 text-center text-xs text-[var(--hub-muted)]">
                {t("pulse.subscriptions.noCountryData")}
              </div>
            ) : (
              sortedCountries.map((c) => {
                const isSelected =
                  selectedCountry.toUpperCase() === c.country_code.toUpperCase();
                const tier = getFraudTier(c.avg_fraud_score);
                const widthPct = Math.max(8, (c.node_count / maxCountryCount) * 100);
                return (
                  <button
                    key={c.country_code}
                    type="button"
                    onClick={() =>
                      handleSelectCountry(isSelected ? "" : c.country_code)
                    }
                    className={`flex w-full items-center justify-between gap-3 px-2 py-2.5 text-left transition-colors ${
                      isSelected
                        ? "bg-blue-50/70 dark:bg-blue-950/30"
                        : "hover:bg-[var(--hub-canvas)]"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base leading-none">
                          {countryCodeToFlagEmoji(c.country_code)}
                        </span>
                        <span className="truncate text-xs font-medium text-[var(--hub-ink)]">
                          {c.country_name || c.country_code}
                        </span>
                        <span className="font-mono tabular-nums text-[11px] text-[var(--hub-muted)]">
                          {c.node_count}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-blue-500/80"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 font-mono tabular-nums text-[11px]">
                      <span
                        className={`rounded border px-1.5 py-0.5 ${getLatencyBadgeClass(
                          c.min_latency_ms,
                        )}`}
                      >
                        {formatLatency(c.min_latency_ms)}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 ${tier.badgeClass}`}
                      >
                        {c.avg_fraud_score >= 0
                          ? `${Math.round(c.avg_fraud_score)}`
                          : "--"}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </HubCard>
      </div>

      {/* Read-Only IPPure Self Exit Summary Banner */}
      <HubCard className="overflow-hidden">
        <div
          onClick={() => setPurityBarOpen((o) => !o)}
          className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--hub-canvas)]/50"
        >
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-semibold text-[var(--hub-ink)]">
              {t("pulse.subscriptions.selfPurityTitle")}
            </span>
            <span className="hidden sm:inline text-xs text-[var(--hub-muted)]">
              {t("pulse.subscriptions.selfPuritySubtitle")}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {ippureSelf && !ippureSelf.error && (
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums ${
                  getFraudTier(ippureSelf.fraud_score).badgeClass
                }`}
              >
                {ippureSelf.ip} · {t("pulse.subscriptions.scoreBadge", { score: ippureSelf.fraud_score })} (
                {getFraudTier(ippureSelf.fraud_score).shortLabel})
              </span>
            )}
            {purityBarOpen ? (
              <ChevronUp className="h-4 w-4 text-[var(--hub-muted)]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[var(--hub-muted)]" />
            )}
          </div>
        </div>

        {purityBarOpen && (
          <div className="border-t border-[var(--hub-border)] bg-[var(--hub-canvas)]/40 px-4 py-4">
            {ippureSelf ? (
              ippureSelf.error ? (
                <div className="text-xs text-rose-600">
                  {t("pulse.subscriptions.lastCheckError", { error: ippureSelf.error })}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-lg border font-mono text-sm font-bold tabular-nums ${
                        getFraudTier(ippureSelf.fraud_score).badgeClass
                      }`}
                    >
                      {ippureSelf.fraud_score}
                    </div>
                    <div>
                      <div className="font-mono font-semibold text-[var(--hub-ink)]">
                        {ippureSelf.ip}
                      </div>
                      <div className="text-[11px] text-[var(--hub-muted)]">
                        {countryCodeToFlagEmoji(ippureSelf.country_code || "")}{" "}
                        {ippureSelf.country} · {ippureSelf.city || ippureSelf.region}
                      </div>
                    </div>
                  </div>

                  <div className="h-7 w-px bg-[var(--hub-border)] hidden sm:block" />

                  <div className="space-y-0.5 font-mono text-[11px]">
                    <div className="text-[var(--hub-ink)]">
                      AS{ippureSelf.asn} · {ippureSelf.as_organization}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded border px-1.5 py-0 text-[10px] ${
                          ippureSelf.is_residential
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300"
                            : "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        }`}
                      >
                        {ippureSelf.is_residential ? t("pulse.purity.residentialIp") : t("pulse.purity.datacenterIp")}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0 text-[10px] ${
                          !ippureSelf.is_broadcast
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300"
                            : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300"
                        }`}
                      >
                        {ippureSelf.is_broadcast ? t("pulse.purity.broadcastIp") : t("pulse.purity.nativeIp")}
                      </span>
                      <span className="text-[var(--hub-muted)]">
                        {t("pulse.common.updatedAt", { time: formatRelativeTime(ippureSelf.checked_at) })}
                      </span>
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div className="text-xs text-[var(--hub-muted)]">
                {t("pulse.subscriptions.noSelfSnapshot")}
                {isAdmin && (
                  <>
                    {t("pulse.subscriptions.goToAdminPrefix")}
                    <Link to="/admin/subscriptions" className="text-blue-600 hover:underline dark:text-blue-400">
                      {t("pulse.subscriptions.goToAdminLink")}
                    </Link>
                    {t("pulse.subscriptions.goToAdminSuffix")}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </HubCard>

      {/* Bottom Full-Width Node Table (Read-Only) */}
      {nodes.length === 0 && !loading ? (
        <HubEmptyState
          icon={Globe}
          title={t("pulse.subscriptions.emptyTitle")}
          description={
            isAdmin
              ? t("pulse.subscriptions.emptyAdminDesc")
              : t("pulse.subscriptions.emptyGuestDesc")
          }
          action={
            isAdmin ? (
              <Link
                to="/admin/subscriptions"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 text-xs font-medium text-white no-underline hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
              >
                <span>{t("pulse.subscriptions.goToImport")}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <Link
                to={loginPath("/admin/subscriptions")}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] px-3 text-xs font-medium text-[var(--hub-ink)] no-underline hover:bg-[var(--hub-canvas)]"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>{t("pulse.common.adminLogin")}</span>
              </Link>
            )
          }
        />
      ) : (
        <HubCard className="overflow-hidden">
          {/* Table Filter Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hub-border)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--hub-muted)]" />
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder={t("pulse.subscriptions.searchPlaceholder")}
                  className="h-8 w-56 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] pl-8 pr-7 text-xs text-[var(--hub-ink)] focus:outline-none"
                />
                {searchText && (
                  <button
                    type="button"
                    onClick={() => setSearchText("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              <select
                value={selectedSubId}
                onChange={(e) => setSelectedSubId(e.target.value)}
                className="h-8 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2.5 text-xs text-[var(--hub-ink)]"
              >
                <option value="all">{t("pulse.subscriptions.allSubs")}</option>
                {subscriptions.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name}
                  </option>
                ))}
              </select>

              <select
                value={selectedProtocol}
                onChange={(e) => setSelectedProtocol(e.target.value)}
                className="h-8 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2.5 text-xs text-[var(--hub-ink)]"
              >
                <option value="all">{t("pulse.subscriptions.allProtocols")}</option>
                {protocols.map((p) => (
                  <option key={p} value={p}>
                    {p.toUpperCase()}
                  </option>
                ))}
              </select>

              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2.5 py-1.5 text-xs text-[var(--hub-ink)]">
                <input
                  type="checkbox"
                  checked={onlyAvailable}
                  onChange={(e) => setOnlyAvailable(e.target.checked)}
                />
                <span>{t("pulse.subscriptions.onlyAvailable")}</span>
              </label>

              <NodeSortSelect
                sortBy={sortBy}
                sortDir={sortDir}
                onChange={(nextBy, nextDir) => {
                  setSortBy(nextBy);
                  setSortDir(nextDir);
                }}
              />

              {selectedCountry && (
                <button
                  type="button"
                  onClick={() => handleSelectCountry("")}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-xs font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-300"
                >
                  <span>{t("pulse.subscriptions.regionBadge", { code: selectedCountry })}</span>
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <span className="font-mono tabular-nums text-xs text-[var(--hub-muted)]">
              {t("pulse.subscriptions.showingCount", {
                shown: filteredNodes.length,
                total: nodes.length,
              })}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--hub-border)] bg-[var(--hub-canvas)] text-[11px] font-medium text-[var(--hub-muted)]">
                  <SortableTableHeader
                    label={t("pulse.subscriptions.colNodeProtocol")}
                    column="name"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleToggleSort}
                  />
                  <SortableTableHeader
                    label={t("pulse.subscriptions.colRegion")}
                    column="country"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleToggleSort}
                  />
                  <SortableTableHeader
                    label={t("pulse.subscriptions.colLatency")}
                    column="latency"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleToggleSort}
                  />
                  <SortableTableHeader
                    label={t("pulse.subscriptions.colDownload")}
                    column="download"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleToggleSort}
                  />
                  <SortableTableHeader
                    label={t("pulse.subscriptions.colPurity")}
                    column="fraud_score"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={handleToggleSort}
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--hub-border)]">
                {filteredNodes.map((node) => {
                  const tier = getFraudTier(node.ippure?.fraud_score);
                  const isTested = node.test_status !== "untested" || node.latency_ms !== 0;
                  const methodBadge = isTested ? formatTestMethod(node.test_method) : null;
                  return (
                    <tr
                      key={node.id}
                      className={`transition-colors hover:bg-[var(--hub-canvas)]/70 ${
                        !node.enabled ? "opacity-55" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[var(--hub-ink)]">
                            {node.name}
                          </span>
                          <span className="rounded border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-1.5 py-0 font-mono text-[10px] uppercase text-[var(--hub-muted)]">
                            {node.protocol}
                          </span>
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-[var(--hub-muted)]">
                          {node.host}:{node.port} · {node.subscription_name}
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm leading-none">
                            {countryCodeToFlagEmoji(node.country_code || "")}
                          </span>
                          <span className="text-[var(--hub-ink)]">
                            {node.city || node.country_name || node.country_code || "--"}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap font-mono tabular-nums">
                        <div className="inline-flex flex-wrap items-center gap-1.5">
                          <span
                            title={node.test_message || undefined}
                            className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-medium ${
                              node.test_status === "unknown"
                                ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/60 dark:text-amber-300"
                                : getLatencyBadgeClass(node.latency_ms)
                            }`}
                          >
                            {node.test_status === "unknown"
                              ? t("pulse.common.unknownConnectivity")
                              : node.latency_ms < 0 && node.test_status === "error"
                                ? t("pulse.common.failed")
                                : formatLatency(node.latency_ms)}
                          </span>
                          {methodBadge && (
                            <span
                              title={methodBadge.title}
                              className={`inline-flex rounded border px-1.5 py-0.5 font-sans text-[10px] font-medium ${methodBadge.badgeClass}`}
                            >
                              {methodBadge.label}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap font-mono tabular-nums text-[var(--hub-ink)]">
                        {node.download_mbps > 0
                          ? `${node.download_mbps.toFixed(1)} Mbps`
                          : "--"}
                      </td>

                      <td className="px-4 py-3">
                        {node.ippure ? (
                          node.ippure.error ? (
                            <span
                              title={node.ippure.error}
                              className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"
                            >
                              <Info className="h-3.5 w-3.5 shrink-0" />
                              <span className="max-w-[180px] truncate">
                                {node.ippure.error}
                              </span>
                            </span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setInspectedNode(node)}
                                className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] tabular-nums font-medium ${tier.badgeClass}`}
                              >
                                <span>{node.ippure.fraud_score}</span>
                                <span>{tier.shortLabel}</span>
                              </button>
                              <span className="rounded border border-[var(--hub-border)] px-1.5 py-0.5 text-[10px] text-[var(--hub-ink)]">
                                {node.ippure.is_residential ? t("pulse.purity.residentialShort") : t("pulse.purity.datacenterShort")}
                              </span>
                              <span className="rounded border border-[var(--hub-border)] px-1.5 py-0.5 text-[10px] text-[var(--hub-muted)]">
                                {node.ippure.is_broadcast ? t("pulse.purity.broadcastShort") : t("pulse.purity.nativeShort")}
                              </span>
                            </div>
                          )
                        ) : (
                          <span className="text-[11px] text-[var(--hub-muted)]">
                            {t("pulse.common.untested")}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </HubCard>
      )}

      {/* IPPure Detail Popover Modal */}
      {inspectedNode && inspectedNode.ippure && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-[2px]"
          onClick={() => setInspectedNode(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--hub-border)] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--hub-ink)]">
                  {t("pulse.subscriptions.ippureDetailTitle", { name: inspectedNode.name })}
                </h3>
                <p className="text-xs text-[var(--hub-muted)] font-mono">
                  {inspectedNode.ippure.ip}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedNode(null)}
                className="rounded p-1 text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--hub-muted)]">{t("pulse.subscriptions.fraudScore")}</span>
                <span
                  className={`rounded border px-2 py-0.5 font-mono tabular-nums font-semibold ${
                    getFraudTier(inspectedNode.ippure.fraud_score).badgeClass
                  }`}
                >
                  {inspectedNode.ippure.fraud_score} / 100 ·{" "}
                  {getFraudTier(inspectedNode.ippure.fraud_score).label}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--hub-muted)]">{t("pulse.subscriptions.asnCarrier")}</span>
                <span className="font-mono text-[var(--hub-ink)] text-right">
                  AS{inspectedNode.ippure.asn} · {inspectedNode.ippure.as_organization}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--hub-muted)]">{t("pulse.subscriptions.location")}</span>
                <span className="text-[var(--hub-ink)]">
                  {countryCodeToFlagEmoji(inspectedNode.ippure.country_code || "")}{" "}
                  {inspectedNode.ippure.country} · {inspectedNode.ippure.region} ·{" "}
                  {inspectedNode.ippure.city}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--hub-muted)]">{t("pulse.subscriptions.coordinates")}</span>
                <span className="font-mono tabular-nums text-[var(--hub-ink)]">
                  {inspectedNode.ippure.latitude.toFixed(4)},{" "}
                  {inspectedNode.ippure.longitude.toFixed(4)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--hub-muted)]">{t("pulse.subscriptions.networkType")}</span>
                <span className="text-[var(--hub-ink)]">
                  {inspectedNode.ippure.is_residential ? t("pulse.purity.residentialIp") : t("pulse.purity.datacenterIp")} /{" "}
                  {inspectedNode.ippure.is_broadcast ? t("pulse.purity.broadcastIp") : t("pulse.purity.nativeIp")}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--hub-muted)]">{t("pulse.subscriptions.checkedAt")}</span>
                <span className="font-mono tabular-nums text-[var(--hub-muted)]">
                  {new Date(inspectedNode.ippure.checked_at).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SubscriptionsPage: React.FC = () => (
  <AccountProvider>
    <SubscriptionsPageInner />
  </AccountProvider>
);

export default SubscriptionsPage;
