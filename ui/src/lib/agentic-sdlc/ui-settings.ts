import { getConfig } from "@/lib/config";
import { REPO_UPDATE_HIGHLIGHT_MS, TRON_HALO_COLOR } from "@/lib/agentic-sdlc/highlight-timing";

export { TRON_HALO_COLOR };

export const AGENTIC_SDLC_UI_SETTINGS_STORAGE_KEY = "agentic-sdlc-ui-settings:v1";
export const AGENTIC_SDLC_UI_SETTINGS_EVENT = "agentic-sdlc:ui-settings-changed";

export interface AgenticSdlcUiSettings {
  doneIssuesLookbackHours: number;
  haloDurationSeconds: number;
  replayIntervalSeconds: number;
  haloColor: string;
}

export const HALO_COLOR_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Default", value: TRON_HALO_COLOR },
  { label: "Grid blue", value: "#3b82f6" },
  { label: "Arc magenta", value: "#d946ef" },
  { label: "Signal amber", value: "#f59e0b" },
];

export const DEFAULT_AGENTIC_SDLC_UI_SETTINGS: AgenticSdlcUiSettings = {
  doneIssuesLookbackHours: 24,
  haloDurationSeconds: REPO_UPDATE_HIGHLIGHT_MS / 1000,
  replayIntervalSeconds: 3,
  haloColor: TRON_HALO_COLOR,
};

export function defaultAgenticSdlcUiSettings(): AgenticSdlcUiSettings {
  return {
    ...DEFAULT_AGENTIC_SDLC_UI_SETTINGS,
    doneIssuesLookbackHours: positiveInteger(
      getConfig("shipLoopResolvedArtifactLookbackHours"),
      DEFAULT_AGENTIC_SDLC_UI_SETTINGS.doneIssuesLookbackHours,
    ),
  };
}

export function sanitizeAgenticSdlcUiSettings(
  value: unknown,
  defaults = DEFAULT_AGENTIC_SDLC_UI_SETTINGS,
): AgenticSdlcUiSettings {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    doneIssuesLookbackHours: positiveInteger(
      record.doneIssuesLookbackHours,
      defaults.doneIssuesLookbackHours,
    ),
    haloDurationSeconds: positiveInteger(
      record.haloDurationSeconds,
      defaults.haloDurationSeconds,
    ),
    replayIntervalSeconds: positiveInteger(
      record.replayIntervalSeconds,
      defaults.replayIntervalSeconds,
    ),
    haloColor: sanitizeColor(record.haloColor, defaults.haloColor),
  };
}

export function readAgenticSdlcUiSettings(): AgenticSdlcUiSettings {
  const defaults = defaultAgenticSdlcUiSettings();
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(AGENTIC_SDLC_UI_SETTINGS_STORAGE_KEY);
    return sanitizeAgenticSdlcUiSettings(raw ? JSON.parse(raw) : null, defaults);
  } catch {
    return defaults;
  }
}

export function writeAgenticSdlcUiSettings(
  settings: Partial<AgenticSdlcUiSettings>,
): AgenticSdlcUiSettings {
  const next = sanitizeAgenticSdlcUiSettings({
    ...readAgenticSdlcUiSettings(),
    ...settings,
  }, defaultAgenticSdlcUiSettings());
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      AGENTIC_SDLC_UI_SETTINGS_STORAGE_KEY,
      JSON.stringify(next),
    );
    window.dispatchEvent(
      new CustomEvent(AGENTIC_SDLC_UI_SETTINGS_EVENT, { detail: next }),
    );
  }
  return next;
}

export function resetAgenticSdlcUiSettings(): AgenticSdlcUiSettings {
  const defaults = defaultAgenticSdlcUiSettings();
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(AGENTIC_SDLC_UI_SETTINGS_STORAGE_KEY);
    window.dispatchEvent(
      new CustomEvent(AGENTIC_SDLC_UI_SETTINGS_EVENT, { detail: defaults }),
    );
  }
  return defaults;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function sanitizeColor(value: unknown, fallback: string): string {
  const color = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
}
