import type {
CreateWorkflowConfigInput,
UpdateWorkflowConfigInput,
WorkflowConfig,
} from "@/types/workflow-config";
import { create } from "zustand";

/**
 * Workflow Config Store
 *
 * Manages workflow configurations for the Workflows feature.
 * All data is persisted in MongoDB via the /api/workflow-configs endpoints.
 */

export type ConfigEditMode = "new" | "edit" | "clone" | null;

interface WorkflowConfigState {
  configs: WorkflowConfig[];
  isLoading: boolean;
  error: string | null;
  selectedConfigId: string | null;
  /** Current edit mode — drives what the right panel shows */
  editMode: ConfigEditMode;

  loadConfigs: () => Promise<void>;
  createConfig: (config: CreateWorkflowConfigInput) => Promise<string>;
  updateConfig: (id: string, updates: UpdateWorkflowConfigInput) => Promise<void>;
  deleteConfig: (id: string) => Promise<void>;
  selectConfig: (id: string | null) => void;
  /** Open the editor for a config (edit/clone/new) */
  openEditor: (mode: ConfigEditMode, configId?: string | null) => void;
  /** Close the editor */
  closeEditor: () => void;
  getConfigById: (id: string) => WorkflowConfig | undefined;
}

function transformConfig(config: Record<string, unknown>): WorkflowConfig {
  const raw = config as unknown as WorkflowConfig;
  return {
    ...raw,
    steps: Array.isArray(raw.steps) ? raw.steps : [],
    created_at: new Date(config.created_at as string),
    updated_at: new Date(config.updated_at as string),
  };
}

function parseWorkflowConfigList(data: unknown): WorkflowConfig[] {
  if (Array.isArray(data)) {
    return data.map((item) => transformConfig(item as Record<string, unknown>));
  }
  if (data && typeof data === "object") {
    const wrapped = (data as { data?: unknown }).data;
    if (Array.isArray(wrapped)) {
      return wrapped.map((item) => transformConfig(item as Record<string, unknown>));
    }
  }
  return [];
}

function workflowConfigApiError(payload: Record<string, unknown>, fallback: string): string {
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  const error = typeof payload.error === "string" ? payload.error.trim() : "";
  return message || error || fallback;
}

export const useWorkflowConfigStore = create<WorkflowConfigState>()((set, get) => ({
  configs: [],
  isLoading: false,
  error: null,
  selectedConfigId: null,
  editMode: null,

  loadConfigs: async () => {
    set({ isLoading: true, error: null });

    try {
      const response = await fetch("/api/workflow-configs");

      // Handle 503 (MongoDB not configured) — not an error, just not available
      if (response.status === 503) {
        set({ configs: [], isLoading: false, error: null });
        return;
      }

      if (!response.ok) {
        const message = await response.text().catch(() => "");
        let detail = `Failed to load workflow configs (${response.status})`;
        try {
          const json = JSON.parse(message) as { error?: string; message?: string };
          detail = json.error || json.message || detail;
        } catch {
          if (message.trim()) detail = message.trim();
        }
        throw new Error(detail);
      }

      const data = await response.json();
      set({ configs: parseWorkflowConfigList(data), isLoading: false, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load workflow configs";
      set({ error: message, isLoading: false });
    }
  },

  createConfig: async (configData) => {
    const response = await fetch("/api/workflow-configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configData),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(
        workflowConfigApiError(err, `Failed to create workflow config: ${response.status}`),
      );
    }

    const result = await response.json();
    await get().loadConfigs();
    return result.data?.id || result.id;
  },

  updateConfig: async (id, updates) => {
    const response = await fetch(`/api/workflow-configs?id=${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(
        workflowConfigApiError(err, `Failed to update workflow config: ${response.status}`),
      );
    }

    await get().loadConfigs();
  },

  deleteConfig: async (id) => {
    const response = await fetch(`/api/workflow-configs?id=${id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Failed to delete workflow config: ${response.status}`);
    }

    set((state) => ({
      configs: state.configs.filter((c) => c._id !== id),
      selectedConfigId: state.selectedConfigId === id ? null : state.selectedConfigId,
    }));
  },

  selectConfig: (id) => set({ selectedConfigId: id }),

  openEditor: (mode, configId) => set({
    editMode: mode,
    selectedConfigId: configId || null,
  }),

  closeEditor: () => set({ editMode: null, selectedConfigId: null }),

  getConfigById: (id) => get().configs.find((c) => c._id === id),
}));
