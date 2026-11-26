import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SubscriptionNode } from "@/types/hub";

export type NodeSortField =
  | "default"
  | "latency"
  | "download"
  | "fraud_score"
  | "name"
  | "country";

export type SortDirection = "asc" | "desc";

const SORT_OPTIONS: Array<{
  value: string;
  sortBy: NodeSortField;
  sortDir: SortDirection;
  labelKey: string;
}> = [
  { value: "default", sortBy: "default", sortDir: "asc", labelKey: "pulse.sort.default" },
  { value: "latency:asc", sortBy: "latency", sortDir: "asc", labelKey: "pulse.sort.latencyAsc" },
  { value: "latency:desc", sortBy: "latency", sortDir: "desc", labelKey: "pulse.sort.latencyDesc" },
  { value: "download:desc", sortBy: "download", sortDir: "desc", labelKey: "pulse.sort.downloadDesc" },
  { value: "download:asc", sortBy: "download", sortDir: "asc", labelKey: "pulse.sort.downloadAsc" },
  { value: "fraud_score:asc", sortBy: "fraud_score", sortDir: "asc", labelKey: "pulse.sort.fraudAsc" },
  { value: "fraud_score:desc", sortBy: "fraud_score", sortDir: "desc", labelKey: "pulse.sort.fraudDesc" },
  { value: "country:asc", sortBy: "country", sortDir: "asc", labelKey: "pulse.sort.countryAsc" },
  { value: "country:desc", sortBy: "country", sortDir: "desc", labelKey: "pulse.sort.countryDesc" },
  { value: "name:asc", sortBy: "name", sortDir: "asc", labelKey: "pulse.sort.nameAsc" },
  { value: "name:desc", sortBy: "name", sortDir: "desc", labelKey: "pulse.sort.nameDesc" },
];

export function defaultDirForField(field: NodeSortField): SortDirection {
  return field === "download" ? "desc" : "asc";
}

function encodeSortValue(sortBy: NodeSortField, sortDir: SortDirection): string {
  return sortBy === "default" ? "default" : `${sortBy}:${sortDir}`;
}

function decodeSortValue(value: string): { sortBy: NodeSortField; sortDir: SortDirection } {
  if (value === "default") {
    return { sortBy: "default", sortDir: "asc" };
  }
  const [rawField, rawDir] = value.split(":");
  const validFields: NodeSortField[] = [
    "default",
    "latency",
    "download",
    "fraud_score",
    "name",
    "country",
  ];
  const sortBy = validFields.includes(rawField as NodeSortField)
    ? (rawField as NodeSortField)
    : "default";
  const sortDir: SortDirection = rawDir === "desc" ? "desc" : "asc";
  return { sortBy, sortDir };
}

function tieBreakByName(a: SubscriptionNode, b: SubscriptionNode): number {
  const cmp = (a.name || "").localeCompare(b.name || "", undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return cmp !== 0 ? cmp : a.id - b.id;
}

function latencyRank(node: SubscriptionNode): number {
  if (node.latency_ms > 0 && node.test_status === "ok") return 0;
  if (node.latency_ms === 0) return 1;
  return 2;
}

function hasValidFraudScore(node: SubscriptionNode): boolean {
  return Boolean(
    node.ippure && !node.ippure.error && node.ippure.fraud_score >= 0,
  );
}

/** Sort subscription nodes with untested/failed entries ranked after valid measurements. */
export function sortSubscriptionNodes(
  nodes: SubscriptionNode[],
  sortBy: NodeSortField,
  sortDir: SortDirection,
): SubscriptionNode[] {
  if (sortBy === "default") {
    return [...nodes];
  }
  const dir = sortDir === "asc" ? 1 : -1;

  return [...nodes].sort((a, b) => {
    switch (sortBy) {
      case "latency": {
        const ra = latencyRank(a);
        const rb = latencyRank(b);
        if (ra !== rb) return ra - rb;
        if (ra === 0) {
          const diff = (a.latency_ms - b.latency_ms) * dir;
          if (diff !== 0) return diff;
        }
        return tieBreakByName(a, b);
      }
      case "download": {
        const ra = a.download_mbps > 0 ? 0 : 1;
        const rb = b.download_mbps > 0 ? 0 : 1;
        if (ra !== rb) return ra - rb;
        if (ra === 0) {
          const diff = (a.download_mbps - b.download_mbps) * dir;
          if (diff !== 0) return diff;
        }
        return tieBreakByName(a, b);
      }
      case "fraud_score": {
        const ra = hasValidFraudScore(a) ? 0 : 1;
        const rb = hasValidFraudScore(b) ? 0 : 1;
        if (ra !== rb) return ra - rb;
        if (ra === 0) {
          const scoreA = a.ippure?.fraud_score ?? 0;
          const scoreB = b.ippure?.fraud_score ?? 0;
          const diff = (scoreA - scoreB) * dir;
          if (diff !== 0) return diff;
        }
        return tieBreakByName(a, b);
      }
      case "country": {
        const codeA = (a.country_code || "").trim();
        const codeB = (b.country_code || "").trim();
        const ra = codeA ? 0 : 1;
        const rb = codeB ? 0 : 1;
        if (ra !== rb) return ra - rb;
        if (ra === 0) {
          const nameA = a.country_name || codeA;
          const nameB = b.country_name || codeB;
          const nameCmp = nameA.localeCompare(nameB, undefined, {
            numeric: true,
            sensitivity: "base",
          });
          if (nameCmp !== 0) return nameCmp * dir;
          const codeCmp = codeA.localeCompare(codeB, undefined, {
            sensitivity: "base",
          });
          if (codeCmp !== 0) return codeCmp * dir;
          const cityCmp = (a.city || "").localeCompare(b.city || "", undefined, {
            numeric: true,
            sensitivity: "base",
          });
          if (cityCmp !== 0) return cityCmp * dir;
        }
        return tieBreakByName(a, b);
      }
      case "name":
      default: {
        const cmp = (a.name || "").localeCompare(b.name || "", undefined, {
          numeric: true,
          sensitivity: "base",
        });
        return cmp !== 0 ? cmp * dir : a.id - b.id;
      }
    }
  });
}

export const SortableTableHeader: React.FC<{
  label: string;
  column: NodeSortField;
  sortBy: NodeSortField;
  sortDir: SortDirection;
  onSort: (column: NodeSortField) => void;
  className?: string;
}> = ({ label, column, sortBy, sortDir, onSort, className = "px-4 py-2.5" }) => {
  const active = sortBy === column;
  return (
    <th className={className}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 font-medium transition-colors hover:text-[var(--hub-ink)] ${
          active ? "text-[var(--hub-ink)]" : "text-[var(--hub-muted)]"
        }`}
      >
        <span>{label}</span>
        {active ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-3 w-3 text-blue-600 dark:text-blue-400" />
          ) : (
            <ArrowDown className="h-3 w-3 text-blue-600 dark:text-blue-400" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-60" />
        )}
      </button>
    </th>
  );
};

export const NodeSortSelect: React.FC<{
  sortBy: NodeSortField;
  sortDir: SortDirection;
  onChange: (sortBy: NodeSortField, sortDir: SortDirection) => void;
}> = ({ sortBy, sortDir, onChange }) => {
  const { t } = useTranslation();
  return (
    <select
      aria-label={t("pulse.sort.ariaLabel")}
      value={encodeSortValue(sortBy, sortDir)}
      onChange={(e) => {
        const next = decodeSortValue(e.target.value);
        onChange(next.sortBy, next.sortDir);
      }}
      className="h-8 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2.5 text-xs text-[var(--hub-ink)]"
    >
      {SORT_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {t(opt.labelKey)}
        </option>
      ))}
    </select>
  );
};
