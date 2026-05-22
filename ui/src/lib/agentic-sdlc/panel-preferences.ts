/**
 * Panel preferences — pure data layer.
 *
 * `PanelPreferences` is the user's per-surface preference set: which
 * panels are hidden, optional per-section reordering, and the density
 * mode. The structure deliberately stores only diffs from the
 * registry defaults so future changes to defaults take effect without
 * needing a migration.
 *
 * Resolution is performed by `resolvePanelLayout`, which combines the
 * registry defaults with the saved preferences to produce a
 * deterministic, ordered list of visible panels per section. This is
 * the single function the UI calls; everything else is plumbing.
 *
 * Pure (no React, no fetch). Safe to import from server and client.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  PANEL_REGISTRY,
  SECTION_ORDER,
  getPanel,
  listPanelsForSurface,
  type PanelDescriptor,
  type PanelId,
  type PanelSection,
  type PanelSurface,
} from "@/lib/agentic-sdlc/panel-registry";

export const PANEL_PREFERENCES_VERSION = 2;

/** Coordinates for a single panel inside the resizable grid. */
export interface GridCoord {
  /** Column 0..11 on the lg/md breakpoint, 0..5 on sm, 0..1 on xs. */
  x: number;
  /** Row (top is 0). */
  y: number;
  /** Width in column units. */
  w: number;
  /** Height in row units (1 row ≈ 32px + margin). */
  h: number;
}

/** Per-breakpoint coords map. Keys are RGL breakpoint names. */
export type GridLayoutByBreakpoint = Partial<{
  lg: Record<PanelId, GridCoord>;
  md: Record<PanelId, GridCoord>;
  sm: Record<PanelId, GridCoord>;
  xs: Record<PanelId, GridCoord>;
}>;

export interface PanelPreferences {
  version: number;
  surface: PanelSurface;
  /** Panels the user has explicitly hidden, including those visible by default. */
  hidden: PanelId[];
  /** Panels the user has explicitly shown that default to hidden. */
  shown: PanelId[];
  /**
   * Per-section ordered list. When a panel id appears here it overrides
   * the default order for that section; panels not listed fall back to
   * the registry's `defaults[surface].order`.
   *
   * The drag-to-reorder UX may move a panel from one section to another;
   * in that case the panel id is removed from its registered section's
   * list (if present) and added to the new section's list.
   */
  order: Partial<Record<PanelSection, PanelId[]>>;
  /**
   * Section override per panel — when the user dragged a panel out of
   * its registered section into a different one. Sparse, only set for
   * moved panels. Resolution falls back to the registry section if a
   * panel id is missing.
   */
  section: Partial<Record<PanelId, PanelSection>>;
  density: "compact" | "comfortable";
  /**
   * When true, the surface renders using the resizable + draggable grid
   * (react-grid-layout). When false (default), it uses the section
   * masonry. The toggle lives in the panel chooser so users can opt in
   * without losing the stacked layout.
   */
  gridEnabled: boolean;
  /**
   * Per-breakpoint panel coordinates. Only set for panels the user has
   * dragged/resized; missing ids fall back to defaults computed from
   * the registry at render time.
   */
  grid: GridLayoutByBreakpoint;
  updated_at: string;
}

export function defaultPreferences(surface: PanelSurface): PanelPreferences {
  return {
    version: PANEL_PREFERENCES_VERSION,
    surface,
    hidden: [],
    shown: [],
    order: {},
    section: {},
    density: "comfortable",
    gridEnabled: false,
    grid: {},
    updated_at: new Date(0).toISOString(),
  };
}

/**
 * Normalise an arbitrary value into a PanelPreferences. Used by both
 * the localStorage and API loaders so a corrupt payload never crashes
 * the UI — it simply degrades to defaults.
 */
export function normalisePreferences(
  raw: unknown,
  surface: PanelSurface,
): PanelPreferences {
  if (!raw || typeof raw !== "object") return defaultPreferences(surface);
  const obj = raw as Partial<PanelPreferences> & { [k: string]: unknown };
  const validPanelIds = new Set<PanelId>(PANEL_REGISTRY.map((p) => p.id));
  const validSections = new Set<PanelSection>(SECTION_ORDER);

  const hidden = Array.isArray(obj.hidden)
    ? (obj.hidden.filter(
        (id) => typeof id === "string" && validPanelIds.has(id as PanelId),
      ) as PanelId[])
    : [];
  const shown = Array.isArray(obj.shown)
    ? (obj.shown.filter(
        (id) => typeof id === "string" && validPanelIds.has(id as PanelId),
      ) as PanelId[])
    : [];

  const order: Partial<Record<PanelSection, PanelId[]>> = {};
  if (obj.order && typeof obj.order === "object") {
    for (const [section, ids] of Object.entries(
      obj.order as Record<string, unknown>,
    )) {
      if (!validSections.has(section as PanelSection)) continue;
      if (!Array.isArray(ids)) continue;
      const filtered = ids.filter(
        (id) => typeof id === "string" && validPanelIds.has(id as PanelId),
      ) as PanelId[];
      if (filtered.length > 0) order[section as PanelSection] = filtered;
    }
  }

  const section: Partial<Record<PanelId, PanelSection>> = {};
  if (obj.section && typeof obj.section === "object") {
    for (const [panelId, sec] of Object.entries(
      obj.section as Record<string, unknown>,
    )) {
      if (
        validPanelIds.has(panelId as PanelId) &&
        typeof sec === "string" &&
        validSections.has(sec as PanelSection)
      ) {
        section[panelId as PanelId] = sec as PanelSection;
      }
    }
  }

  const density =
    obj.density === "compact" || obj.density === "comfortable"
      ? obj.density
      : "comfortable";

  const gridEnabled = obj.gridEnabled === true;

  const grid: GridLayoutByBreakpoint = {};
  if (obj.grid && typeof obj.grid === "object") {
    const allowed = ["lg", "md", "sm", "xs"] as const;
    for (const bp of allowed) {
      const raw = (obj.grid as Record<string, unknown>)[bp];
      if (!raw || typeof raw !== "object") continue;
      const bucket: Record<PanelId, GridCoord> = {} as Record<PanelId, GridCoord>;
      for (const [panelId, coordRaw] of Object.entries(
        raw as Record<string, unknown>,
      )) {
        if (!validPanelIds.has(panelId as PanelId)) continue;
        if (!coordRaw || typeof coordRaw !== "object") continue;
        const c = coordRaw as Partial<GridCoord>;
        if (
          typeof c.x === "number" &&
          typeof c.y === "number" &&
          typeof c.w === "number" &&
          typeof c.h === "number" &&
          c.w > 0 &&
          c.h > 0
        ) {
          bucket[panelId as PanelId] = {
            x: Math.max(0, Math.floor(c.x)),
            y: Math.max(0, Math.floor(c.y)),
            w: Math.max(1, Math.floor(c.w)),
            h: Math.max(1, Math.floor(c.h)),
          };
        }
      }
      if (Object.keys(bucket).length > 0) grid[bp] = bucket;
    }
  }

  return {
    version: PANEL_PREFERENCES_VERSION,
    surface,
    hidden,
    shown,
    order,
    section,
    density,
    gridEnabled,
    grid,
    updated_at:
      typeof obj.updated_at === "string"
        ? obj.updated_at
        : new Date(0).toISOString(),
  };
}

/**
 * Determine whether a panel should be rendered for this surface given
 * the user's preferences. Hidden wins over shown so the user can
 * always opt out of a default-visible panel.
 */
export function isPanelVisible(
  panel: PanelDescriptor,
  preferences: PanelPreferences,
): boolean {
  if (preferences.hidden.includes(panel.id)) return false;
  const defaultVisible =
    panel.defaults[preferences.surface]?.visible ?? false;
  if (defaultVisible) return true;
  return preferences.shown.includes(panel.id);
}

/**
 * Effective section for a panel — either the user override or the
 * registry section.
 */
export function effectiveSection(
  panel: PanelDescriptor,
  preferences: PanelPreferences,
): PanelSection {
  return preferences.section[panel.id] ?? panel.section;
}

/**
 * Compose the section ordering. Result is a map from section to the
 * ordered list of visible panel ids.
 *
 * Algorithm:
 *   1. Build a set of all panels on this surface that are visible.
 *   2. Bucket them by effective section.
 *   3. For each section, order panels by:
 *      a. position in `preferences.order[section]` (if listed)
 *      b. otherwise default order from the registry for this surface.
 *      c. tie-break by panel id alphabetical for stability.
 */
export function resolvePanelLayout(
  preferences: PanelPreferences,
): Record<PanelSection, PanelId[]> {
  const buckets: Partial<Record<PanelSection, PanelId[]>> = {};
  for (const panel of listPanelsForSurface(preferences.surface)) {
    if (!isPanelVisible(panel, preferences)) continue;
    const section = effectiveSection(panel, preferences);
    const list = buckets[section] ?? [];
    list.push(panel.id);
    buckets[section] = list;
  }

  const out = {} as Record<PanelSection, PanelId[]>;
  for (const section of SECTION_ORDER) {
    const ids = buckets[section] ?? [];
    const explicit = preferences.order[section] ?? [];
    const orderedHead: PanelId[] = [];
    const seen = new Set<PanelId>();
    for (const id of explicit) {
      if (ids.includes(id)) {
        orderedHead.push(id);
        seen.add(id);
      }
    }
    const tail = ids
      .filter((id) => !seen.has(id))
      .sort((a, b) => {
        const da = getPanel(a).defaults[preferences.surface]?.order ?? 999;
        const db = getPanel(b).defaults[preferences.surface]?.order ?? 999;
        if (da !== db) return da - db;
        return a.localeCompare(b);
      });
    out[section] = [...orderedHead, ...tail];
  }
  return out;
}

/**
 * Toggle visibility, returning a new preferences object.
 *
 * Reasoning notes:
 *   - We never store both `hidden` and `shown` for the same panel.
 *   - For a default-visible panel: toggling off adds to `hidden`;
 *     toggling on removes from `hidden`.
 *   - For a default-hidden panel: toggling on adds to `shown`;
 *     toggling off removes from `shown`.
 */
export function togglePanelVisibility(
  preferences: PanelPreferences,
  panelId: PanelId,
): PanelPreferences {
  const panel = getPanel(panelId);
  const defaultVisible =
    panel.defaults[preferences.surface]?.visible ?? false;
  const currentlyVisible = isPanelVisible(panel, preferences);
  const nextVisible = !currentlyVisible;

  let hidden = preferences.hidden;
  let shown = preferences.shown;

  if (defaultVisible) {
    hidden = nextVisible
      ? hidden.filter((id) => id !== panelId)
      : Array.from(new Set([...hidden, panelId]));
    shown = shown.filter((id) => id !== panelId);
  } else {
    shown = nextVisible
      ? Array.from(new Set([...shown, panelId]))
      : shown.filter((id) => id !== panelId);
    hidden = hidden.filter((id) => id !== panelId);
  }
  return {
    ...preferences,
    hidden,
    shown,
    updated_at: new Date().toISOString(),
  };
}

/** Reset to registry defaults for the surface. */
export function resetPreferences(surface: PanelSurface): PanelPreferences {
  return {
    ...defaultPreferences(surface),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Move a panel to a new section + index. Used by the layout drawer's
 * free-reorder drag handler.
 */
export function movePanel(
  preferences: PanelPreferences,
  panelId: PanelId,
  toSection: PanelSection,
  toIndex: number,
): PanelPreferences {
  const panel = getPanel(panelId);
  if (!panel) return preferences;

  // Remove panel from any section's explicit order.
  const cleanedOrder: Partial<Record<PanelSection, PanelId[]>> = {};
  for (const [section, ids] of Object.entries(preferences.order)) {
    if (!ids) continue;
    cleanedOrder[section as PanelSection] = ids.filter((id) => id !== panelId);
  }

  // Rebuild the destination section with the panel inserted.
  const currentLayout = resolvePanelLayout(preferences);
  const destination = (currentLayout[toSection] ?? []).filter(
    (id) => id !== panelId,
  );
  const clampedIndex = Math.max(0, Math.min(toIndex, destination.length));
  destination.splice(clampedIndex, 0, panelId);
  cleanedOrder[toSection] = destination;

  // If the panel moved out of its registered section, persist that
  // override; otherwise clear it so the registry default re-applies.
  const sectionOverride = { ...preferences.section };
  if (toSection !== panel.section) {
    sectionOverride[panelId] = toSection;
  } else {
    delete sectionOverride[panelId];
  }

  // Ensure the panel is visible after a move (otherwise the user just
  // dragged something invisible — confusing UX).
  const next = {
    ...preferences,
    order: cleanedOrder,
    section: sectionOverride,
    updated_at: new Date().toISOString(),
  };
  return ensureVisible(next, panelId);
}

function ensureVisible(
  preferences: PanelPreferences,
  panelId: PanelId,
): PanelPreferences {
  const panel = getPanel(panelId);
  const defaultVisible =
    panel.defaults[preferences.surface]?.visible ?? false;
  let hidden = preferences.hidden;
  let shown = preferences.shown;
  if (defaultVisible) {
    hidden = hidden.filter((id) => id !== panelId);
  } else if (!shown.includes(panelId)) {
    shown = [...shown, panelId];
  }
  return { ...preferences, hidden, shown };
}

/* -------------------------------------------------------------------------- */
/* Resizable grid helpers                                                     */
/* -------------------------------------------------------------------------- */

export type Breakpoint = "lg" | "md" | "sm" | "xs";

/** Column counts per breakpoint (must match the renderer). */
export const GRID_COLS: Record<Breakpoint, number> = {
  lg: 12,
  md: 12,
  sm: 6,
  xs: 2,
};

/**
 * Compute a deterministic default grid layout for a breakpoint by
 * walking the resolved section layout in display order.
 *
 * Design choice: each panel gets a full row by default. This makes
 * flipping the grid toggle on/off non-disruptive — the user sees the
 * same stacked layout they had in masonry mode and can then drag and
 * resize from there. Previously the default packed two half-size
 * panels per row which "reset" the user's view on first Grid-on.
 *
 * Heights are tuned per panel size:
 *   - full panels: 6 rows (~ 240px content area)
 *   - half panels: 10 rows (~ 400px content area; lists/charts need more)
 */
export function computeDefaultGridLayout(
  preferences: PanelPreferences,
  breakpoint: Breakpoint,
): Record<PanelId, GridCoord> {
  const resolved = resolvePanelLayout(preferences);
  const cols = GRID_COLS[breakpoint];
  const out: Record<PanelId, GridCoord> = {} as Record<PanelId, GridCoord>;

  const flatIds: PanelId[] = [];
  for (const section of SECTION_ORDER) {
    for (const id of resolved[section] ?? []) flatIds.push(id);
  }

  let cursorY = 0;
  for (const id of flatIds) {
    const desc = getPanel(id);
    const h = desc.size === "full" ? 6 : 10;
    out[id] = { x: 0, y: cursorY, w: cols, h };
    cursorY += h;
  }
  return out;
}

/**
 * Compose the effective grid layout for a breakpoint by overlaying the
 * user's saved coords on top of defaults computed from the registry.
 * Panels that became visible/were added after the user last saved a
 * layout get computed defaults so they show up cleanly.
 */
export function resolveGridLayout(
  preferences: PanelPreferences,
  breakpoint: Breakpoint,
): Record<PanelId, GridCoord> {
  const defaults = computeDefaultGridLayout(preferences, breakpoint);
  const saved = preferences.grid[breakpoint] ?? {};
  const merged: Record<PanelId, GridCoord> = { ...defaults };
  for (const [id, coord] of Object.entries(saved) as [PanelId, GridCoord][]) {
    if (defaults[id]) merged[id] = coord; // only honour coords for currently-visible panels
  }
  return merged;
}

export function setGridEnabled(
  preferences: PanelPreferences,
  enabled: boolean,
): PanelPreferences {
  if (preferences.gridEnabled === enabled) return preferences;
  return {
    ...preferences,
    gridEnabled: enabled,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Replace the user's saved grid layout for a single breakpoint. The
 * caller passes the full layout for that breakpoint as produced by RGL
 * (already filtered to currently-visible panels).
 */
export function setGridLayout(
  preferences: PanelPreferences,
  breakpoint: Breakpoint,
  layout: Record<PanelId, GridCoord>,
): PanelPreferences {
  return {
    ...preferences,
    grid: { ...preferences.grid, [breakpoint]: layout },
    updated_at: new Date().toISOString(),
  };
}

/** Clear all saved grid coords (per-breakpoint). */
export function clearGridLayout(preferences: PanelPreferences): PanelPreferences {
  return {
    ...preferences,
    grid: {},
    updated_at: new Date().toISOString(),
  };
}
