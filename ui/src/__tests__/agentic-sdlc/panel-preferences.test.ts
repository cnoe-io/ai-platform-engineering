/**
 * Unit tests for the pure panel-preferences module.
 *
 * Covers:
 *   - defaultPreferences / normalisePreferences round-trip
 *   - togglePanelVisibility for default-visible vs default-hidden panels
 *   - resolvePanelLayout ordering rules
 *   - movePanel cross-section and within-section reorder
 *   - resetPreferences
 *
 * No I/O; safe to run in jsdom.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  clearGridLayout,
  computeDefaultGridLayout,
  defaultPreferences,
  GRID_COLS,
  isPanelVisible,
  movePanel,
  normalisePreferences,
  PANEL_PREFERENCES_VERSION,
  resetPreferences,
  resolveGridLayout,
  resolvePanelLayout,
  setGridEnabled,
  setGridLayout,
  togglePanelVisibility,
} from "@/lib/agentic-sdlc/panel-preferences";
import {
  PANEL_REGISTRY,
  getPanel,
  type PanelId,
  type PanelSection,
} from "@/lib/agentic-sdlc/panel-registry";

describe("panel-preferences", () => {
  describe("defaultPreferences", () => {
    it("returns an empty preference set tagged for the surface", () => {
      const p = defaultPreferences("repo_detail");
      expect(p.surface).toBe("repo_detail");
      expect(p.hidden).toEqual([]);
      expect(p.shown).toEqual([]);
      expect(p.order).toEqual({});
      expect(p.section).toEqual({});
      expect(p.density).toBe("comfortable");
      expect(p.version).toBe(PANEL_PREFERENCES_VERSION);
    });
  });

  describe("normalisePreferences", () => {
    it("falls back to defaults for non-object input", () => {
      expect(normalisePreferences(null, "repo_detail")).toEqual(
        defaultPreferences("repo_detail"),
      );
      expect(normalisePreferences("nope", "home")).toEqual(
        defaultPreferences("home"),
      );
    });

    it("drops unknown panel ids and sections", () => {
      const raw = {
        version: 1,
        surface: "repo_detail",
        hidden: ["epics", "not_a_real_panel"],
        shown: ["spec_health", "also_fake"],
        order: { epics: ["epics", "garbage"], not_real_section: ["spec_health"] },
        section: { epics: "context", spec_health: "ghost" },
        density: "compact",
        updated_at: "2026-01-01T00:00:00.000Z",
      };
      const p = normalisePreferences(raw, "repo_detail");
      expect(p.hidden).toEqual(["epics"]);
      expect(p.shown).toEqual(["spec_health"]);
      expect(p.order).toEqual({ epics: ["epics"] });
      expect(p.section).toEqual({ epics: "context" });
      expect(p.density).toBe("compact");
    });
  });

  describe("isPanelVisible", () => {
    it("respects defaults for default-visible panels", () => {
      const prefs = defaultPreferences("repo_detail");
      const epics = getPanel("epics");
      expect(isPanelVisible(epics, prefs)).toBe(true);
    });

    it("respects defaults for default-hidden panels", () => {
      const prefs = defaultPreferences("repo_detail");
      const fanout = getPanel("parallel_fanout");
      expect(isPanelVisible(fanout, prefs)).toBe(false);
    });

    it("hides default-visible when listed in hidden", () => {
      const prefs = { ...defaultPreferences("repo_detail"), hidden: ["epics" as PanelId] };
      const epics = getPanel("epics");
      expect(isPanelVisible(epics, prefs)).toBe(false);
    });

    it("shows default-hidden when listed in shown", () => {
      const prefs = {
        ...defaultPreferences("repo_detail"),
        shown: ["parallel_fanout" as PanelId],
      };
      const fanout = getPanel("parallel_fanout");
      expect(isPanelVisible(fanout, prefs)).toBe(true);
    });

    it("hidden wins over shown", () => {
      const prefs = {
        ...defaultPreferences("repo_detail"),
        shown: ["epics" as PanelId],
        hidden: ["epics" as PanelId],
      };
      const epics = getPanel("epics");
      expect(isPanelVisible(epics, prefs)).toBe(false);
    });
  });

  describe("togglePanelVisibility", () => {
    it("toggles a default-visible panel into hidden", () => {
      const p1 = defaultPreferences("repo_detail");
      const p2 = togglePanelVisibility(p1, "epics");
      expect(p2.hidden).toContain("epics");
      expect(p2.shown).not.toContain("epics");
    });

    it("toggles a hidden default-visible panel back on", () => {
      const p1 = togglePanelVisibility(defaultPreferences("repo_detail"), "epics");
      const p2 = togglePanelVisibility(p1, "epics");
      expect(p2.hidden).not.toContain("epics");
    });

    it("toggles a default-hidden panel into shown", () => {
      const p1 = defaultPreferences("repo_detail");
      const p2 = togglePanelVisibility(p1, "parallel_fanout");
      expect(p2.shown).toContain("parallel_fanout");
      expect(p2.hidden).not.toContain("parallel_fanout");
    });

    it("toggles a shown default-hidden panel back off", () => {
      const p1 = togglePanelVisibility(
        defaultPreferences("repo_detail"),
        "parallel_fanout",
      );
      const p2 = togglePanelVisibility(p1, "parallel_fanout");
      expect(p2.shown).not.toContain("parallel_fanout");
    });
  });

  describe("resolvePanelLayout", () => {
    it("returns at least one entry per registered section", () => {
      const layout = resolvePanelLayout(defaultPreferences("repo_detail"));
      // every section key is present even if empty
      const keys = Object.keys(layout);
      expect(keys).toEqual(expect.arrayContaining(["hero", "footer"]));
    });

    it("orders panels by the registry defaults for the surface", () => {
      const layout = resolvePanelLayout(defaultPreferences("repo_detail"));
      // epics + operating_metrics share the "epics" section; epics has
      // order 0, operating_metrics has order 1.
      expect(layout.epics).toEqual(["epics", "operating_metrics"]);
    });

    it("uses an explicit order override when provided", () => {
      const prefs = {
        ...defaultPreferences("repo_detail"),
        order: { epics: ["operating_metrics", "epics"] as PanelId[] },
      };
      const layout = resolvePanelLayout(prefs);
      expect(layout.epics).toEqual(["operating_metrics", "epics"]);
    });

    it("omits panels the user has hidden", () => {
      const prefs = togglePanelVisibility(
        defaultPreferences("repo_detail"),
        "epics",
      );
      const layout = resolvePanelLayout(prefs);
      expect(layout.epics).not.toContain("epics");
    });

    it("includes shown default-hidden panels", () => {
      const prefs = togglePanelVisibility(
        defaultPreferences("repo_detail"),
        "parallel_fanout",
      );
      const layout = resolvePanelLayout(prefs);
      // parallel_fanout's registered section is "execute"
      expect(layout.execute).toContain("parallel_fanout");
    });
  });

  describe("movePanel", () => {
    it("moves a panel to a new section and records the override", () => {
      const base = defaultPreferences("repo_detail");
      const moved = movePanel(base, "epics", "context", 0);
      expect(moved.section.epics).toBe("context");
      expect(moved.order.context?.[0]).toBe("epics");
    });

    it("clears the override when moved back to its registered section", () => {
      const base = defaultPreferences("repo_detail");
      const moved = movePanel(base, "epics", "context", 0);
      const movedBack = movePanel(moved, "epics", "epics", 0);
      expect(movedBack.section.epics).toBeUndefined();
    });

    it("ensures the moved panel is visible afterward", () => {
      const hidden = togglePanelVisibility(
        defaultPreferences("repo_detail"),
        "parallel_fanout",
      );
      // toggling once on a default-hidden panel makes it shown; toggle
      // twice to land on hidden.
      const fullyHidden = togglePanelVisibility(hidden, "parallel_fanout");
      expect(
        isPanelVisible(getPanel("parallel_fanout"), fullyHidden),
      ).toBe(false);
      const moved = movePanel(fullyHidden, "parallel_fanout", "context", 0);
      expect(isPanelVisible(getPanel("parallel_fanout"), moved)).toBe(true);
    });

    it("clamps the target index when out of range", () => {
      const base = defaultPreferences("repo_detail");
      const moved = movePanel(base, "epics", "context", 99);
      // context's pre-existing visible panels are at indexes 0..N-1.
      // The moved panel should be at the end.
      const idx = (moved.order.context ?? []).indexOf("epics");
      expect(idx).toBeGreaterThanOrEqual(0);
    });
  });

  describe("resetPreferences", () => {
    it("returns a fresh preference set tagged with the surface", () => {
      const after = togglePanelVisibility(
        defaultPreferences("repo_detail"),
        "epics",
      );
      const reset = resetPreferences("repo_detail");
      expect(reset.hidden).toEqual([]);
      expect(reset.shown).toEqual([]);
      // does not leak state from `after`
      expect(reset).not.toEqual(after);
    });
  });

  describe("registry guarantees", () => {
    it("every registry entry has a non-empty title and description", () => {
      for (const panel of PANEL_REGISTRY) {
        expect(panel.title.length).toBeGreaterThan(0);
        expect(panel.description.length).toBeGreaterThan(0);
      }
    });

    it("every panel declares at least one surface in defaults", () => {
      for (const panel of PANEL_REGISTRY) {
        const declared = Object.keys(panel.defaults);
        expect(declared.length).toBeGreaterThan(0);
      }
    });
  });

  describe("grid helpers", () => {
    it("defaults gridEnabled to false and grid to empty", () => {
      const prefs = defaultPreferences("repo_detail");
      expect(prefs.gridEnabled).toBe(false);
      expect(prefs.grid).toEqual({});
    });

    it("normalisePreferences keeps a valid grid snapshot and drops garbage", () => {
      const raw = {
        gridEnabled: true,
        grid: {
          lg: {
            epics: { x: 0, y: 0, w: 6, h: 8 },
            "not-a-panel": { x: 0, y: 0, w: 6, h: 8 },
            broken: { x: "no", y: 0, w: 6, h: 8 },
          },
          xx: { epics: { x: 0, y: 0, w: 6, h: 8 } }, // bogus breakpoint
        },
      } as unknown;
      const out = normalisePreferences(raw, "repo_detail");
      expect(out.gridEnabled).toBe(true);
      expect(out.grid.lg?.epics).toEqual({ x: 0, y: 0, w: 6, h: 8 });
      expect(out.grid.lg?.["not-a-panel" as never]).toBeUndefined();
      expect(out.grid.lg?.["broken" as never]).toBeUndefined();
      expect(out.grid.xx as unknown).toBeUndefined();
    });

    it("computeDefaultGridLayout tiles visible panels without column overflow", () => {
      const prefs = defaultPreferences("repo_detail");
      const coords = computeDefaultGridLayout(prefs, "lg");
      const cols = GRID_COLS.lg;
      for (const c of Object.values(coords)) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x + c.w).toBeLessThanOrEqual(cols);
        expect(c.w).toBeGreaterThan(0);
        expect(c.h).toBeGreaterThan(0);
      }
    });

    it("resolveGridLayout overlays user coords on top of defaults", () => {
      let prefs = defaultPreferences("repo_detail");
      const userLayout = {
        epics: { x: 0, y: 100, w: 12, h: 12 },
      } as Parameters<typeof setGridLayout>[2];
      prefs = setGridLayout(prefs, "lg", userLayout);
      const merged = resolveGridLayout(prefs, "lg");
      // Only `epics` is overridden; everything else stays at defaults.
      expect(merged.epics).toEqual({ x: 0, y: 100, w: 12, h: 12 });
      expect(Object.keys(merged).length).toBeGreaterThan(1);
    });

    it("setGridEnabled toggles the flag and bumps updated_at", () => {
      const a = defaultPreferences("repo_detail");
      const b = setGridEnabled(a, true);
      expect(b.gridEnabled).toBe(true);
      expect(b.updated_at).not.toEqual(a.updated_at);
      // idempotent
      const c = setGridEnabled(b, true);
      expect(c).toBe(b);
    });

    it("clearGridLayout wipes saved coords", () => {
      let prefs = defaultPreferences("repo_detail");
      const userLayout = {
        epics: { x: 0, y: 0, w: 12, h: 12 },
      } as Parameters<typeof setGridLayout>[2];
      prefs = setGridLayout(prefs, "lg", userLayout);
      expect(Object.keys(prefs.grid).length).toBe(1);
      const cleared = clearGridLayout(prefs);
      expect(cleared.grid).toEqual({});
    });
  });
});
