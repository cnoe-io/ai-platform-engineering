"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useHomeWidgetsStore } from "@/store/home-widgets-store";
import { cn } from "@/lib/utils";
import { GripVertical,X } from "lucide-react";
import type { ReactNode } from "react";

interface HomeWidgetFrameProps {
  widgetId: string;
  children: ReactNode;
}

/** Wraps a Home page content widget with shared reorder and remove controls. */
export function HomeWidgetFrame({ widgetId, children }: HomeWidgetFrameProps) {
  const removeWidget = useHomeWidgetsStore((s) => s.removeWidget);
  const { attributes,listeners,setNodeRef,setActivatorNodeRef,transform,transition,isDragging } =
    useSortable({ id: widgetId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("group/widget", isDragging && "relative z-10 opacity-70")}
      data-testid={`home-widget-${widgetId}`}
    >
      {/* Reserved header strip, not overlaid — several widgets (Recent Chats,
          Insights) already put their own links in the top-right corner, so
          these controls need their own row rather than floating on top. */}
      <div className="mb-1 flex items-center justify-end gap-1">
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder widget"
          title="Drag to reorder"
          data-testid={`home-widget-drag-${widgetId}`}
          className="invisible flex h-6 w-6 cursor-grab items-center justify-center rounded-full border border-border/50 bg-card text-muted-foreground hover:text-foreground active:cursor-grabbing group-hover/widget:visible"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => removeWidget(widgetId)}
          aria-label="Remove widget"
          title="Remove widget"
          data-testid={`home-widget-remove-${widgetId}`}
          className="invisible flex h-6 w-6 items-center justify-center rounded-full border border-border/50 bg-card text-muted-foreground hover:text-foreground group-hover/widget:visible"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}
