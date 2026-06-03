"use client";

/**
 * usePanelPreferences — React hook that owns the user's panel layout
 * preferences for a single surface (repo_detail or home).
 *
 * Hydration order, deliberately layered to avoid flicker:
 *
 *   1. First render: returns the registry defaults so SSR + the first
 *      paint pick the right panels. This means the page never flashes
 *      with "all panels" or "no panels" while prefs are loading.
 *   2. Immediately after mount: localStorage is consulted; if a saved
 *      copy exists, it replaces the defaults synchronously, so user
 *      choices stick across reloads with zero round-trip latency.
 *   3. In parallel, a fetch to /api/agentic-sdlc/me/panel-prefs runs;
 *      when it lands, server prefs win (they are the source of truth
 *      across devices). The result is also written back to
 *      localStorage so subsequent loads are instant.
 *
 * Writes are optimistic + debounced:
 *   - The local React state and localStorage update immediately.
 *   - A debounced PUT to the API persists the change to Mongo. If the
 *     PUT fails the local state still reflects the user's choice; we
 *     retry once on the next change.
 *
 * Listens for the storage event so two tabs stay in sync on the same
 * device.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  clearGridLayout as clearGridLayoutPure,
  defaultPreferences,
  movePanel as movePanelPure,
  normalisePreferences,
  resetPreferences,
  setGridEnabled as setGridEnabledPure,
  setGridLayout as setGridLayoutPure,
  togglePanelVisibility as togglePure,
  type Breakpoint,
  type GridCoord,
  type PanelPreferences,
} from "@/lib/agentic-sdlc/panel-preferences";
import type {
  PanelId,
  PanelSection,
  PanelSurface,
} from "@/lib/agentic-sdlc/panel-registry";

const LOCAL_STORAGE_KEY = (surface: PanelSurface) =>
  `agentic-sdlc.panel-prefs.${surface}.v1`;

const SAVE_DEBOUNCE_MS = 600;

interface UsePanelPreferencesArgs {
  surface: PanelSurface;
}

export interface UsePanelPreferencesResult {
  preferences: PanelPreferences;
  isHydrated: boolean;
  isSaving: boolean;
  lastSavedAt: string | null;
  togglePanel: (id: PanelId) => void;
  movePanel: (id: PanelId, toSection: PanelSection, toIndex: number) => void;
  reset: () => void;
  setDensity: (density: "compact" | "comfortable") => void;
  setGridEnabled: (enabled: boolean) => void;
  setGridLayout: (
    breakpoint: Breakpoint,
    layout: Record<PanelId, GridCoord>,
  ) => void;
  resetGrid: () => void;
  /** Replace the preferences wholesale — used by drag-reorder commits. */
  setPreferences: (next: PanelPreferences) => void;
}

function readLocal(surface: PanelSurface): PanelPreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY(surface));
    if (!raw) return null;
    return normalisePreferences(JSON.parse(raw), surface);
  } catch {
    return null;
  }
}

function writeLocal(prefs: PanelPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LOCAL_STORAGE_KEY(prefs.surface),
      JSON.stringify(prefs),
    );
  } catch {
    /* quota exceeded / private mode — non-fatal */
  }
}

async function fetchServerPrefs(
  surface: PanelSurface,
): Promise<PanelPreferences | null> {
  try {
    const res = await fetch(
      `/api/agentic-sdlc/me/panel-prefs?surface=${surface}`,
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { preferences?: unknown };
    if (!body.preferences) return null;
    return normalisePreferences(body.preferences, surface);
  } catch {
    return null;
  }
}

async function putServerPrefs(prefs: PanelPreferences): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/agentic-sdlc/me/panel-prefs?surface=${prefs.surface}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ preferences: prefs }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export function usePanelPreferences(
  args: UsePanelPreferencesArgs,
): UsePanelPreferencesResult {
  const { surface } = args;
  const [preferences, setPreferencesState] = useState<PanelPreferences>(() =>
    defaultPreferences(surface),
  );
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedRef = useRef<string>("");

  // Hydration: localStorage first, then server (server wins).
  useEffect(() => {
    const local = readLocal(surface);
    if (local) setPreferencesState(local);
    setIsHydrated(true);

    let cancelled = false;
    void (async () => {
      const server = await fetchServerPrefs(surface);
      if (cancelled || !server) return;
      const localUpdated = local ? Date.parse(local.updated_at) : 0;
      const serverUpdated = Date.parse(server.updated_at);
      // Server wins unless localStorage has a strictly newer copy
      // (offline edits) — in which case we keep local and push to
      // server on the next save.
      if (serverUpdated >= localUpdated) {
        setPreferencesState(server);
        writeLocal(server);
      }
    })();

    return () => {
      cancelled = true;
    };
    // surface is stable per mount; intentional empty dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface]);

  // Cross-tab sync via storage events.
  useEffect(() => {
    function onStorage(ev: StorageEvent) {
      if (ev.key !== LOCAL_STORAGE_KEY(surface) || !ev.newValue) return;
      try {
        const next = normalisePreferences(JSON.parse(ev.newValue), surface);
        setPreferencesState(next);
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [surface]);

  // Debounced server persistence.
  const schedulePersist = useCallback((next: PanelPreferences) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const serialized = JSON.stringify(next);
      if (serialized === lastPersistedRef.current) return;
      setIsSaving(true);
      const ok = await putServerPrefs(next);
      if (ok) {
        lastPersistedRef.current = serialized;
        setLastSavedAt(new Date().toISOString());
      }
      setIsSaving(false);
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const commit = useCallback(
    (next: PanelPreferences) => {
      setPreferencesState(next);
      writeLocal(next);
      schedulePersist(next);
    },
    [schedulePersist],
  );

  const togglePanel = useCallback(
    (id: PanelId) => {
      commit(togglePure(preferences, id));
    },
    [preferences, commit],
  );

  const movePanel = useCallback(
    (id: PanelId, toSection: PanelSection, toIndex: number) => {
      commit(movePanelPure(preferences, id, toSection, toIndex));
    },
    [preferences, commit],
  );

  const reset = useCallback(() => {
    commit(resetPreferences(surface));
  }, [surface, commit]);

  const setDensity = useCallback(
    (density: "compact" | "comfortable") => {
      commit({
        ...preferences,
        density,
        updated_at: new Date().toISOString(),
      });
    },
    [preferences, commit],
  );

  const setPreferencesFn = useCallback(
    (next: PanelPreferences) => commit(next),
    [commit],
  );

  const setGridEnabled = useCallback(
    (enabled: boolean) => {
      commit(setGridEnabledPure(preferences, enabled));
    },
    [preferences, commit],
  );

  const setGridLayout = useCallback(
    (breakpoint: Breakpoint, layout: Record<PanelId, GridCoord>) => {
      commit(setGridLayoutPure(preferences, breakpoint, layout));
    },
    [preferences, commit],
  );

  const resetGrid = useCallback(() => {
    commit(clearGridLayoutPure(preferences));
  }, [preferences, commit]);

  return useMemo(
    () => ({
      preferences,
      isHydrated,
      isSaving,
      lastSavedAt,
      togglePanel,
      movePanel,
      reset,
      setDensity,
      setGridEnabled,
      setGridLayout,
      resetGrid,
      setPreferences: setPreferencesFn,
    }),
    [
      preferences,
      isHydrated,
      isSaving,
      lastSavedAt,
      togglePanel,
      movePanel,
      reset,
      setDensity,
      setGridEnabled,
      setGridLayout,
      resetGrid,
      setPreferencesFn,
    ],
  );
}
