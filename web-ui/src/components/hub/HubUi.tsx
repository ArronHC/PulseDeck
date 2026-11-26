import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import type { HealthStatus, UptimeHeartbeat } from "@/types/hub";
import { formatLatency } from "@/lib/hubApi";

export const TIME_RANGE_OPTIONS = [
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
] as const;

export function HubCard({
  children,
  className = "",
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-[var(--hub-border)] bg-[var(--hub-surface)] transition-colors ${
        onClick ? "cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function HealthPill({
  status,
  alerts = 0,
  onClick,
  compact = false,
}: {
  status: HealthStatus;
  alerts?: number;
  onClick?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const config =
    status === "outage"
      ? {
          text:
            alerts > 0
              ? t("pulse.health.outageCount", { count: alerts })
              : t("pulse.health.outage"),
          cls: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/60 dark:text-rose-300",
          dot: "bg-rose-500",
          Icon: AlertCircle,
        }
      : status === "degraded"
        ? {
            text:
              alerts > 0
                ? t("pulse.health.degradedCount", { count: alerts })
                : t("pulse.health.degraded"),
            cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/60 dark:text-amber-300",
            dot: "bg-amber-500",
            Icon: AlertTriangle,
          }
        : {
            text: t("pulse.health.operational"),
            cls: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/60 dark:text-emerald-300",
            dot: "bg-emerald-500",
            Icon: CheckCircle2,
          };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-85 ${config.cls} ${
        compact ? "px-2 py-0.5 text-[11px]" : ""
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot} animate-pulse`} />
      <span>{config.text}</span>
    </button>
  );
}

export function TimeRangePills({
  hours,
  onChange,
}: {
  hours: number;
  onChange: (hours: number) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-[var(--hub-border)] bg-[var(--hub-surface)] p-0.5">
      {TIME_RANGE_OPTIONS.map((opt) => {
        const active = hours === opt.hours;
        return (
          <button
            key={opt.hours}
            type="button"
            onClick={() => onChange(opt.hours)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium font-mono tabular-nums transition-colors ${
              active
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-[var(--hub-muted)] hover:text-[var(--hub-ink)]"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Uptime Kuma style heartbeat bar (60 ticks or compact 20 ticks).
 * Supports rich hover tooltip with timestamp, status, latency, and message.
 */
export function HeartbeatStrip({
  heartbeats,
  compactBeats,
  slots = 60,
  heightClass = "h-6",
}: {
  heartbeats?: UptimeHeartbeat[];
  compactBeats?: number[];
  slots?: number;
  heightClass?: string;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<{
    idx: number;
    x: number;
    top: number;
    bottom: number;
  } | null>(null);

  const items: Array<{
    status: number; // -1 = empty placeholder, 0 = down, 1 = up, 2 = degraded
    latency_ms?: number;
    message?: string;
    checked_at?: string;
  }> = React.useMemo(() => {
    if (heartbeats && heartbeats.length > 0) {
      const sliced = heartbeats.slice(-slots);
      const padCount = Math.max(0, slots - sliced.length);
      return [
        ...Array.from({ length: padCount }, () => ({ status: -1 })),
        ...sliced.map((hb) => ({
          status: hb.status,
          latency_ms: hb.latency_ms,
          message: hb.message,
          checked_at: hb.checked_at,
        })),
      ];
    }
    if (compactBeats && compactBeats.length > 0) {
      const sliced = compactBeats.slice(-slots);
      const padCount = Math.max(0, slots - sliced.length);
      return [
        ...Array.from({ length: padCount }, () => ({ status: -1 })),
        ...sliced.map((st) => ({ status: st })),
      ];
    }
    return Array.from({ length: slots }, () => ({ status: -1 }));
  }, [heartbeats, compactBeats, slots]);

  const hoveredIdx = hovered?.idx ?? null;
  const hoveredItem = hoveredIdx !== null ? items[hoveredIdx] : null;
  const placeBelow = (hovered?.top ?? 0) < 110;
  const clampedX =
    typeof window !== "undefined" && hovered
      ? Math.min(Math.max(hovered.x, 128), Math.max(128, window.innerWidth - 128))
      : hovered?.x ?? 0;

  return (
    <div
      className="relative flex items-center gap-[2px] w-full"
      onMouseLeave={() => setHovered(null)}
    >
      {items.map((item, idx) => {
        const barColor =
          item.status === 1
            ? "bg-emerald-500 hover:bg-emerald-400"
            : item.status === 0
              ? "bg-rose-500 hover:bg-rose-400"
              : item.status === 2
                ? "bg-amber-500 hover:bg-amber-400"
                : "bg-zinc-200 dark:bg-zinc-800";

        return (
          <div
            key={idx}
            onMouseEnter={(e) => {
              if (item.status !== -1) {
                const rect = e.currentTarget.getBoundingClientRect();
                setHovered({
                  idx,
                  x: rect.left + rect.width / 2,
                  top: rect.top,
                  bottom: rect.bottom,
                });
              } else {
                setHovered(null);
              }
            }}
            className={`flex-1 min-w-[2px] rounded-[2px] transition-transform duration-100 ${heightClass} ${barColor} ${
              hoveredIdx === idx && item.status !== -1 ? "scale-y-115" : ""
            }`}
          />
        );
      })}

      {typeof document !== "undefined" &&
        hovered &&
        hoveredItem &&
        hoveredItem.status !== -1 &&
        hoveredItem.checked_at &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 min-w-[210px] max-w-[280px] rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 shadow-xl"
            style={{
              left: `${clampedX}px`,
              top: `${placeBelow ? hovered.bottom + 8 : hovered.top - 8}px`,
              transform: placeBelow ? "translateX(-50%)" : "translate(-50%, -100%)",
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <span
                  className={`h-2 w-2 rounded-full ${
                    hoveredItem.status === 1
                      ? "bg-emerald-400"
                      : hoveredItem.status === 0
                        ? "bg-rose-400"
                        : "bg-amber-400"
                  }`}
                />
                {hoveredItem.status === 1
                  ? t("pulse.health.beatUp")
                  : hoveredItem.status === 0
                    ? t("pulse.health.beatDown")
                    : t("pulse.health.beatDegraded")}
              </span>
              <span className="font-mono tabular-nums text-zinc-300">
                {formatLatency(hoveredItem.latency_ms)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-zinc-400 font-mono tabular-nums">
              <Clock className="h-3 w-3 shrink-0" />
              <span>{new Date(hoveredItem.checked_at).toLocaleString()}</span>
            </div>
            {hoveredItem.message && (
              <div className="mt-1 truncate text-[11px] text-zinc-300">
                {hoveredItem.message}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function HubEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--hub-border)] bg-[var(--hub-surface)] px-6 py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--hub-border)] bg-[var(--hub-canvas)] text-[var(--hub-muted)]">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-[var(--hub-ink)]">{title}</h3>
      <p className="mt-1 max-w-md text-xs text-[var(--hub-muted)] leading-relaxed">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
