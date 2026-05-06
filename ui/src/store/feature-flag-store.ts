import { create } from "zustand";
import { apiClient } from "@/lib/api-client";

const STORAGE_KEY = "caipe-feature-flags";

export type FeatureFlagIcon = "Brain" | "Bug" | "Eye" | "ArrowDownToLine" | "Clock" | "Ship" | "MessagesSquare";
export type FeatureFlagCategory = "ai" | "chat" | "developer";

export const CATEGORY_LABELS: Record<FeatureFlagCategory, string> = {
  ai: "AI & Memory",
  chat: "Chat Behavior",
  developer: "Developer",
};

export interface FeatureFlag {
  id: string;
  label: string;
  description: string;
  /** Longer explanation shown in the info tooltip */
  detail: string;
  icon: FeatureFlagIcon;
  category: FeatureFlagCategory;
  defaultValue: boolean;
  /** MongoDB preferences field name used for server sync */
  preferencesKey: string;
  /** URL to documentation page (opened when the info button is clicked) */
  docsUrl?: string;
}

export const FEATURE_FLAGS: FeatureFlag[] = [
  {
    id: "memory",
    label: "Cross-Thread Memory",
    description: "Remember facts about you across conversations",
    detail:
      "When enabled, the assistant extracts and recalls facts about you (e.g. your clusters, team, preferences) across separate conversations. Disabling this makes every chat start fresh.",
    icon: "Brain",
    category: "ai",
    defaultValue: true,
    preferencesKey: "memory_enabled",
    docsUrl: "/docs/features/cross-thread-memory",
  },
  {
    id: "showThinking",
    label: "Show Thinking",
    description: "Expand the raw stream panel by default",
    detail:
      "Controls whether the \"Thinking...\" panel is expanded or collapsed when the assistant starts streaming a response. You can always toggle it per-message.",
    icon: "Eye",
    category: "chat",
    defaultValue: true,
    preferencesKey: "show_thinking_enabled",
  },
  {
    id: "autoScroll",
    label: "Auto-Scroll",
    description: "Scroll to newest message automatically",
    detail:
      "When enabled, the chat view scrolls to the bottom as new messages arrive and during streaming. Disable to keep your scroll position while reading older messages.",
    icon: "ArrowDownToLine",
    category: "chat",
    defaultValue: true,
    preferencesKey: "auto_scroll_enabled",
  },
  {
    id: "showTimestamps",
    label: "Show Timestamps",
    description: "Display time next to each message",
    detail:
      "Shows a small timestamp (e.g. 2:34 PM) next to each message in the chat. Useful for tracking response times and reviewing conversation history.",
    icon: "Clock",
    category: "chat",
    defaultValue: false,
    preferencesKey: "show_timestamps_enabled",
  },
  {
    id: "debug",
    label: "Debug Mode",
    description: "Verbose logging in browser console",
    detail:
      "Enables detailed diagnostic output in the browser developer console to help troubleshoot agent interactions and streaming issues.",
    icon: "Bug",
    category: "developer",
    defaultValue: false,
    preferencesKey: "debug_mode_enabled",
  },
  // Ship Loop feature is gated by both SHIP_LOOP_ENABLED (server) AND this
  // per-user flag (client). The default below is `true` so that whenever
  // the operator turns the server-side flag on, every user sees the
  // feature without having to opt in. Users who explicitly toggle this
  // OFF will have `false` written to localStorage + their server
  // preferences, and that explicit choice is honored on subsequent
  // sessions (readFromLocalStorage merges over the defaults).
  {
    id: "shipLoop",
    label: "Agentic SDLC Ship Loop",
    description: "Live dashboard for agent-driven Epic/PR/deploy flow",
    detail:
      "Surfaces the Ship Loop tab where you can onboard a GitHub repo and watch agents take an Epic through sub-tasks, PRs, HITL reviews, and sandbox deploys in real time. Requires SHIP_LOOP_ENABLED=true on the server.",
    icon: "Ship",
    category: "developer",
    defaultValue: true,
    preferencesKey: "ship_loop_enabled",
    docsUrl: "/docs/features/ship-loop",
  },
  // Sub-feature kept opt-in by default until the AG-UI assistant work
  // (US5 / T071-T083) actually ships — turning it on without the panel
  // existing would surface a broken UI affordance.
  {
    id: "shipLoopAssistant",
    label: "Talk to the Loop",
    description: "AG-UI assistant side panel scoped to the current Epic",
    detail:
      "Adds a read-only chat panel inside the Ship Loop view, backed by a preconfigured CAIPE Dynamic Agent. The agent can explain blockers and surface context but cannot mutate state. Requires SHIP_LOOP_ENABLED and SHIP_LOOP_ASSISTANT_ENABLED on the server.",
    icon: "MessagesSquare",
    category: "developer",
    defaultValue: false,
    preferencesKey: "ship_loop_assistant_enabled",
  },
];

interface FeatureFlagState {
  flags: Record<string, boolean>;
  initialized: boolean;

  initialize: () => void;
  toggle: (id: string) => void;
  isEnabled: (id: string) => boolean;
}

function getDefaults(): Record<string, boolean> {
  const defaults: Record<string, boolean> = {};
  for (const flag of FEATURE_FLAGS) {
    defaults[flag.id] = flag.defaultValue;
  }
  return defaults;
}

function readFromLocalStorage(): Record<string, boolean> {
  if (typeof window === "undefined") return getDefaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaults();
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    const merged = getDefaults();
    for (const flag of FEATURE_FLAGS) {
      if (typeof parsed[flag.id] === "boolean") {
        merged[flag.id] = parsed[flag.id];
      }
    }
    return merged;
  } catch {
    return getDefaults();
  }
}

function writeToLocalStorage(flags: Record<string, boolean>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;

function syncToServer(flags: Record<string, boolean>): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const prefs: Record<string, string> = {};
    for (const flag of FEATURE_FLAGS) {
      prefs[flag.preferencesKey] = String(flags[flag.id] ?? flag.defaultValue);
    }
    apiClient.updatePreferences(prefs).catch(() => {
      /* server unavailable -- localStorage still works */
    });
  }, 500);
}

export const useFeatureFlagStore = create<FeatureFlagState>((set, get) => ({
  flags: getDefaults(),
  initialized: false,

  initialize: () => {
    if (get().initialized) return;
    const flags = readFromLocalStorage();
    set({ flags, initialized: true });

    apiClient
      .getSettings()
      .then((settings) => {
        if (!settings?.preferences) return;
        const prefs = settings.preferences;
        const updated = { ...get().flags };
        let changed = false;
        for (const flag of FEATURE_FLAGS) {
          const serverVal = prefs[flag.preferencesKey as keyof typeof prefs];
          if (typeof serverVal === "string") {
            const boolVal = serverVal === "true";
            if (updated[flag.id] !== boolVal) {
              updated[flag.id] = boolVal;
              changed = true;
            }
          }
        }
        if (changed) {
          writeToLocalStorage(updated);
          set({ flags: updated });
        }
      })
      .catch(() => {
        /* server unavailable */
      });
  },

  toggle: (id: string) => {
    const current = get().flags;
    const next = { ...current, [id]: !current[id] };
    writeToLocalStorage(next);
    set({ flags: next });
    syncToServer(next);
  },

  isEnabled: (id: string) => {
    const val = get().flags[id];
    if (typeof val === "boolean") return val;
    const flag = FEATURE_FLAGS.find((f) => f.id === id);
    return flag?.defaultValue ?? false;
  },
}));

/**
 * Read a feature flag outside of React components.
 *
 * Prefers the Zustand store when initialized, otherwise falls back to
 * localStorage so it works before React hydration (e.g. inside the
 * A2ASDKClient constructor).
 */
export function isFeatureEnabled(id: string): boolean {
  const store = useFeatureFlagStore.getState();
  if (store.initialized) return store.isEnabled(id);
  const flags = readFromLocalStorage();
  return flags[id] ?? getDefaults()[id] ?? false;
}
