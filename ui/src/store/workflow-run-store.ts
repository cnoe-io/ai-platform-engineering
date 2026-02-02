import { create } from "zustand";
import type {
  WorkflowRun,
  CreateWorkflowRunInput,
  UpdateWorkflowRunInput,
} from "@/types/workflow-run";

interface WorkflowRunStore {
  // State
  runs: WorkflowRun[];
  isLoading: boolean;
  error: string | null;
  activeRunId: string | null; // Currently executing run

  // Actions
  loadRuns: (filters?: { workflow_id?: string; status?: string; limit?: number }) => Promise<void>;
  createRun: (input: CreateWorkflowRunInput) => Promise<string>;
  updateRun: (id: string, updates: UpdateWorkflowRunInput) => Promise<void>;
  deleteRun: (id: string) => Promise<void>;
  getRunById: (id: string) => WorkflowRun | undefined;
  getRunsForWorkflow: (workflowId: string) => WorkflowRun[];
  setActiveRunId: (id: string | null) => void;
  clearError: () => void;
}

export const useWorkflowRunStore = create<WorkflowRunStore>((set, get) => ({
  // Initial state
  runs: [],
  isLoading: false,
  error: null,
  activeRunId: null,

  // Load runs from API
  loadRuns: async (filters) => {
    try {
      set({ isLoading: true, error: null });

      const params = new URLSearchParams();
      if (filters?.workflow_id) params.set("workflow_id", filters.workflow_id);
      if (filters?.status) params.set("status", filters.status);
      if (filters?.limit) params.set("limit", filters.limit.toString());

      const response = await fetch(`/api/workflow-runs?${params.toString()}`);

      // Handle 503 (MongoDB not configured) - not an error, just not available
      if (response.status === 503) {
        set({ runs: [], isLoading: false });
        return;
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to load workflow runs" }));
        throw new Error(error.error || "Failed to load workflow runs");
      }

      const runs = await response.json();
      set({ runs, isLoading: false });
      console.log(`[WorkflowRunStore] Loaded ${runs.length} workflow runs`);
    } catch (error: any) {
      console.error("[WorkflowRunStore] Failed to load runs:", error);
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  // Create a new run
  createRun: async (input) => {
    try {
      console.log(`[WorkflowRunStore] Creating run for workflow ${input.workflow_id}`);

      const response = await fetch("/api/workflow-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      // Handle 503 (MongoDB not configured)
      if (response.status === 503) {
        throw new Error("MongoDB is required for workflow run history. Please configure MongoDB.");
      }

      // Handle 401 (not authenticated)
      if (response.status === 401) {
        throw new Error("Please sign in to track workflow runs.");
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to create workflow run" }));
        throw new Error(error.error || "Failed to create workflow run");
      }

      const result = await response.json();
      // API returns { success: true, data: { id, message } }
      const runId = result.data?.id;
      
      if (!runId) {
        console.error("[WorkflowRunStore] ❌ No run ID in response:", result);
        throw new Error("Failed to get run ID from API response");
      }

      // Reload from server to get the created run
      await get().loadRuns();
      console.log(`[WorkflowRunStore] ✅ Created workflow run "${runId}"`);

      // Set as active run
      set({ activeRunId: runId });

      return runId;
    } catch (error: any) {
      console.error("[WorkflowRunStore] Failed to create run:", error);
      throw error;
    }
  },

  // Update an existing run
  updateRun: async (id, updates) => {
    try {
      console.log(`[WorkflowRunStore] Updating run ${id}`, updates);

      const response = await fetch(`/api/workflow-runs?id=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      // Handle 503 (MongoDB not configured)
      if (response.status === 503) {
        throw new Error("MongoDB is required for workflow run history.");
      }

      // Handle 401 (not authenticated)
      if (response.status === 401) {
        throw new Error("Please sign in to update workflow runs.");
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to update workflow run" }));
        throw new Error(error.error || "Failed to update workflow run");
      }

      // Reload from server - no filters so we get all runs
      console.log(`[WorkflowRunStore] Reloading all runs after update...`);
      await get().loadRuns();
      console.log(`[WorkflowRunStore] ✅ Successfully updated and reloaded workflow run "${id}"`);

      // If this was the active run and it's now completed/failed/cancelled, clear active run
      if (get().activeRunId === id && updates.status && updates.status !== "running") {
        set({ activeRunId: null });
      }
    } catch (error: any) {
      console.error("[WorkflowRunStore] ❌ Failed to update run:", error);
      console.error("[WorkflowRunStore] Error details:", error);
      throw error;
    }
  },

  // Delete a run
  deleteRun: async (id) => {
    try {
      const response = await fetch(`/api/workflow-runs?id=${id}`, {
        method: "DELETE",
      });

      // Handle 503 (MongoDB not configured)
      if (response.status === 503) {
        throw new Error("MongoDB is required for workflow run history.");
      }

      // Handle 401 (not authenticated)
      if (response.status === 401) {
        throw new Error("Please sign in to delete workflow runs.");
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to delete workflow run" }));
        throw new Error(error.error || "Failed to delete workflow run");
      }

      // Remove from local state
      set((state) => ({
        runs: state.runs.filter((run) => run.id !== id),
      }));
      console.log(`[WorkflowRunStore] Deleted workflow run "${id}"`);

      // Clear active run if it was deleted
      if (get().activeRunId === id) {
        set({ activeRunId: null });
      }
    } catch (error: any) {
      console.error("[WorkflowRunStore] Failed to delete run:", error);
      throw error;
    }
  },

  // Get a specific run by ID
  getRunById: (id) => {
    return get().runs.find((run) => run.id === id);
  },

  // Get all runs for a specific workflow
  getRunsForWorkflow: (workflowId) => {
    return get().runs.filter((run) => run.workflow_id === workflowId);
  },

  // Set active run ID
  setActiveRunId: (id) => {
    set({ activeRunId: id });
  },

  // Clear error
  clearError: () => {
    set({ error: null });
  },
}));
