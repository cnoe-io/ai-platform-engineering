"use client";

/**
 * ResizableSectionGrid — alternative to SectionRenderer that places
 * every visible panel into a single responsive react-grid-layout. The
 * user can drag panel headers to reorder, drag the SE handle to
 * resize, and the coords are persisted per-user via usePanelPreferences.
 *
 * SSR safety: react-grid-layout depends on browser-only globals
 * (window matchMedia, ResizeObserver). The shell loads this module via
 * `next/dynamic` with `ssr:false` so the SSR pass falls back to the
 * stacked masonry; the resizable grid only renders client-side.
 *
 * Performance: RGL fires `onLayoutChange` for every drag tick. We rely
 * on the hook's commit pipeline (which debounces the API PUT), so
 * intermediate states stay client-side until the user stops moving.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { useCallback, useMemo, useRef } from "react";
import type {
  Layout,
  LayoutItem,
  ResponsiveLayouts,
} from "react-grid-layout/legacy";
import { Responsive, WidthProvider } from "react-grid-layout/legacy";

import {
  renderPanel,
  type PanelContext,
} from "@/components/agentic-sdlc/SectionRenderer";
import type { UsePanelPreferencesResult } from "@/hooks/use-panel-preferences";
import {
  GRID_COLS,
  resolveGridLayout,
  resolvePanelLayout,
  type Breakpoint,
  type GridCoord,
} from "@/lib/agentic-sdlc/panel-preferences";
import {
  getPanel,
  type PanelId,
  type PanelSurface,
} from "@/lib/agentic-sdlc/panel-registry";

const ResponsiveGridLayout = WidthProvider(Responsive);

interface ResizableSectionGridProps {
  surface: PanelSurface;
  preferences: UsePanelPreferencesResult["preferences"];
  setGridLayout: UsePanelPreferencesResult["setGridLayout"];
  context: PanelContext;
}

const ROW_HEIGHT = 32;
const MARGIN: [number, number] = [16, 16];
const BREAKPOINTS = { lg: 1280, md: 1024, sm: 768, xs: 0 } as const;

export function ResizableSectionGrid({
  surface,
  preferences,
  setGridLayout,
  context,
}: ResizableSectionGridProps) {
  const visiblePanelIds = useMemo(() => {
    const layout = resolvePanelLayout(preferences);
    const ids: PanelId[] = [];
    for (const section of Object.keys(layout) as (keyof typeof layout)[]) {
      for (const id of layout[section] ?? []) ids.push(id);
    }
    return ids;
  }, [preferences]);

  const layouts: ResponsiveLayouts = useMemo(() => {
    const out: ResponsiveLayouts = {};
    (Object.keys(GRID_COLS) as Breakpoint[]).forEach((bp) => {
      const coords = resolveGridLayout(preferences, bp);
      out[bp] = visiblePanelIds.map((id) => {
        const c: GridCoord = coords[id] ?? { x: 0, y: 0, w: 6, h: 8 };
        const desc = getPanel(id);
        return {
          i: id,
          x: c.x,
          y: c.y,
          w: c.w,
          h: c.h,
          minW: desc.size === "full" ? 6 : 3,
          minH: 4,
          maxW: GRID_COLS[bp],
        };
      });
    });
    return out;
  }, [preferences, visiblePanelIds]);

  // We deliberately do NOT persist on `onLayoutChange` because it also
  // fires on the initial render, which would clobber server-saved
  // coords with defaults the first time the page mounts on a new
  // device. Instead we hold the latest `allLayouts` snapshot in a ref
  // and commit only on `onDragStop` / `onResizeStop`.
  const lastLayoutsRef = useRef<ResponsiveLayouts | null>(null);

  const handleLayoutChange = useCallback(
    (_current: Layout, allLayouts: ResponsiveLayouts) => {
      lastLayoutsRef.current = allLayouts;
    },
    [],
  );

  const commitLatest = useCallback(() => {
    const all = lastLayoutsRef.current;
    if (!all) return;
    (Object.keys(GRID_COLS) as Breakpoint[]).forEach((bp) => {
      const bpLayout = all[bp];
      if (!bpLayout) return;
      const snapshot: Record<PanelId, GridCoord> = {} as Record<
        PanelId,
        GridCoord
      >;
      for (const item of bpLayout as readonly LayoutItem[]) {
        snapshot[item.i as PanelId] = {
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
        };
      }
      setGridLayout(bp, snapshot);
    });
  }, [setGridLayout]);

  return (
    <ResponsiveGridLayout
      className="agentic-sdlc-grid"
      layouts={layouts}
      breakpoints={BREAKPOINTS}
      cols={GRID_COLS}
      rowHeight={ROW_HEIGHT}
      margin={MARGIN}
      containerPadding={[0, 0]}
      // Drag from any panel header. The header includes the
      // Minimize/Show button and the modal-fullscreen button on
      // changelog; those use `button` elements so RGL's 3-px
      // movement threshold prevents drag-on-click. As a belt-and-
      // braces measure we also exclude buttons via `draggableCancel`.
      draggableHandle=".collapsible-panel-header"
      draggableCancel="button, a, input, textarea, select, [data-no-drag]"
      isResizable
      isDraggable
      compactType="vertical"
      preventCollision={false}
      onLayoutChange={handleLayoutChange}
      onDragStop={commitLatest}
      onResizeStop={commitLatest}
      aria-label={`Resizable panel grid for ${surface}`}
    >
      {visiblePanelIds.map((id) => (
        <div
          key={id}
          className="agentic-sdlc-grid-item relative flex h-full min-h-0 flex-col overflow-hidden"
        >
          <div className="h-full min-h-0 overflow-auto">
            {renderPanel(id, context)}
          </div>
        </div>
      ))}
    </ResponsiveGridLayout>
  );
}
