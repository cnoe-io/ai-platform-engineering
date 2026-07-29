"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Gavel, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PanelShell } from "@/components/tome/PanelHeader";
import { TRACKED_ENTITY_PRIORITIES, type TrackedEntityPriority } from "@/lib/tome/schema";
import { cn } from "@/lib/utils";

interface CriticalItem {
  id: string;
  type: "issue" | "decision";
  title: string;
  status: string;
  priority: TrackedEntityPriority;
  owner: string | null;
  opened: string | null;
  target: string | null;
  body: string;
  source_project_slug: string;
  path: string;
}

const PRIORITY_FILTER_LABELS: Record<TrackedEntityPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const ISSUE_COLUMNS = [
  { status: "open", label: "Open" },
  { status: "in_progress", label: "In progress" },
  { status: "resolved", label: "Resolved" },
] as const;

const DECISION_COLUMNS = [
  { status: "proposed", label: "Proposed" },
  { status: "accepted", label: "Accepted" },
  { status: "rejected", label: "Rejected" },
] as const;

function summary(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/[#>*_`[\]]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const PROJECT_FILTER_ALL = "all";

export function CriticalItemsBoard({ slug }: { slug: string }) {
  const [items, setItems] = useState<CriticalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<Set<TrackedEntityPriority>>(
    () => new Set(["critical"]),
  );
  const [projectFilter, setProjectFilter] = useState<string>(PROJECT_FILTER_ALL);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/tome/projects/${encodeURIComponent(slug)}/critical-items`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to load critical items");
      setItems(body.data?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const moveItem = useCallback(async (item: CriticalItem, nextStatus: string) => {
    if (item.status === nextStatus) return;
    setMoveError(null);
    // Optimistic update so the card lands in its new column immediately.
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, status: nextStatus } : i)),
    );
    const entitySlug = item.path.split("/").pop()?.replace(/\.md$/, "") ?? "";
    try {
      const response = await fetch(
        `/api/tome/projects/${encodeURIComponent(item.source_project_slug)}/entities/${item.type}/${encodeURIComponent(entitySlug)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseBody.error ?? "Failed to move item");
    } catch (err) {
      // Roll back on failure.
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: item.status } : i)),
      );
      setMoveError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const togglePriority = (priority: TrackedEntityPriority) => {
    setPriorityFilter((prev) => {
      const next = new Set(prev);
      if (next.has(priority)) next.delete(priority);
      else next.add(priority);
      return next;
    });
  };

  const draggedItem = items.find((i) => i.id === draggedId) ?? null;
  const sourceProjects = [...new Set(items.map((item) => item.source_project_slug))].sort();
  const allPrioritiesSelected = priorityFilter.size === TRACKED_ENTITY_PRIORITIES.length;

  const filteredItems = items
    .filter((item) => allPrioritiesSelected || priorityFilter.has(item.priority))
    .filter((item) => projectFilter === PROJECT_FILTER_ALL || item.source_project_slug === projectFilter);

  return (
    <PanelShell maxWidthClassName="">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Generated report
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Issues</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Tracked issues and decisions from this wiki, its hierarchy, and cross-project{" "}
            <code>tome://</code> targets. Update a card&apos;s source page or use the Tome MCP
            lifecycle tools to move it.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {TRACKED_ENTITY_PRIORITIES.map((priority) => (
            <button
              key={priority}
              type="button"
              onClick={() => togglePriority(priority)}
              aria-pressed={priorityFilter.has(priority)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition",
                priorityFilter.has(priority)
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {PRIORITY_FILTER_LABELS[priority]}
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              setPriorityFilter(allPrioritiesSelected ? new Set() : new Set(TRACKED_ENTITY_PRIORITIES))
            }
            aria-pressed={allPrioritiesSelected}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition",
              allPrioritiesSelected
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            All
          </button>
        </div>

        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
          aria-label="Filter by source project"
        >
          <option value={PROJECT_FILTER_ALL}>All projects</option>
          {sourceProjects.map((project) => (
            <option key={project} value={project}>
              {project}
            </option>
          ))}
        </select>
      </div>

      {moveError && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {moveError}
        </p>
      )}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Building the roll-up…
        </div>
      ) : error ? (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-12 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 font-medium">No tracked items</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {allPrioritiesSelected && projectFilter === PROJECT_FILTER_ALL ? (
              "Issues and decisions appear here once they're tracked."
            ) : (
              "No items match the current filters. Try widening your selection."
            )}
          </p>
        </div>
      ) : (
        <>
          <BoardSection
            title="Issues"
            icon={<AlertCircle className="h-4 w-4 text-red-500" />}
            items={filteredItems.filter((item) => item.type === "issue")}
            columns={ISSUE_COLUMNS}
            sectionType="issue"
            draggedId={draggedId}
            draggedItemType={draggedItem?.type ?? null}
            onDragStart={setDraggedId}
            onDragEnd={() => {
              setDraggedId(null);
              setDragOverStatus(null);
            }}
            dragOverStatus={dragOverStatus}
            onDragOverColumn={setDragOverStatus}
            onDropOnColumn={(status) => {
              const item = draggedItem;
              setDraggedId(null);
              setDragOverStatus(null);
              if (item?.type === "issue") void moveItem(item, status);
            }}
          />
          <BoardSection
            title="Decisions"
            icon={<Gavel className="h-4 w-4 text-violet-500" />}
            items={filteredItems.filter((item) => item.type === "decision")}
            columns={DECISION_COLUMNS}
            sectionType="decision"
            draggedId={draggedId}
            draggedItemType={draggedItem?.type ?? null}
            onDragStart={setDraggedId}
            onDragEnd={() => {
              setDraggedId(null);
              setDragOverStatus(null);
            }}
            dragOverStatus={dragOverStatus}
            onDragOverColumn={setDragOverStatus}
            onDropOnColumn={(status) => {
              const item = draggedItem;
              setDraggedId(null);
              setDragOverStatus(null);
              if (item?.type === "decision") void moveItem(item, status);
            }}
          />
        </>
      )}
    </PanelShell>
  );
}

function BoardSection({
  title,
  icon,
  items,
  columns,
  sectionType,
  draggedId,
  draggedItemType,
  onDragStart,
  onDragEnd,
  dragOverStatus,
  onDragOverColumn,
  onDropOnColumn,
}: {
  title: string;
  icon: React.ReactNode;
  items: CriticalItem[];
  columns: readonly { status: string; label: string }[];
  /** Only accept a drop here from a card of this same type — an issue can't
   * be dragged into the Decisions board (different status vocabulary; the
   * PATCH would 400 on an invalid status for that entity type). */
  sectionType: "issue" | "decision";
  draggedId: string | null;
  draggedItemType: "issue" | "decision" | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  dragOverStatus: string | null;
  onDragOverColumn: (status: string) => void;
  onDropOnColumn: (status: string) => void;
}) {
  const draggingCompatibleItem = draggedId !== null && draggedItemType === sectionType;
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-semibold">
        {icon}
        {title}
        <span className="text-xs font-normal text-muted-foreground">{items.length}</span>
      </h2>
      <div className="grid gap-4 xl:grid-cols-3">
        {columns.map((column) => {
          const columnItems = items.filter((item) => item.status === column.status);
          const isDragOver = dragOverStatus === column.status && draggingCompatibleItem;
          return (
            <div
              key={column.status}
              onDragOver={(event) => {
                if (!draggingCompatibleItem) return;
                event.preventDefault();
                onDragOverColumn(column.status);
              }}
              onDrop={(event) => {
                if (!draggingCompatibleItem) return;
                event.preventDefault();
                onDropOnColumn(column.status);
              }}
              className={cn(
                "min-h-32 rounded-xl border bg-muted/20 p-3 transition",
                isDragOver && "border-primary bg-primary/5",
              )}
            >
              <div className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <span>{column.label}</span>
                <span>{columnItems.length}</span>
              </div>
              <div className="space-y-2">
                {columnItems.map((item) => (
                  <Link
                    key={item.id}
                    href={`/projects/${item.source_project_slug}/tome/wiki/${item.path}`}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      onDragStart(item.id);
                    }}
                    onDragEnd={onDragEnd}
                    className={cn(
                      "block cursor-grab rounded-lg border bg-background p-3 shadow-sm transition active:cursor-grabbing hover:border-primary/40 hover:shadow",
                      draggedId === item.id && "opacity-40",
                    )}
                  >
                    <p className="font-medium leading-snug">{item.title}</p>
                    {summary(item.body) && (
                      <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                        {summary(item.body)}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 font-semibold uppercase",
                          item.priority === "critical"
                            ? "bg-red-500/10 text-red-600 dark:text-red-400"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {item.priority}
                      </span>
                      <span>{item.source_project_slug}</span>
                      {item.owner && <span>· {item.owner}</span>}
                    </div>
                  </Link>
                ))}
                {columnItems.length === 0 && (
                  <p className="py-5 text-center text-xs text-muted-foreground/60">
                    {isDragOver ? "Drop here" : "No items"}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
