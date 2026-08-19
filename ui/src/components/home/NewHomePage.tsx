"use client";

import { HeroComposer } from "@/components/home/HeroComposer";
import { HomeExperienceToggle } from "@/components/home/HomeExperienceToggle";
import { HomeWidgetFrame } from "@/components/home/HomeWidgetFrame";
import { QuickStartSection } from "@/components/home/QuickStart/QuickStartSection";
import { HOME_WIDGET_COMPONENTS } from "@/components/home/widget-registry";
import { Button } from "@/components/ui/button";
import { Popover,PopoverContent,PopoverTrigger } from "@/components/ui/popover";
import { useHomeWidgetsStore } from "@/store/home-widgets-store";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { computeReorder } from "@/lib/reorder";
import { Plus } from "lucide-react";
import { useMemo } from "react";

export function NewHomePage() {
  const widgets = useHomeWidgetsStore((s) => s.widgets);
  const addWidget = useHomeWidgetsStore((s) => s.addWidget);
  const reorderWidgets = useHomeWidgetsStore((s) => s.reorderWidgets);
  const setExperience = useHomeWidgetsStore((s) => s.setExperience);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active,over } = event;
    if (!over) return;
    const next = computeReorder(widgets, String(active.id), String(over.id));
    if (next) reorderWidgets(next);
  };
  // `availableToAdd()` computes a fresh array each call — only re-derive it
  // when `widgets` actually changes, rather than calling it inline in the
  // selector (a new array reference every render trips Zustand's
  // getServerSnapshot infinite-loop guard).
  // `widgets` isn't read inside the callback (it goes through getState()) but
  // is the trigger for recomputing — calling availableToAdd() directly in a
  // selector returns a fresh array every render and trips Zustand's
  // getServerSnapshot loop guard.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const availableToAdd = useMemo(() => useHomeWidgetsStore.getState().availableToAdd(), [widgets]);

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <HomeExperienceToggle
        label="Go back to the previous Home experience"
        onClick={() => setExperience("classic")}
        testId="switch-to-classic-home"
      />

      <HeroComposer />

      <QuickStartSection />

      {availableToAdd.length > 0 && (
        <div className="flex justify-end">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5" data-testid="add-widget-trigger">
                <Plus className="h-3.5 w-3.5" />
                Add widget
              </Button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-56 p-1">
              {availableToAdd.map((widget) => (
                <button
                  key={widget.id}
                  type="button"
                  onClick={() => addWidget(widget.id)}
                  data-testid={`add-widget-${widget.id}`}
                  className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  {widget.label}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={widgets} strategy={verticalListSortingStrategy}>
          {widgets.map((widgetId) => {
            const Widget = HOME_WIDGET_COMPONENTS[widgetId];
            if (!Widget) return null;
            return (
              <HomeWidgetFrame key={widgetId} widgetId={widgetId}>
                <Widget />
              </HomeWidgetFrame>
            );
          })}
        </SortableContext>
      </DndContext>

      <p className="text-center text-xs text-muted-foreground/50 pt-4 pb-2">
        ⚡ Powered by{" "}
        <a
          href="https://caipe.io"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-muted-foreground/70 transition-colors"
        >
          caipe.io
        </a>
      </p>
    </div>
  );
}
