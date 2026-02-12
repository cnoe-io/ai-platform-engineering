/**
 * @jest-environment jsdom
 */
/**
 * Unit tests for workflow-run-store.ts
 *
 * Covers:
 * - Initial state, loadRuns, createRun, updateRun, deleteRun
 * - getRunById, getRunsForWorkflow, setActiveRunId, clearError
 * - Error handling for 503, 401
 */

import { act } from "@testing-library/react";
import { useWorkflowRunStore } from "../workflow-run-store";
import type {
  WorkflowRun,
  CreateWorkflowRunInput,
  UpdateWorkflowRunInput,
} from "@/types/workflow-run";

// ============================================================================
// Mocks
// ============================================================================

const mockFetch = jest.fn();
const originalFetch = global.fetch;

beforeAll(() => {
  global.fetch = mockFetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

// ============================================================================
// Helpers
// ============================================================================

const initialState = {
  runs: [] as WorkflowRun[],
  isLoading: false,
  error: null as string | null,
  activeRunId: null as string | null,
};

function resetStore() {
  useWorkflowRunStore.setState(initialState);
}

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: `run-${Math.random().toString(36).slice(2, 9)}`,
    workflow_id: "wf-1",
    workflow_name: "Test Workflow",
    status: "completed",
    started_at: new Date(),
    owner_id: "user",
    created_at: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("workflow-run-store", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStore();
  });

  // --------------------------------------------------------------------------
  // initial state
  // --------------------------------------------------------------------------

  describe("initial state", () => {
    it("runs is empty array", () => {
      expect(useWorkflowRunStore.getState().runs).toEqual([]);
    });

    it("isLoading is false", () => {
      expect(useWorkflowRunStore.getState().isLoading).toBe(false);
    });

    it("error is null", () => {
      expect(useWorkflowRunStore.getState().error).toBeNull();
    });

    it("activeRunId is null", () => {
      expect(useWorkflowRunStore.getState().activeRunId).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // loadRuns
  // --------------------------------------------------------------------------

  describe("loadRuns", () => {
    it("sets isLoading during fetch", async () => {
      let resolveFetch!: (v: any) => void;
      const fetchPromise = new Promise<Response>((r) => {
        resolveFetch = (v) => r(v as Response);
      });

      mockFetch.mockReturnValue(fetchPromise);

      const loadPromise = act(async () => {
        await useWorkflowRunStore.getState().loadRuns();
      });

      expect(useWorkflowRunStore.getState().isLoading).toBe(true);

      resolveFetch({
        ok: true,
        json: () => Promise.resolve([]),
      } as any);
      await loadPromise;

      expect(useWorkflowRunStore.getState().isLoading).toBe(false);
    });

    it("stores runs on success", async () => {
      const runs = [
        makeRun({ id: "run-1", workflow_name: "Flow 1" }),
        makeRun({ id: "run-2", workflow_name: "Flow 2" }),
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(runs),
      } as Response);

      await act(async () => {
        await useWorkflowRunStore.getState().loadRuns();
      });

      expect(useWorkflowRunStore.getState().runs).toHaveLength(2);
      expect(useWorkflowRunStore.getState().runs[0].workflow_name).toBe("Flow 1");
    });

    it("passes workflow_id filter", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      } as Response);

      await act(async () => {
        await useWorkflowRunStore.getState().loadRuns({
          workflow_id: "wf-abc",
        });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("workflow_id=wf-abc")
      );
    });

    it("passes status filter", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      } as Response);

      await act(async () => {
        await useWorkflowRunStore.getState().loadRuns({ status: "completed" });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("status=completed")
      );
    });

    it("passes limit filter", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      } as Response);

      await act(async () => {
        await useWorkflowRunStore.getState().loadRuns({ limit: 50 });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=50")
      );
    });

    it("handles 503 - sets empty runs, no error", async () => {
      mockFetch.mockResolvedValue({
        status: 503,
        ok: false,
      } as Response);

      await act(async () => {
        await useWorkflowRunStore.getState().loadRuns();
      });

      expect(useWorkflowRunStore.getState().runs).toEqual([]);
      expect(useWorkflowRunStore.getState().error).toBeNull();
    });

    it("handles error - sets error message", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Server error" }),
      } as Response);

      try {
        await useWorkflowRunStore.getState().loadRuns();
      } catch {
        // loadRuns throws on error - expected
      }

      expect(useWorkflowRunStore.getState().error).toBe("Server error");
    });

    it("throws on error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Failed" }),
      } as Response);

      await expect(
        act(async () => {
          await useWorkflowRunStore.getState().loadRuns();
        })
      ).rejects.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // createRun
  // --------------------------------------------------------------------------

  describe("createRun", () => {
    const createInput: CreateWorkflowRunInput = {
      workflow_id: "wf-1",
      workflow_name: "My Workflow",
      input_prompt: "List my apps",
    };

    it("sends POST request", async () => {
      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u === "/api/workflow-runs" && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ success: true, data: { id: "new-run-123" } }),
          } as Response);
        }
        if (u.includes("/api/workflow-runs") && !init) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                makeRun({ id: "new-run-123", workflow_id: "wf-1" }),
              ]),
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      await act(async () => {
        await useWorkflowRunStore.getState().createRun(createInput);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/workflow-runs",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createInput),
        })
      );
    });

    it("returns run ID", async () => {
      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u === "/api/workflow-runs" && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ success: true, data: { id: "returned-id" } }),
          } as Response);
        }
        if (u.includes("/api/workflow-runs") && !init) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([makeRun({ id: "returned-id" })]),
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      let runId: string | undefined;
      await act(async () => {
        runId = await useWorkflowRunStore.getState().createRun(createInput);
      });

      expect(runId).toBe("returned-id");
    });

    it("sets activeRunId", async () => {
      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u === "/api/workflow-runs" && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ success: true, data: { id: "active-run" } }),
          } as Response);
        }
        if (u.includes("/api/workflow-runs") && !init) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([makeRun({ id: "active-run" })]),
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      await act(async () => {
        await useWorkflowRunStore.getState().createRun(createInput);
      });

      expect(useWorkflowRunStore.getState().activeRunId).toBe("active-run");
    });

    it("reloads runs after creation", async () => {
      let loadCallCount = 0;
      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u === "/api/workflow-runs" && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ success: true, data: { id: "created-1" } }),
          } as Response);
        }
        if (u.includes("/api/workflow-runs") && !init) {
          loadCallCount++;
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                makeRun({ id: "created-1", workflow_name: "Created" }),
              ]),
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      await act(async () => {
        await useWorkflowRunStore.getState().createRun(createInput);
      });

      expect(loadCallCount).toBeGreaterThanOrEqual(1);
      expect(useWorkflowRunStore.getState().runs).toHaveLength(1);
    });

    it("handles 503 error", async () => {
      mockFetch.mockResolvedValue({ status: 503, ok: false } as Response);

      await expect(
        act(async () => {
          await useWorkflowRunStore.getState().createRun(createInput);
        })
      ).rejects.toThrow("MongoDB is required");
    });

    it("handles 401 error", async () => {
      mockFetch.mockResolvedValue({ status: 401, ok: false } as Response);

      await expect(
        act(async () => {
          await useWorkflowRunStore.getState().createRun(createInput);
        })
      ).rejects.toThrow("Please sign in");
    });

    it("throws when no run ID in response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: {} }),
      } as Response);

      await expect(
        act(async () => {
          await useWorkflowRunStore.getState().createRun(createInput);
        })
      ).rejects.toThrow("Failed to get run ID");
    });
  });

  // --------------------------------------------------------------------------
  // updateRun
  // --------------------------------------------------------------------------

  describe("updateRun", () => {
    it("sends PUT request", async () => {
      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("id=run-1") && init?.method === "PUT") {
          return Promise.resolve({ ok: true } as Response);
        }
        if (u.includes("/api/workflow-runs") && !init) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]),
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      const updates: UpdateWorkflowRunInput = {
        status: "completed",
        result_summary: "Done",
      };

      await act(async () => {
        await useWorkflowRunStore.getState().updateRun("run-1", updates);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/workflow-runs?id=run-1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify(updates),
        })
      );
    });

    it("reloads runs after update", async () => {
      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("id=run-1") && init?.method === "PUT") {
          return Promise.resolve({ ok: true } as Response);
        }
        if (u.includes("/api/workflow-runs") && !init) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                makeRun({
                  id: "run-1",
                  status: "completed",
                  result_summary: "Updated",
                }),
              ]),
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      await act(async () => {
        await useWorkflowRunStore
          .getState()
          .updateRun("run-1", { status: "completed" });
      });

      expect(useWorkflowRunStore.getState().runs).toHaveLength(1);
    });

    it("clears activeRunId when status is not running", async () => {
      useWorkflowRunStore.setState({ activeRunId: "run-1" });

      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("id=run-1") && init?.method === "PUT") {
          return Promise.resolve({ ok: true } as Response);
        }
        if (u.includes("/api/workflow-runs") && !init) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                makeRun({ id: "run-1", status: "completed" }),
              ]),
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      await act(async () => {
        await useWorkflowRunStore
          .getState()
          .updateRun("run-1", { status: "completed" });
      });

      expect(useWorkflowRunStore.getState().activeRunId).toBeNull();
    });

    it("keeps activeRunId when status is running", async () => {
      useWorkflowRunStore.setState({ activeRunId: "run-1" });

      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("id=run-1") && init?.method === "PUT") {
          return Promise.resolve({ ok: true } as Response);
        }
        if (u.includes("/api/workflow-runs") && !init) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                makeRun({ id: "run-1", status: "running" }),
              ]),
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      await act(async () => {
        await useWorkflowRunStore
          .getState()
          .updateRun("run-1", { status: "running" });
      });

      expect(useWorkflowRunStore.getState().activeRunId).toBe("run-1");
    });

    it("handles 503, 401 errors", async () => {
      mockFetch.mockResolvedValue({ status: 503, ok: false } as Response);

      await expect(
        act(async () => {
          await useWorkflowRunStore
            .getState()
            .updateRun("run-1", { status: "completed" });
        })
      ).rejects.toThrow("MongoDB is required");

      mockFetch.mockResolvedValue({ status: 401, ok: false } as Response);

      await expect(
        act(async () => {
          await useWorkflowRunStore
            .getState()
            .updateRun("run-1", { status: "completed" });
        })
      ).rejects.toThrow("Please sign in");
    });
  });

  // --------------------------------------------------------------------------
  // deleteRun
  // --------------------------------------------------------------------------

  describe("deleteRun", () => {
    it("removes run from local state", async () => {
      const run1 = makeRun({ id: "del-1" });
      const run2 = makeRun({ id: "keep-1" });
      useWorkflowRunStore.setState({ runs: [run1, run2] });

      mockFetch.mockResolvedValue({ ok: true } as Response);

      await act(async () => {
        await useWorkflowRunStore.getState().deleteRun("del-1");
      });

      expect(useWorkflowRunStore.getState().runs).toHaveLength(1);
      expect(useWorkflowRunStore.getState().runs[0].id).toBe("keep-1");
    });

    it("clears activeRunId if deleted run was active", async () => {
      const run = makeRun({ id: "active-del" });
      useWorkflowRunStore.setState({
        runs: [run],
        activeRunId: "active-del",
      });

      mockFetch.mockResolvedValue({ ok: true } as Response);

      await act(async () => {
        await useWorkflowRunStore.getState().deleteRun("active-del");
      });

      expect(useWorkflowRunStore.getState().activeRunId).toBeNull();
    });

    it("handles 503, 401 errors", async () => {
      useWorkflowRunStore.setState({ runs: [makeRun({ id: "x" })] });
      mockFetch.mockResolvedValue({ status: 503, ok: false } as Response);

      await expect(
        act(async () => {
          await useWorkflowRunStore.getState().deleteRun("x");
        })
      ).rejects.toThrow("MongoDB is required");

      mockFetch.mockResolvedValue({ status: 401, ok: false } as Response);

      await expect(
        act(async () => {
          await useWorkflowRunStore.getState().deleteRun("x");
        })
      ).rejects.toThrow("Please sign in");
    });
  });

  // --------------------------------------------------------------------------
  // getRunById
  // --------------------------------------------------------------------------

  describe("getRunById", () => {
    it("returns run when found", () => {
      const run = makeRun({ id: "found-run", workflow_name: "Found" });
      useWorkflowRunStore.setState({ runs: [run] });

      const result = useWorkflowRunStore.getState().getRunById("found-run");
      expect(result).toBeDefined();
      expect(result?.workflow_name).toBe("Found");
    });

    it("returns undefined when not found", () => {
      const result = useWorkflowRunStore.getState().getRunById("nonexistent");
      expect(result).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // getRunsForWorkflow
  // --------------------------------------------------------------------------

  describe("getRunsForWorkflow", () => {
    it("returns matching runs", () => {
      const r1 = makeRun({ id: "r1", workflow_id: "wf-a" });
      const r2 = makeRun({ id: "r2", workflow_id: "wf-a" });
      const r3 = makeRun({ id: "r3", workflow_id: "wf-b" });
      useWorkflowRunStore.setState({ runs: [r1, r2, r3] });

      const result = useWorkflowRunStore.getState().getRunsForWorkflow("wf-a");
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
    });

    it("returns empty for unknown workflow", () => {
      useWorkflowRunStore.setState({
        runs: [makeRun({ workflow_id: "wf-known" })],
      });

      const result = useWorkflowRunStore.getState().getRunsForWorkflow("wf-unknown");
      expect(result).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // setActiveRunId
  // --------------------------------------------------------------------------

  describe("setActiveRunId", () => {
    it("sets activeRunId", () => {
      act(() => {
        useWorkflowRunStore.getState().setActiveRunId("run-123");
      });
      expect(useWorkflowRunStore.getState().activeRunId).toBe("run-123");
    });
  });

  // --------------------------------------------------------------------------
  // clearError
  // --------------------------------------------------------------------------

  describe("clearError", () => {
    it("clears error to null", () => {
      useWorkflowRunStore.setState({ error: "Some error" });

      act(() => {
        useWorkflowRunStore.getState().clearError();
      });

      expect(useWorkflowRunStore.getState().error).toBeNull();
    });
  });
});
