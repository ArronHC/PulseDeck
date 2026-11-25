import React, { useMemo, useRef, useState } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import worldAtlas from "world-atlas/countries-110m.json";
import { X } from "lucide-react";
import type { MapCountry, MapMarker } from "@/types/hub";
import { COUNTRY_CENTROIDS, countryCodeToFlagEmoji } from "@/utils/regionCode";
import { formatLatency, getFraudTier } from "@/lib/hubApi";

export type MapMode = "latency" | "purity";

// ISO numeric -> ISO 3166-1 alpha-2 for world-atlas/countries-110m.json
const NUMERIC_TO_ALPHA2: Record<string, string> = {
  "004": "AF", "008": "AL", "012": "DZ", "024": "AO", "031": "AZ",
  "032": "AR", "036": "AU", "040": "AT", "044": "BS", "050": "BD",
  "051": "AM", "056": "BE", "064": "BT", "068": "BO", "070": "BA",
  "072": "BW", "076": "BR", "084": "BZ", "090": "SB", "096": "BN",
  "100": "BG", "104": "MM", "108": "BI", "112": "BY", "116": "KH",
  "120": "CM", "124": "CA", "140": "CF", "144": "LK", "148": "TD",
  "152": "CL", "156": "CN", "158": "TW", "170": "CO", "178": "CG",
  "180": "CD", "188": "CR", "191": "HR", "192": "CU", "196": "CY",
  "203": "CZ", "204": "BJ", "208": "DK", "214": "DO", "218": "EC",
  "222": "SV", "226": "GQ", "231": "ET", "232": "ER", "233": "EE",
  "238": "FK", "242": "FJ", "246": "FI", "250": "FR", "262": "DJ",
  "266": "GA", "268": "GE", "270": "GM", "275": "PS", "276": "DE",
  "288": "GH", "300": "GR", "304": "GL", "320": "GT", "324": "GN",
  "328": "GY", "332": "HT", "340": "HN", "348": "HU", "352": "IS",
  "356": "IN", "360": "ID", "364": "IR", "368": "IQ", "372": "IE",
  "376": "IL", "380": "IT", "384": "CI", "388": "JM", "392": "JP",
  "398": "KZ", "400": "JO", "404": "KE", "408": "KP", "410": "KR",
  "414": "KW", "417": "KG", "418": "LA", "422": "LB", "426": "LS",
  "428": "LV", "430": "LR", "434": "LY", "440": "LT", "442": "LU",
  "450": "MG", "454": "MW", "458": "MY", "466": "ML", "478": "MR",
  "484": "MX", "496": "MN", "498": "MD", "499": "ME", "504": "MA",
  "508": "MZ", "512": "OM", "516": "NA", "524": "NP", "528": "NL",
  "540": "NC", "548": "VU", "554": "NZ", "558": "NI", "562": "NE",
  "566": "NG", "578": "NO", "586": "PK", "591": "PA", "598": "PG",
  "600": "PY", "604": "PE", "608": "PH", "616": "PL", "620": "PT",
  "624": "GW", "626": "TL", "630": "PR", "634": "QA", "642": "RO",
  "643": "RU", "646": "RW", "682": "SA", "686": "SN", "688": "RS",
  "694": "SL", "703": "SK", "704": "VN", "705": "SI", "706": "SO",
  "710": "ZA", "716": "ZW", "724": "ES", "728": "SS", "729": "SD",
  "732": "EH", "740": "SR", "748": "SZ", "752": "SE", "756": "CH",
  "760": "SY", "762": "TJ", "764": "TH", "768": "TG", "780": "TT",
  "784": "AE", "788": "TN", "792": "TR", "795": "TM", "800": "UG",
  "804": "UA", "807": "MK", "818": "EG", "826": "GB", "834": "TZ",
  "840": "US", "854": "BF", "858": "UY", "860": "UZ", "862": "VE",
  "887": "YE", "894": "ZM",
};

const SVG_WIDTH = 860;
const SVG_HEIGHT = 410;

interface TooltipState {
  x: number;
  y: number;
  code: string;
  name: string;
  country?: MapCountry;
  marker?: MapMarker;
}

function getCountryColor(
  country: MapCountry | undefined,
  mode: MapMode,
  selected: boolean,
): string | null {
  if (!country) return null;
  if (mode === "purity") {
    const score = country.avg_fraud_score;
    if (score < 0 || score === undefined || score === null) {
      return selected ? "#2563EB" : "#93C5FD";
    }
    if (score <= 25) return selected ? "#059669" : "#10B981";
    if (score <= 50) return selected ? "#2563EB" : "#3B82F6";
    if (score <= 75) return selected ? "#D97706" : "#F59E0B";
    return selected ? "#E11D48" : "#F43F5E";
  }
  const lat = country.min_latency_ms;
  if (!lat || lat <= 0) return selected ? "#2563EB" : "#60A5FA";
  if (lat <= 80) return selected ? "#059669" : "#10B981";
  if (lat <= 180) return selected ? "#2563EB" : "#3B82F6";
  return selected ? "#D97706" : "#F59E0B";
}

function getMarkerColor(
  latencyMs: number,
  fraudScore: number,
  mode: MapMode,
): string {
  if (mode === "purity") {
    if (fraudScore < 0) return "#3B82F6";
    if (fraudScore <= 25) return "#10B981";
    if (fraudScore <= 50) return "#3B82F6";
    if (fraudScore <= 75) return "#F59E0B";
    return "#EF4444";
  }
  if (latencyMs < 0) return "#EF4444";
  if (latencyMs === 0) return "#3B82F6";
  if (latencyMs <= 80) return "#10B981";
  if (latencyMs <= 180) return "#3B82F6";
  return "#F59E0B";
}

export const WorldMapCard: React.FC<{
  countries: MapCountry[];
  markers?: MapMarker[];
  mode?: MapMode;
  onModeChange?: (mode: MapMode) => void;
  selectedCountry?: string;
  onSelectCountry?: (code: string) => void;
  compact?: boolean;
  onClickCompact?: () => void;
}> = ({
  countries,
  markers = [],
  mode = "latency",
  onModeChange,
  selectedCountry = "",
  onSelectCountry,
  compact = false,
  onClickCompact,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const countryByCode = useMemo(() => {
    const map = new Map<string, MapCountry>();
    for (const c of countries) {
      if (c.country_code) {
        map.set(c.country_code.toUpperCase(), c);
      }
    }
    return map;
  }, [countries]);

  const { features, projection, pathGenerator } = useMemo(() => {
    const topology = worldAtlas as unknown as Topology<{
      countries: GeometryCollection<{ name?: string }>;
    }>;
    const fc = feature(topology, topology.objects.countries);
    const filtered = fc.features.filter((f) => String(f.id) !== "010");
    const proj = geoNaturalEarth1()
      .scale(158)
      .translate([SVG_WIDTH / 2, SVG_HEIGHT / 2 + 18]);
    const path = geoPath(proj);
    return { features: filtered, projection: proj, pathGenerator: path };
  }, []);

  // Build projected country points (works even for SG / HK / TW / microstates)
  const countryPins = useMemo(() => {
    const pins: Array<{
      code: string;
      name: string;
      cx: number;
      cy: number;
      country: MapCountry;
    }> = [];
    for (const c of countries) {
      const code = (c.country_code || "").toUpperCase();
      if (!code || code === "UN") continue;
      let lat = c.lat;
      let lng = c.lng;
      if ((!lat && !lng) || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        const centroid = COUNTRY_CENTROIDS[code];
        if (!centroid) continue;
        [lat, lng] = centroid;
      }
      const pt = projection([lng, lat]);
      if (!pt) continue;
      pins.push({
        code,
        name: c.country_name || code,
        cx: pt[0],
        cy: pt[1],
        country: c,
      });
    }
    return pins;
  }, [countries, projection]);

  // Individual node markers (rendered subtly when zoomed/detailed)
  const nodeDots = useMemo(() => {
    if (compact) return [];
    const seen = new Set<string>();
    const list: Array<{ cx: number; cy: number; marker: MapMarker }> = [];
    for (const m of markers) {
      if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng) || (!m.lat && !m.lng)) {
        continue;
      }
      const pt = projection([m.lng, m.lat]);
      if (!pt) continue;
      const bucket = `${Math.round(pt[0] / 4)}:${Math.round(pt[1] / 4)}`;
      if (seen.has(bucket)) continue;
      seen.add(bucket);
      list.push({ cx: pt[0], cy: pt[1], marker: m });
    }
    return list;
  }, [markers, compact, projection]);

  const updateTooltipPos = (
    e: React.MouseEvent,
    payload: Omit<TooltipState, "x" | "y">,
  ) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      ...payload,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  return (
    <div
      ref={containerRef}
      onClick={compact ? onClickCompact : undefined}
      onMouseLeave={() => setTooltip(null)}
      className={`relative w-full overflow-hidden rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] ${
        compact ? "cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700" : ""
      }`}
    >
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--hub-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[var(--hub-ink)]">
                全球节点分布
              </h3>
              <p className="text-xs text-[var(--hub-muted)]">
                悬停查看延迟与 IPPure 纯净度 · 点击地区筛选节点
              </p>
            </div>
            {selectedCountry && (
              <button
                type="button"
                onClick={() => onSelectCountry?.("")}
                className="ml-2 inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-300"
              >
                <span>
                  {countryCodeToFlagEmoji(selectedCountry)} {selectedCountry}
                </span>
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {onModeChange && (
            <div className="inline-flex items-center rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] p-0.5">
              <button
                type="button"
                onClick={() => onModeChange("latency")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  mode === "latency"
                    ? "bg-[var(--hub-surface)] text-[var(--hub-ink)] shadow-xs"
                    : "text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
                }`}
              >
                延迟分布
              </button>
              <button
                type="button"
                onClick={() => onModeChange("purity")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  mode === "purity"
                    ? "bg-[var(--hub-surface)] text-[var(--hub-ink)] shadow-xs"
                    : "text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
                }`}
              >
                IP 纯净度
              </button>
            </div>
          )}
        </div>
      )}

      <div className={`relative w-full ${compact ? "px-2 py-2" : "px-3 py-3"}`}>
        <svg
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          className="h-auto w-full select-none"
          role="img"
          aria-label="World node distribution map"
        >
          <g>
            {features.map((feat, idx) => {
              const idStr = feat.id != null ? String(feat.id).padStart(3, "0") : "";
              const alpha2 = NUMERIC_TO_ALPHA2[idStr] || "";
              const countryData = alpha2 ? countryByCode.get(alpha2) : undefined;
              const isSelected =
                Boolean(selectedCountry) &&
                alpha2.toUpperCase() === selectedCountry.toUpperCase();
              const fillColor = getCountryColor(countryData, mode, isSelected);
              const d = pathGenerator(feat) || "";
              const displayName =
                countryData?.country_name || feat.properties?.name || alpha2 || "Unknown";

              return (
                <path
                  key={`${idStr}-${idx}`}
                  d={d}
                  fill={fillColor ?? "var(--hub-map-land)"}
                  fillOpacity={fillColor ? (isSelected ? 0.92 : 0.72) : 1}
                  stroke={isSelected ? "#1D4ED8" : "var(--hub-map-stroke)"}
                  strokeWidth={isSelected ? 1.1 : 0.55}
                  className={
                    countryData && !compact
                      ? "cursor-pointer transition-opacity duration-150 hover:opacity-90"
                      : "transition-colors duration-150"
                  }
                  onMouseMove={(e) => {
                    if (!countryData || compact) return;
                    updateTooltipPos(e, {
                      code: alpha2,
                      name: displayName,
                      country: countryData,
                    });
                  }}
                  onClick={() => {
                    if (!countryData || compact || !alpha2) return;
                    onSelectCountry?.(
                      selectedCountry.toUpperCase() === alpha2 ? "" : alpha2,
                    );
                  }}
                />
              );
            })}
          </g>

          {/* Subtle node scatter dots */}
          {nodeDots.map((dot) => {
            const fill = getMarkerColor(
              dot.marker.latency_ms,
              dot.marker.fraud_score,
              mode,
            );
            return (
              <circle
                key={`m-${dot.marker.node_id}`}
                cx={dot.cx}
                cy={dot.cy}
                r={2.4}
                fill={fill}
                fillOpacity={0.75}
                className="pointer-events-none"
              />
            );
          })}

          {/* Country / Region glowing pins */}
          {countryPins.map((pin) => {
            const isSelected =
              Boolean(selectedCountry) &&
              pin.code === selectedCountry.toUpperCase();
            const color =
              getCountryColor(pin.country, mode, isSelected) ?? "#2563EB";
            const radius = Math.min(8, Math.max(4, 3 + Math.sqrt(pin.country.node_count)));

            return (
              <g
                key={pin.code}
                className={compact ? "pointer-events-none" : "cursor-pointer"}
                onMouseMove={(e) => {
                  if (compact) return;
                  updateTooltipPos(e, {
                    code: pin.code,
                    name: pin.name,
                    country: pin.country,
                  });
                }}
                onClick={(e) => {
                  if (compact) return;
                  e.stopPropagation();
                  onSelectCountry?.(
                    selectedCountry.toUpperCase() === pin.code ? "" : pin.code,
                  );
                }}
              >
                <circle
                  cx={pin.cx}
                  cy={pin.cy}
                  r={radius + 4}
                  fill={color}
                  fillOpacity={isSelected ? 0.28 : 0.16}
                />
                <circle
                  cx={pin.cx}
                  cy={pin.cy}
                  r={isSelected ? radius + 1 : radius}
                  fill={color}
                  stroke="#FFFFFF"
                  strokeWidth={1.3}
                />
              </g>
            );
          })}
        </svg>

        {/* Legend bar */}
        {!compact && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-[var(--hub-muted)]">
            {mode === "latency" ? (
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  ≤ 80ms 极速
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  81–180ms 良好
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  &gt; 180ms 较高
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  0–25 极纯净
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  26–50 低风险
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  51–75 中风险
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                  76–100 高风险
                </span>
              </div>
            )}
            <span className="font-mono tabular-nums">
              {countries.length} 个国家/地区
            </span>
          </div>
        )}

        {/* Visitors-style dark floating hover tooltip */}
        {tooltip && tooltip.country && !compact && (
          <div
            className="pointer-events-none absolute z-30 min-w-[205px] rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-xs text-zinc-100 shadow-2xl"
            style={{
              left: Math.min(
                tooltip.x + 14,
                (containerRef.current?.clientWidth ?? 600) - 225,
              ),
              top: Math.max(12, tooltip.y - 84),
            }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-1.5">
              <span className="flex items-center gap-1.5 font-medium text-white">
                <span>{countryCodeToFlagEmoji(tooltip.code)}</span>
                <span>{tooltip.name}</span>
              </span>
              <span className="font-mono tabular-nums text-[11px] text-zinc-400">
                {tooltip.country.node_count} 节点
              </span>
            </div>
            <div className="mt-1.5 space-y-1 text-[11px]">
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-400">最低延迟</span>
                <span className="font-mono tabular-nums font-medium text-emerald-400">
                  {formatLatency(tooltip.country.min_latency_ms)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-400">IPPure 均分</span>
                <span className="flex items-center gap-1.5 font-mono tabular-nums font-medium">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      getFraudTier(tooltip.country.avg_fraud_score).dotClass
                    }`}
                  />
                  {tooltip.country.avg_fraud_score >= 0
                    ? `${Math.round(tooltip.country.avg_fraud_score)} (${
                        getFraudTier(tooltip.country.avg_fraud_score).shortLabel
                      })`
                    : "未检测"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-zinc-400">住宅原生节点</span>
                <span className="font-mono tabular-nums text-zinc-200">
                  {tooltip.country.residential_count}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorldMapCard;
