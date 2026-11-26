import type { SubscriptionNode } from "@/types/hub";

export type NodeSortBy =
  | "default"
  | "latency"
  | "download"
  | "fraud_score"
  | "name"
  | "country";

export type NodeSortDir = "asc" | "desc";

export interface NodeSortOption {
  value: string;
  sortBy: NodeSortBy;
  sortDir: NodeSortDir;
  label: string;
}

export const NODE_SORT_OPTIONS: NodeSortOption[] = [
  { value: "default", sortBy: "default", sortDir: "asc", label: "默认排序" },
  { value: "latency:asc", sortBy: "latency", sortDir: "asc", label: "延迟从低到高" },
  { value: "latency:desc", sortBy: "latency", sortDir: "desc", label: "延迟从高到低" },
  { value: "download:desc", sortBy: "download", sortDir: "desc", label: "下载速度从高到低" },
  { value: "download:asc", sortBy: "download", sortDir: "asc", label: "下载速度从低到高" },
  { value: "fraud_score:asc", sortBy: "fraud_score", sortDir: "asc", label: "纯净度评分 (低→高)" },
  { value: "fraud_score:desc", sortBy: "fraud_score", sortDir: "desc", label: "纯净度评分 (高→低)" },
  { value: "country:asc", sortBy: "country", sortDir: "asc", label: "地区 (A→Z)" },
  { value: "country:desc", sortBy: "country", sortDir: "desc", label: "地区 (Z→A)" },
  { value: "name:asc", sortBy: "name", sortDir: "asc", label: "名称 (A→Z)" },
  { value: "name:desc", sortBy: "name", sortDir: "desc", label: "名称 (Z→A)" },
];

export function getDefaultSortDir(sortBy: NodeSortBy): NodeSortDir {
  return sortBy === "download" ? "desc" : "asc";
}

export function encodeNodeSortValue(
  sortBy: NodeSortBy,
  sortDir: NodeSortDir,
): string {
  return sortBy === "default" ? "default" : `${sortBy}:${sortDir}`;
}

export function decodeNodeSortValue(value: string): {
  sortBy: NodeSortBy;
  sortDir: NodeSortDir;
} {
  if (value === "default") {
    return { sortBy: "default", sortDir: "asc" };
  }
  const [by, dir] = value.split(":");
  const validBy: NodeSortBy[] = [
    "default",
    "latency",
    "download",
    "fraud_score",
    "name",
    "country",
  ];
  const sortBy = validBy.includes(by as NodeSortBy)
    ? (by as NodeSortBy)
    : "default";
  const sortDir: NodeSortDir = dir === "desc" ? "desc" : "asc";
  return { sortBy, sortDir };
}

function compareNodeNames(a: SubscriptionNode, b: SubscriptionNode): number {
  const cmp = (a.name || "").localeCompare(b.name || "", undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return cmp !== 0 ? cmp : a.id - b.id;
}

function getLatencyBucket(node: SubscriptionNode): number {
  if (node.latency_ms > 0 && node.test_status === "ok") return 0;
  if (node.latency_ms === 0) return 1;
  return 2;
}

function hasValidPurity(node: SubscriptionNode): boolean {
  return Boolean(
    node.ippure && !node.ippure.error && node.ippure.fraud_score >= 0,
  );
}

/**
 * Sort subscription nodes consistently across admin and public node tables.
 * Invalid, untested, or failed rows are always kept after valid tested rows.
 */
export function sortSubscriptionNodes(
  nodes: SubscriptionNode[],
  sortBy: NodeSortBy,
  sortDir: NodeSortDir,
): SubscriptionNode[] {
  if (sortBy === "default") {
    return [...nodes];
  }

  const dir = sortDir === "asc" ? 1 : -1;

  return [...nodes].sort((a, b) => {
    switch (sortBy) {
      case "latency": {
        const bucketA = getLatencyBucket(a);
        const bucketB = getLatencyBucket(b);
        if (bucketA !== bucketB) return bucketA - bucketB;
        if (bucketA === 0) {
          const diff = (a.latency_ms - b.latency_ms) * dir;
          if (diff !== 0) return diff;
        }
        return compareNodeNames(a, b);
      }

      case "download": {
        const validA = a.download_mbps > 0 ? 0 : 1;
        const validB = b.download_mbps > 0 ? 0 : 1;
        if (validA !== validB) return validA - validB;
        if (validA === 0) {
          const diff = (a.download_mbps - b.download_mbps) * dir;
          if (diff !== 0) return diff;
        }
        return compareNodeNames(a, b);
      }

      case "fraud_score": {
        const validA = hasValidPurity(a) ? 0 : 1;
        const validB = hasValidPurity(b) ? 0 : 1;
        if (validA !== validB) return validA - validB;
        if (validA === 0) {
          const diff =
            ((a.ippure?.fraud_score ?? 0) - (b.ippure?.fraud_score ?? 0)) * dir;
          if (diff !== 0) return diff;
        }
        return compareNodeNames(a, b);
      }

      case "country": {
        const codeA = (a.country_code || "").trim();
        const codeB = (b.country_code || "").trim();
        const validA = codeA ? 0 : 1;
        const validB = codeB ? 0 : 1;
        if (validA !== validB) return validA - validB;
        if (validA === 0) {
          const countryA = a.country_name || codeA;
          const countryB = b.country_name || codeB;
          const countryCmp = countryA.localeCompare(countryB, undefined, {
            numeric: true,
            sensitivity: "base",
          });
          if (countryCmp !== 0) return countryCmp * dir;

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
        return compareNodeNames(a, b);
      }

      case "name":
      default: {
        const cmp = (a.name || "").localeCompare(b.name || "", undefined, {
          numeric: true,
          sensitivity: "base",
        });
        if (cmp !== 0) return cmp * dir;
        return a.id - b.id;
      }
    }
  });
}
