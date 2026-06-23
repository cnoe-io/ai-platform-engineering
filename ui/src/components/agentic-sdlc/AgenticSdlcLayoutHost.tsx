"use client";

/**
 * AgenticSdlcLayoutHost — chooses between the section masonry and the
 * resizable grid based on user preferences, and isolates the heavy
 * react-grid-layout bundle behind a dynamic import.
 *
 * The grid renderer touches browser globals (ResizeObserver,
 * matchMedia) so it must not run during SSR. While that bundle loads,
 * we fall back to the existing SectionRenderer-driven layout so the
 * page is never blank.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import dynamic from "next/dynamic";
import { useMemo } from "react";

import {
  renderPanel,
  type PanelContext,
} from "@/components/agentic-sdlc/SectionRenderer";
import type { UsePanelPreferencesResult } from "@/hooks/use-panel-preferences";
import { resolvePanelLayout } from "@/lib/agentic-sdlc/panel-preferences";
import {
  getPanel,
  SECTION_ORDER,
  type PanelId,
  type PanelSurface,
} from "@/lib/agentic-sdlc/panel-registry";

const ResizableSectionGrid = dynamic(
  () =>
    import("@/components/agentic-sdlc/ResizableSectionGrid").then(
      (m) => m.ResizableSectionGrid,
    ),
  { ssr: false, loading: () => null },
);

interface AgenticSdlcLayoutHostProps {
  surface: PanelSurface;
  prefs: UsePanelPreferencesResult;
  context: PanelContext;
  /**
   * Sections that should be rendered by the masonry only (the grid
   * doesn't draw them at all). Used for the repo detail page where the
   * hero ring is rendered as a header overlay rather than as a panel.
   */
  excludePanelIds?: ReadonlyArray<string>;
}

export function AgenticSdlcLayoutHost({
  surface,
  prefs,
  context,
  excludePanelIds,
}: AgenticSdlcLayoutHostProps) {
  const { preferences, setGridLayout } = prefs;
  const layout = useMemo(() => resolvePanelLayout(preferences), [preferences]);

  if (preferences.gridEnabled) {
    return (
      <ResizableSectionGrid
        surface={surface}
        preferences={preferences}
        setGridLayout={setGridLayout}
        context={context}
      />
    );
  }

  // Masonry mode: flatten every visible panel across sections so a
  // run of half-size panels can tile across CSS columns even when they
  // originate from different sections. This eliminates the empty bands
  // that previously appeared between sections of differing height.
  const flatPanelIds: PanelId[] = [];
  for (const section of SECTION_ORDER) {
    for (const id of layout[section] ?? []) {
      if (excludePanelIds?.includes(id)) continue;
      flatPanelIds.push(id);
    }
  }

  // Split into runs: contiguous half-size panels share a CSS-columns
  // block (so they pack with no vertical gaps), and each full-size
  // panel renders as its own full-width row.
  const runs: Array<
    | { kind: "full"; id: PanelId }
    | { kind: "half"; ids: PanelId[] }
  > = [];
  let buffer: PanelId[] = [];
  const flushHalves = () => {
    if (buffer.length > 0) {
      runs.push({ kind: "half", ids: buffer });
      buffer = [];
    }
  };
  for (const id of flatPanelIds) {
    if (getPanel(id).size === "full") {
      flushHalves();
      runs.push({ kind: "full", id });
    } else {
      buffer.push(id);
    }
  }
  flushHalves();

  return (
    <div className="flex flex-col gap-4" aria-label="Agentic SDLC panels">
      {runs.map((run, idx) =>
        run.kind === "full" ? (
          <div key={`full-${run.id}-${idx}`} className="min-w-0">
            {renderPanel(run.id, context)}
          </div>
        ) : (
          <div
            key={`half-${idx}`}
            className="xl:columns-2 xl:[column-gap:1rem]"
          >
            {run.ids.map((id) => (
              <div key={id} className="mb-4 break-inside-avoid">
                {renderPanel(id, context)}
              </div>
            ))}
          </div>
        ),
      )}
    </div>
  );
}
