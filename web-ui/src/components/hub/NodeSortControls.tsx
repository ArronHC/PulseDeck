import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  decodeNodeSortValue,
  encodeNodeSortValue,
  NODE_SORT_OPTIONS,
  type NodeSortBy,
  type NodeSortDir,
} from "@/lib/nodeSort";

export function SortableNodeHeader({
  label,
  column,
  sortBy,
  sortDir,
  onSort,
  className = "px-4 py-2.5",
}: {
  label: string;
  column: Exclude<NodeSortBy, "default">;
  sortBy: NodeSortBy;
  sortDir: NodeSortDir;
  onSort: (column: Exclude<NodeSortBy, "default">) => void;
  className?: string;
}) {
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
}

export function NodeSortSelect({
  sortBy,
  sortDir,
  onChange,
}: {
  sortBy: NodeSortBy;
  sortDir: NodeSortDir;
  onChange: (nextBy: NodeSortBy, nextDir: NodeSortDir) => void;
}) {
  return (
    <select
      aria-label="节点排序方式"
      value={encodeNodeSortValue(sortBy, sortDir)}
      onChange={(e) => {
        const next = decodeNodeSortValue(e.target.value);
        onChange(next.sortBy, next.sortDir);
      }}
      className="h-8 rounded-lg border border-[var(--hub-border)] bg-[var(--hub-canvas)] px-2.5 text-xs text-[var(--hub-ink)]"
    >
      {NODE_SORT_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
