"use client";

/**
 * PanelChooser — the sticky pill bar at the top of a configurable
 * Agentic SDLC surface (Repo Detail or Home).
 *
 * Responsibilities:
 *   1. Render one pill per panel that exists for the surface, grouped
 *      by ship-loop category (specify / execute / verify / deliver /
 *      observe / core). Each pill toggles that panel's visibility.
 *   2. Show counts (N shown / M total).
 *   3. Expose a "Layout" button that opens a drawer where the user can
 *      drag panels to reorder them across sections.
 *   4. Expose Reset and the saved-state indicator.
 *   5. Be keyboard-accessible: `r` to reset, `Esc` to close drawer.
 *
 * The pill bar is sticky under the page header so the user can toggle
 * panels while scrolling and immediately see the effect.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Layout,
  LayoutGrid,
  Plus,
  RotateCcw,
  Save,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  CATEGORY_LABELS,
  CATEGORY_TONE,
  SECTION_LABELS,
  SECTION_ORDER,
  getPanel,
  listPanelsForSurface,
  type PanelCategory,
  type PanelDescriptor,
  type PanelId,
  type PanelSection,
  type PanelSurface,
} from "@/lib/agentic-sdlc/panel-registry";
import {
  isPanelVisible,
  resolvePanelLayout,
  type PanelPreferences,
} from "@/lib/agentic-sdlc/panel-preferences";

interface PanelChooserProps {
  surface: PanelSurface;
  preferences: PanelPreferences;
  isSaving: boolean;
  lastSavedAt: string | null;
  onToggle: (id: PanelId) => void;
  onMove: (id: PanelId, toSection: PanelSection, toIndex: number) => void;
  onReset: () => void;
  onToggleGrid?: (enabled: boolean) => void;
  onResetGrid?: () => void;
}

const CATEGORY_ORDER: PanelCategory[] = [
  "specify",
  "execute",
  "verify",
  "deliver",
  "observe",
  "core",
];

export function PanelChooser({
  surface,
  preferences,
  isSaving,
  lastSavedAt,
  onToggle,
  onMove,
  onReset,
  onToggleGrid,
  onResetGrid,
}: PanelChooserProps) {
  const [expanded, setExpanded] = useState(true);
  const [layoutOpen, setLayoutOpen] = useState(false);

  const surfacePanels = useMemo(
    () => listPanelsForSurface(surface),
    [surface],
  );

  const visibleCount = surfacePanels.filter((p) =>
    isPanelVisible(p, preferences),
  ).length;

  const byCategory = useMemo(() => {
    const map = new Map<PanelCategory, PanelDescriptor[]>();
    for (const panel of surfacePanels) {
      const list = map.get(panel.category) ?? [];
      list.push(panel);
      map.set(panel.category, list);
    }
    return map;
  }, [surfacePanels]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.target instanceof HTMLInputElement) return;
      if (ev.target instanceof HTMLTextAreaElement) return;
      if (ev.key === "r" && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        onReset();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onReset]);

  return (
    <div
      className="sticky top-2 z-30 rounded-2xl border border-border/40 bg-card/80 px-3 py-2 backdrop-blur"
      aria-label="Panel chooser"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronUp className="h-3 w-3" aria-hidden />
          ) : (
            <ChevronDown className="h-3 w-3" aria-hidden />
          )}
          <span>{visibleCount} of {surfacePanels.length} panels</span>
        </button>
        <div className="flex items-center gap-2 text-[11px]">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition ${
              isSaving
                ? "border-amber-400/40 bg-amber-500/10 text-amber-200"
                : lastSavedAt
                  ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                  : "border-border/40 bg-background/40 text-muted-foreground"
            }`}
            aria-live="polite"
          >
            <Save className="h-3 w-3" aria-hidden />
            {isSaving ? "Saving…" : lastSavedAt ? "Saved" : "Not synced yet"}
          </span>
          {onToggleGrid && (
            <button
              type="button"
              onClick={() => onToggleGrid(!preferences.gridEnabled)}
              aria-pressed={preferences.gridEnabled}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium transition ${
                preferences.gridEnabled
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border/40 bg-background/50 text-muted-foreground hover:bg-background hover:text-foreground"
              }`}
              title={
                preferences.gridEnabled
                  ? "Disable grid (return to stacked layout)"
                  : "Enable resizable grid layout"
              }
            >
              <LayoutGrid className="h-3 w-3" aria-hidden />
              {preferences.gridEnabled ? "Grid on" : "Grid off"}
            </button>
          )}
          {onToggleGrid && preferences.gridEnabled && onResetGrid && (
            <button
              type="button"
              onClick={onResetGrid}
              className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-background/50 px-2 py-0.5 font-medium text-muted-foreground transition hover:bg-background hover:text-foreground"
              title="Reset grid coords to defaults"
            >
              <RotateCcw className="h-3 w-3" aria-hidden /> Reset grid
            </button>
          )}
          <button
            type="button"
            onClick={() => setLayoutOpen(true)}
            className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-background/50 px-2 py-0.5 font-medium text-muted-foreground transition hover:bg-background hover:text-foreground"
          >
            <Layout className="h-3 w-3" aria-hidden /> Layout
          </button>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-background/50 px-2 py-0.5 font-medium text-muted-foreground transition hover:bg-background hover:text-foreground"
            title="Reset to defaults (press r)"
          >
            <RotateCcw className="h-3 w-3" aria-hidden /> Reset
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 grid gap-2">
          {CATEGORY_ORDER.map((category) => {
            const list = byCategory.get(category);
            if (!list?.length) return null;
            const tone = CATEGORY_TONE[category];
            return (
              <div key={category} className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider ${tone.section}`}
                >
                  {CATEGORY_LABELS[category]}
                </span>
                {list.map((panel) => {
                  const visible = isPanelVisible(panel, preferences);
                  const dataTag =
                    panel.data === "mock"
                      ? "demo"
                      : panel.data === "hybrid"
                        ? "live+demo"
                        : null;
                  return (
                    <button
                      key={panel.id}
                      type="button"
                      onClick={() => onToggle(panel.id)}
                      aria-pressed={visible}
                      className={`group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                        visible ? tone.pillActive : tone.pill
                      }`}
                      title={panel.description}
                    >
                      {visible ? (
                        <Check className="h-2.5 w-2.5" aria-hidden />
                      ) : (
                        <Plus className="h-2.5 w-2.5" aria-hidden />
                      )}
                      <span>{panel.title}</span>
                      {dataTag && (
                        <span className="rounded-sm bg-background/40 px-1 text-[8px] uppercase tracking-wide text-muted-foreground/80">
                          {dataTag}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {layoutOpen && (
        <LayoutDrawer
          surface={surface}
          preferences={preferences}
          onClose={() => setLayoutOpen(false)}
          onMove={onMove}
          onToggle={onToggle}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout drawer — drag a panel into a different section / index             */
/* -------------------------------------------------------------------------- */

interface LayoutDrawerProps {
  surface: PanelSurface;
  preferences: PanelPreferences;
  onClose: () => void;
  onMove: (id: PanelId, toSection: PanelSection, toIndex: number) => void;
  onToggle: (id: PanelId) => void;
}

function LayoutDrawer({
  surface,
  preferences,
  onClose,
  onMove,
  onToggle,
}: LayoutDrawerProps) {
  const layout = useMemo(() => resolvePanelLayout(preferences), [preferences]);
  const draggingRef = useRef<PanelId | null>(null);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label="Reorder panels"
      className="fixed inset-0 z-40 flex items-end justify-center bg-background/40 p-4 backdrop-blur-sm md:items-center"
      onClick={onClose}
    >
      <div
        // Flex column with a clipped header and a scrolling body.
        // `min-h-0` on the body is what lets overflow-auto kick in when
        // the panel list is taller than the available card height. The
        // card itself caps at 90vh so as the list grows it never pushes
        // the bottom rows past the viewport.
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border/40 bg-card/95 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 px-4 py-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              Layout · {surface === "repo_detail" ? "Repo detail" : "Home"}
            </p>
            <h2 className="text-base font-semibold">Reorder panels</h2>
            <p className="text-[11px] text-muted-foreground">
              Drag any pill to move it across sections or within a section.
              Tip: flip <span className="rounded bg-background/60 px-1 font-mono">Grid on</span> in the chooser bar to drag and resize panels live on the page. Press Esc to close.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border/40 bg-background/40 px-2 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
          >
            Done
          </button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-4 md:grid-cols-2">
          {SECTION_ORDER.map((section) => {
            const ids = layout[section] ?? [];
            return (
              <div
                key={section}
                className="rounded-xl border border-border/40 bg-background/30 p-2"
                onDragOver={(e) => {
                  if (draggingRef.current) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = draggingRef.current;
                  if (!id) return;
                  onMove(id, section, ids.length);
                  draggingRef.current = null;
                }}
              >
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {SECTION_LABELS[section]}{" "}
                  <span className="text-muted-foreground/60">({ids.length})</span>
                </p>
                <ul className="space-y-1">
                  {ids.length === 0 && (
                    <li className="rounded-md border border-dashed border-border/40 px-2 py-2 text-[11px] text-muted-foreground/70">
                      Drop a panel here…
                    </li>
                  )}
                  {ids.map((id, idx) => {
                    const panel = getPanel(id);
                    const tone = CATEGORY_TONE[panel.category];
                    return (
                      <li
                        key={id}
                        draggable
                        onDragStart={() => {
                          draggingRef.current = id;
                        }}
                        onDragEnd={() => {
                          draggingRef.current = null;
                        }}
                        onDragOver={(e) => {
                          if (draggingRef.current) {
                            e.preventDefault();
                            e.stopPropagation();
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const fromId = draggingRef.current;
                          if (!fromId) return;
                          onMove(fromId, section, idx);
                          draggingRef.current = null;
                        }}
                        className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-[11px] ${tone.pill}`}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <GripVertical className="h-3 w-3 shrink-0" aria-hidden />
                          <span className="truncate">{panel.title}</span>
                          <span className="rounded-sm bg-background/40 px-1 text-[8px] uppercase tracking-wide text-muted-foreground/80">
                            {panel.size}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => onToggle(id)}
                          className="rounded-sm border border-border/40 bg-background/40 px-1 text-[10px] text-muted-foreground hover:text-foreground"
                          aria-label={`Hide ${panel.title}`}
                        >
                          hide
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
