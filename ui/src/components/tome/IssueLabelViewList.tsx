"use client";

import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { GripVertical, ListFilter } from "lucide-react";

import type { IssueFilterView } from "@/lib/tome/issue-filter-views";
import { cn } from "@/lib/utils";

interface IssueLabelViewListProps {
  views: IssueFilterView[];
  customViews: IssueFilterView[];
  activeViewId?: string;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (sourceId: string, targetId: string) => void;
  reorderable?: boolean;
}

export function IssueLabelViewList({
  views,
  customViews,
  activeViewId,
  onSelect,
  onRemove,
  onReorder,
  reorderable = true,
}: IssueLabelViewListProps) {
  const [draggedViewId, setDraggedViewId] = useState<string | null>(null);
  const [dragOverViewId, setDragOverViewId] = useState<string | null>(null);
  const dragSourceRef = useRef<string | null>(null);

  const finishDrag = useCallback(() => {
    dragSourceRef.current = null;
    setDraggedViewId(null);
    setDragOverViewId(null);
  }, []);

  useEffect(() => {
    window.addEventListener("mouseup", finishDrag);
    return () => window.removeEventListener("mouseup", finishDrag);
  }, [finishDrag]);

  const beginDrag = useCallback((sourceId: string) => {
    dragSourceRef.current = sourceId;
    setDraggedViewId(sourceId);
    setDragOverViewId(null);
  }, []);

  const startMouseDrag = useCallback(
    (event: MouseEvent<HTMLDivElement>, sourceId: string) => {
      if (event.button === 0) beginDrag(sourceId);
    },
    [beginDrag],
  );

  const markDragTarget = useCallback((targetId: string) => {
    const sourceId = dragSourceRef.current;
    if (!sourceId) return;
    setDragOverViewId(
      sourceId.toLowerCase() === targetId.toLowerCase()
        ? null
        : targetId,
    );
  }, []);

  const dropOnLabel = useCallback(
    (targetId: string) => {
      const sourceId = dragSourceRef.current;
      if (!sourceId) return;
      if (sourceId.toLowerCase() !== targetId.toLowerCase()) {
        onReorder(sourceId, targetId);
      }
      finishDrag();
    },
    [finishDrag, onReorder],
  );

  const moveWithKeyboard = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, sourceId: string) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const sourceIndex = views.findIndex(
        ({ id }) => id.toLowerCase() === sourceId.toLowerCase(),
      );
      const targetIndex = sourceIndex + (event.key === "ArrowUp" ? -1 : 1);
      const target = views[targetIndex];
      if (sourceIndex >= 0 && target) {
        onReorder(sourceId, target.id);
      }
    },
    [onReorder, views],
  );

  return (
    <div className="flex flex-col gap-0.5">
      {views.map((view) => {
        const active = activeViewId?.toLowerCase() === view.id.toLowerCase();
        const removable = customViews.some(
          ({ id }) => id.toLowerCase() === view.id.toLowerCase(),
        );
        const dragged =
          draggedViewId?.toLowerCase() === view.id.toLowerCase();
        const isDragOver =
          dragOverViewId?.toLowerCase() === view.id.toLowerCase();

        return (
          <div
            key={view.id.toLowerCase()}
            data-issue-filter-view={view.id}
            onMouseEnter={() => markDragTarget(view.id)}
            onMouseUp={() => dropOnLabel(view.id)}
            className={cn(
              "group flex items-center gap-0.5 rounded-md pl-5",
              dragged && "opacity-50",
              isDragOver && "ring-1 ring-primary/50",
            )}
          >
            {reorderable && (
              <div
                role="button"
                tabIndex={0}
                title={`Drag ${view.title} to reorder; use arrow keys for keyboard`}
                aria-label={`Drag ${view.title} to reorder`}
                onMouseDown={(event) => startMouseDrag(event, view.id)}
                onKeyDown={(event) => moveWithKeyboard(event, view.id)}
                className="select-none cursor-grab rounded p-0.5 text-muted-foreground/60 opacity-0 hover:bg-muted hover:text-foreground focus:opacity-100 active:cursor-grabbing group-hover:opacity-100"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </div>
            )}
            <button
              type="button"
              onClick={() => onSelect(view.id)}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                active && "bg-muted font-medium text-primary",
              )}
            >
              <ListFilter className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{view.title}</span>
            </button>
            {removable && (
              <button
                type="button"
                title={`Remove ${view.title} view`}
                aria-label={`Remove ${view.title} view`}
                onClick={() => onRemove(view.id)}
                className="rounded px-1 text-xs text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
