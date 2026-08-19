import { apiClient } from "@/lib/api-client";
import { getStorageMode } from "@/lib/storage-config";
import { create } from "zustand";

const STORAGE_KEY = "caipe-home-widgets";
const EXPERIENCE_STORAGE_KEY = "caipe-home-experience";

export type HomeExperience = "new" | "classic";

export interface HomeWidgetDefinition {
  id: string;
  label: string;
  /** Only offered/rendered when the app is running against MongoDB. */
  requiresMongo?: boolean;
}

export const HOME_WIDGET_DEFINITIONS: HomeWidgetDefinition[] = [
  { id: "shortcuts", label: "Shortcuts" },
  { id: "recentChats", label: "Recent Chats" },
  { id: "insights", label: "Your Insights", requiresMongo: true },
  { id: "sharedConversations", label: "Shared Conversations", requiresMongo: true },
];

function readFromLocalStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const validIds = new Set(HOME_WIDGET_DEFINITIONS.map((w) => w.id));
    return parsed.filter((id): id is string => typeof id === "string" && validIds.has(id));
  } catch {
    return [];
  }
}

function writeToLocalStorage(widgets: string[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
}

function readExperienceFromLocalStorage(): HomeExperience {
  if (typeof window === "undefined") return "new";
  const raw = localStorage.getItem(EXPERIENCE_STORAGE_KEY);
  return raw === "classic" ? "classic" : "new";
}

function writeExperienceToLocalStorage(experience: HomeExperience): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(EXPERIENCE_STORAGE_KEY, experience);
}

async function persistHomeWidgets(widgets: string[]): Promise<void> {
  await apiClient.updatePreferences({ home_widgets: widgets });
}

async function persistHomeExperience(experience: HomeExperience): Promise<void> {
  await apiClient.updatePreferences({ home_experience: experience });
}

interface HomeWidgetsState {
  widgets: string[];
  experience: HomeExperience;
  initialized: boolean;
  touched: boolean;

  initialize: () => void;
  addWidget: (id: string) => void;
  removeWidget: (id: string) => void;
  reorderWidgets: (order: string[]) => void;
  setExperience: (experience: HomeExperience) => void;
  isEnabled: (id: string) => boolean;
  availableToAdd: () => HomeWidgetDefinition[];
}

export const useHomeWidgetsStore = create<HomeWidgetsState>((set, get) => ({
  widgets: [],
  experience: "new",
  initialized: false,
  touched: false,

  initialize: () => {
    if (get().initialized) return;
    const widgets = readFromLocalStorage();
    const experience = readExperienceFromLocalStorage();
    set({ widgets, experience, initialized: true });

    apiClient
      .getSettings()
      .then((settings) => {
        if (get().touched) return;
        const prefs = settings?.preferences;

        const serverWidgets = prefs?.home_widgets;
        if (Array.isArray(serverWidgets)) {
          const validIds = new Set(HOME_WIDGET_DEFINITIONS.map((w) => w.id));
          const filtered = serverWidgets.filter((id) => validIds.has(id));
          writeToLocalStorage(filtered);
          set({ widgets: filtered });
        }

        const serverExperience = prefs?.home_experience;
        if (serverExperience === "new" || serverExperience === "classic") {
          writeExperienceToLocalStorage(serverExperience);
          set({ experience: serverExperience });
        }
      })
      .catch((error: unknown) => {
        console.warn("[home-widgets] Account preferences could not be loaded", error);
      });
  },

  addWidget: (id: string) => {
    const current = get().widgets;
    if (current.includes(id)) return;
    const next = [...current, id];
    writeToLocalStorage(next);
    set({ widgets: next, touched: true });
    void persistHomeWidgets(next).catch((error: unknown) => {
      console.warn(`[home-widgets] Could not sync add of ${id}`, error);
    });
  },

  removeWidget: (id: string) => {
    const next = get().widgets.filter((w) => w !== id);
    writeToLocalStorage(next);
    set({ widgets: next, touched: true });
    void persistHomeWidgets(next).catch((error: unknown) => {
      console.warn(`[home-widgets] Could not sync removal of ${id}`, error);
    });
  },

  reorderWidgets: (order: string[]) => {
    const current = get().widgets;
    // Defend against a stale/foreign order array (e.g. a race with an
    // add/remove) — only accept it if it's exactly a permutation of what's
    // currently enabled.
    if (order.length !== current.length || !order.every((id) => current.includes(id))) {
      return;
    }
    writeToLocalStorage(order);
    set({ widgets: order, touched: true });
    void persistHomeWidgets(order).catch((error: unknown) => {
      console.warn("[home-widgets] Could not sync widget order", error);
    });
  },

  setExperience: (experience: HomeExperience) => {
    writeExperienceToLocalStorage(experience);
    set({ experience, touched: true });
    void persistHomeExperience(experience).catch((error: unknown) => {
      console.warn(`[home-widgets] Could not sync experience choice`, error);
    });
  },

  isEnabled: (id: string) => get().widgets.includes(id),

  availableToAdd: () => {
    const enabled = new Set(get().widgets);
    const isMongo = getStorageMode() === "mongodb";
    return HOME_WIDGET_DEFINITIONS.filter(
      (w) => !enabled.has(w.id) && (!w.requiresMongo || isMongo),
    );
  },
}));
