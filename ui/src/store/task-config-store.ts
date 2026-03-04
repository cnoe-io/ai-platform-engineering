import { create } from "zustand";
import type {
  TaskConfig,
  CreateTaskConfigInput,
  UpdateTaskConfigInput,
} from "@/types/task-config";

/**
 * Task Config Store
 *
 * Manages task configurations for the Task Builder feature.
 * All data is persisted in MongoDB via the /api/task-configs endpoints.
 */

interface TaskConfigState {
  configs: TaskConfig[];
  isLoading: boolean;
  error: string | null;
  selectedConfigId: string | null;
  isSeeded: boolean;

  loadConfigs: () => Promise<void>;
  createConfig: (config: CreateTaskConfigInput) => Promise<string>;
  updateConfig: (id: string, updates: UpdateTaskConfigInput) => Promise<void>;
  deleteConfig: (id: string) => Promise<void>;
  selectConfig: (id: string | null) => void;
  getConfigById: (id: string) => TaskConfig | undefined;
  getConfigsByCategory: (category: string) => TaskConfig[];
  seedFromYaml: () => Promise<void>;
  refreshConfigs: () => Promise<void>;
}

function transformConfig(config: Record<string, unknown>): TaskConfig {
  return {
    ...(config as TaskConfig),
    created_at: new Date(config.created_at as string),
    updated_at: new Date(config.updated_at as string),
  };
}

export const useTaskConfigStore = create<TaskConfigState>()((set, get) => ({
  configs: [],
  isLoading: false,
  error: null,
  selectedConfigId: null,
  isSeeded: false,

  seedFromYaml: async () => {
    if (get().isSeeded) return;
    try {
      await fetch("/api/task-configs/seed");
      set({ isSeeded: true });
    } catch (error) {
      console.error("[TaskConfigStore] Seed failed:", error);
    }
  },

  loadConfigs: async () => {
    if (get().isLoading) return;
    set({ isLoading: true, error: null });

    try {
      if (!get().isSeeded) {
        await get().seedFromYaml();
      }

      const response = await fetch("/api/task-configs");
      if (!response.ok) {
        throw new Error(`Failed to load task configs: ${response.status}`);
      }

      const data = await response.json();
      const configs = Array.isArray(data) ? data.map(transformConfig) : [];
      set({ configs, isLoading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load task configs";
      set({ error: message, isLoading: false });
    }
  },

  createConfig: async (configData) => {
    const response = await fetch("/api/task-configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configData),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Failed to create task config: ${response.status}`);
    }

    const result = await response.json();
    await get().loadConfigs();
    return result.data?.id || result.id;
  },

  updateConfig: async (id, updates) => {
    const response = await fetch(`/api/task-configs?id=${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Failed to update task config: ${response.status}`);
    }

    await get().loadConfigs();
  },

  deleteConfig: async (id) => {
    const response = await fetch(`/api/task-configs?id=${id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Failed to delete task config: ${response.status}`);
    }

    set((state) => ({
      configs: state.configs.filter((c) => c.id !== id),
      selectedConfigId:
        state.selectedConfigId === id ? null : state.selectedConfigId,
    }));
  },

  selectConfig: (id) => set({ selectedConfigId: id }),

  getConfigById: (id) => get().configs.find((c) => c.id === id),

  getConfigsByCategory: (category) =>
    get().configs.filter((c) => c.category === category),

  refreshConfigs: async () => {
    set({ isSeeded: true });
    await get().loadConfigs();
  },
}));
