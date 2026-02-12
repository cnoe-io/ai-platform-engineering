/**
 * @jest-environment jsdom
 */
/**
 * Unit tests for agent-config-store.ts
 *
 * Covers:
 * - Initial state, selectConfig, getConfigById, getConfigsByCategory
 * - loadConfigs: success, 503/401 fallback, seedTemplates, loadFavorites
 * - createConfig, updateConfig, deleteConfig with error handling
 * - Favorites: toggleFavorite, isFavorite, getFavoriteConfigs
 * - seedTemplates
 */

import { act } from "@testing-library/react";
import { useAgentConfigStore } from "../agent-config-store";
import { BUILTIN_QUICK_START_TEMPLATES } from "@/types/agent-config";
import type { AgentConfig, CreateAgentConfigInput } from "@/types/agent-config";

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

function resetStore() {
  useAgentConfigStore.setState({
    configs: [],
    isLoading: false,
    error: null,
    selectedConfigId: null,
    isSeeded: false,
    favorites: [],
    favoritesLoaded: false,
  });
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: `config-${Math.random().toString(36).slice(2, 9)}`,
    name: "Test Config",
    description: "Test description",
    category: "Custom",
    tasks: [
      { display_text: "Step 1", llm_prompt: "Do something", subagent: "caipe" },
    ],
    owner_id: "system",
    is_system: false,
    created_at: new Date("2024-01-01"),
    updated_at: new Date("2024-01-01"),
    ...overrides,
  };
}

/** Setup mocks for loadConfigs to succeed (seed + favorites + agent-configs) */
function mockLoadConfigsSuccess(configs: Array<Record<string, unknown>> = []) {
  const configPayload = configs.map((c) => ({
    ...c,
    created_at:
      c.created_at instanceof Date
        ? c.created_at.toISOString()
        : (c.created_at as string),
    updated_at:
      c.updated_at instanceof Date
        ? c.updated_at.toISOString()
        : (c.updated_at as string),
  }));

  mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u.includes("/api/agent-configs/seed")) {
      if (init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ seeded: 1 }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ needsSeeding: false }),
      } as Response);
    }
    if (u.includes("/api/users/me/favorites")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { favorites: [] } }),
      } as Response);
    }
    if (u === "/api/agent-configs" && !init) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(configPayload),
      } as Response);
    }
    return Promise.reject(new Error(`Unmocked: ${u}`));
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("agent-config-store", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStore();
  });

  // --------------------------------------------------------------------------
  // initial state
  // --------------------------------------------------------------------------

  describe("initial state", () => {
    it("configs is empty array", () => {
      expect(useAgentConfigStore.getState().configs).toEqual([]);
    });

    it("isLoading is false", () => {
      expect(useAgentConfigStore.getState().isLoading).toBe(false);
    });

    it("error is null", () => {
      expect(useAgentConfigStore.getState().error).toBeNull();
    });

    it("selectedConfigId is null", () => {
      expect(useAgentConfigStore.getState().selectedConfigId).toBeNull();
    });

    it("favorites is empty array", () => {
      expect(useAgentConfigStore.getState().favorites).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // selectConfig
  // --------------------------------------------------------------------------

  describe("selectConfig", () => {
    it("sets selectedConfigId", () => {
      act(() => {
        useAgentConfigStore.getState().selectConfig("config-123");
      });
      expect(useAgentConfigStore.getState().selectedConfigId).toBe("config-123");
    });

    it("can set to null", () => {
      act(() => {
        useAgentConfigStore.getState().selectConfig("config-123");
      });
      act(() => {
        useAgentConfigStore.getState().selectConfig(null);
      });
      expect(useAgentConfigStore.getState().selectedConfigId).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // getConfigById
  // --------------------------------------------------------------------------

  describe("getConfigById", () => {
    it("returns config when found", () => {
      const config = makeConfig({ id: "found-id", name: "Found Config" });
      useAgentConfigStore.setState({ configs: [config] });

      const result = useAgentConfigStore.getState().getConfigById("found-id");
      expect(result).toBeDefined();
      expect(result?.name).toBe("Found Config");
    });

    it("returns undefined when not found", () => {
      const result = useAgentConfigStore.getState().getConfigById("nonexistent");
      expect(result).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // getConfigsByCategory
  // --------------------------------------------------------------------------

  describe("getConfigsByCategory", () => {
    it("returns matching configs", () => {
      const c1 = makeConfig({ id: "c1", category: "DevOps" });
      const c2 = makeConfig({ id: "c2", category: "DevOps" });
      const c3 = makeConfig({ id: "c3", category: "Custom" });
      useAgentConfigStore.setState({ configs: [c1, c2, c3] });

      const result = useAgentConfigStore.getState().getConfigsByCategory("DevOps");
      expect(result).toHaveLength(2);
      expect(result.map((c) => c.id)).toContain("c1");
      expect(result.map((c) => c.id)).toContain("c2");
    });

    it("returns empty when no match", () => {
      useAgentConfigStore.setState({
        configs: [makeConfig({ category: "DevOps" })],
      });

      const result = useAgentConfigStore.getState().getConfigsByCategory("Custom");
      expect(result).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // loadConfigs
  // --------------------------------------------------------------------------

  describe("loadConfigs", () => {
    it("sets isLoading during fetch", async () => {
      let resolveSeed!: (v: any) => void;
      const seedPromise = new Promise<Response>((r) => {
        resolveSeed = (v) => r(v as Response);
      });

      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("/api/agent-configs/seed") && init?.method !== "POST") {
          return seedPromise;
        }
        if (u.includes("/api/agent-configs/seed") && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ seeded: 0 }),
          } as Response);
        }
        if (u.includes("/api/users/me/favorites")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: { favorites: [] } }),
          } as Response);
        }
        if (u === "/api/agent-configs") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]),
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      const loadPromise = act(async () => {
        await useAgentConfigStore.getState().loadConfigs();
      });

      // While seed check is pending, isLoading should be true
      expect(useAgentConfigStore.getState().isLoading).toBe(true);

      resolveSeed({
        ok: true,
        json: () => Promise.resolve({ needsSeeding: false }),
      } as any);
      await loadPromise;

      expect(useAgentConfigStore.getState().isLoading).toBe(false);
    });

    it("stores transformed configs on success", async () => {
      const rawConfigs = [
        {
          id: "api-1",
          name: "From API",
          category: "DevOps",
          tasks: [{ display_text: "Step", llm_prompt: "Do it", subagent: "caipe" }],
          owner_id: "user",
          is_system: false,
          created_at: "2024-06-01T00:00:00Z",
          updated_at: "2024-06-01T00:00:00Z",
        },
      ];

      mockLoadConfigsSuccess(rawConfigs);

      await act(async () => {
        await useAgentConfigStore.getState().loadConfigs();
      });

      const configs = useAgentConfigStore.getState().configs;
      expect(configs).toHaveLength(1);
      expect(configs[0].id).toBe("api-1");
      expect(configs[0].created_at).toBeInstanceOf(Date);
      expect(configs[0].updated_at).toBeInstanceOf(Date);
    });

    it("handles 503 - uses BUILTIN_QUICK_START_TEMPLATES", async () => {
      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("/api/agent-configs/seed")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ needsSeeding: false }),
          } as Response);
        }
        if (u.includes("/api/users/me/favorites")) {
          return Promise.resolve({
            status: 503,
            ok: false,
          } as Response);
        }
        if (u === "/api/agent-configs") {
          return Promise.resolve({
            status: 503,
            ok: false,
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      await act(async () => {
        await useAgentConfigStore.getState().loadConfigs();
      });

      expect(useAgentConfigStore.getState().configs).toEqual(
        BUILTIN_QUICK_START_TEMPLATES
      );
    });

    it("handles 401 - uses BUILTIN_QUICK_START_TEMPLATES", async () => {
      mockFetch.mockImplementation((url: string | URL) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("/api/agent-configs/seed")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ needsSeeding: false }),
          } as Response);
        }
        if (u.includes("/api/users/me/favorites")) {
          return Promise.resolve({ status: 401, ok: false } as Response);
        }
        if (u === "/api/agent-configs") {
          return Promise.resolve({ status: 401, ok: false } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      await act(async () => {
        await useAgentConfigStore.getState().loadConfigs();
      });

      expect(useAgentConfigStore.getState().configs).toEqual(
        BUILTIN_QUICK_START_TEMPLATES
      );
    });

    it("handles error - falls back to built-in templates", async () => {
      mockFetch.mockImplementation((url: string | URL) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("/api/agent-configs/seed")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ needsSeeding: false }),
          } as Response);
        }
        if (u.includes("/api/users/me/favorites")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: { favorites: [] } }),
          } as Response);
        }
        if (u === "/api/agent-configs") {
          return Promise.reject(new Error("Network error"));
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      await act(async () => {
        await useAgentConfigStore.getState().loadConfigs();
      });

      expect(useAgentConfigStore.getState().configs).toEqual(
        BUILTIN_QUICK_START_TEMPLATES
      );
    });

    it("calls seedTemplates if not seeded", async () => {
      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("/api/agent-configs/seed")) {
          if (init?.method === "POST") {
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ seeded: 2 }),
            } as Response);
          }
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ needsSeeding: true }),
          } as Response);
        }
        if (u.includes("/api/users/me/favorites")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: { favorites: [] } }),
          } as Response);
        }
        if (u === "/api/agent-configs") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]),
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      await act(async () => {
        await useAgentConfigStore.getState().loadConfigs();
      });

      const seedCalls = mockFetch.mock.calls.filter((call) =>
        String(call[0]).includes("/api/agent-configs/seed")
      );
      expect(seedCalls.length).toBeGreaterThanOrEqual(1);
    });

    it("calls loadFavorites if not loaded", async () => {
      mockLoadConfigsSuccess([]);

      await act(async () => {
        await useAgentConfigStore.getState().loadConfigs();
      });

      const favoritesCalls = mockFetch.mock.calls.filter((call) =>
        String(call[0]).includes("/api/users/me/favorites")
      );
      expect(favoritesCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --------------------------------------------------------------------------
  // createConfig
  // --------------------------------------------------------------------------

  describe("createConfig", () => {
    const createInput: CreateAgentConfigInput = {
      name: "New Workflow",
      description: "A new workflow",
      category: "Custom",
      tasks: [{ display_text: "Step", llm_prompt: "Do it", subagent: "caipe" }],
    };

    it("sends POST request", async () => {
      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u === "/api/agent-configs" && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: "new-id-123" }),
          } as Response);
        }
        if (u === "/api/agent-configs" && !init) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([{ id: "new-id-123", ...createInput, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), owner_id: "user", is_system: false }]),
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      let createdId: string | undefined;
      await act(async () => {
        createdId = await useAgentConfigStore.getState().createConfig(createInput);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/agent-configs",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createInput),
        })
      );
      expect(createdId).toBe("new-id-123");
    });

    it("reloads configs after creation", async () => {
      let callCount = 0;
      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u === "/api/agent-configs" && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: "created-id" }),
          } as Response);
        }
        if (u === "/api/agent-configs" && !init) {
          callCount++;
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  id: "created-id",
                  name: "New",
                  category: "Custom",
                  tasks: [],
                  owner_id: "user",
                  is_system: false,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
              ]),
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      await act(async () => {
        await useAgentConfigStore.getState().createConfig(createInput);
      });

      expect(callCount).toBeGreaterThanOrEqual(1);
      expect(useAgentConfigStore.getState().configs).toHaveLength(1);
    });

    it("handles 503 error", async () => {
      mockFetch.mockResolvedValue({ status: 503, ok: false } as Response);

      await expect(
        act(async () => {
          await useAgentConfigStore.getState().createConfig(createInput);
        })
      ).rejects.toThrow("MongoDB is required");
    });

    it("handles 401 error", async () => {
      mockFetch.mockResolvedValue({ status: 401, ok: false } as Response);

      await expect(
        act(async () => {
          await useAgentConfigStore.getState().createConfig(createInput);
        })
      ).rejects.toThrow("Please sign in");
    });

    it("handles generic error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Server error" }),
      } as Response);

      await expect(
        act(async () => {
          await useAgentConfigStore.getState().createConfig(createInput);
        })
      ).rejects.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // updateConfig
  // --------------------------------------------------------------------------

  describe("updateConfig", () => {
    it("sends PUT request with id in query", async () => {
      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("/api/agent-configs?id=cfg-1") && init?.method === "PUT") {
          return Promise.resolve({ ok: true } as Response);
        }
        if (u === "/api/agent-configs") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]),
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      await act(async () => {
        await useAgentConfigStore
          .getState()
          .updateConfig("cfg-1", { name: "Updated Name" });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/agent-configs?id=cfg-1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ name: "Updated Name" }),
        })
      );
    });

    it("reloads configs after update", async () => {
      mockFetch.mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("id=cfg-1") && init?.method === "PUT") {
          return Promise.resolve({ ok: true } as Response);
        }
        if (u === "/api/agent-configs") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                {
                  id: "cfg-1",
                  name: "Updated",
                  category: "Custom",
                  tasks: [],
                  owner_id: "user",
                  is_system: false,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
              ]),
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      await act(async () => {
        await useAgentConfigStore
          .getState()
          .updateConfig("cfg-1", { name: "Updated" });
      });

      expect(useAgentConfigStore.getState().configs[0]?.name).toBe("Updated");
    });

    it("handles 503, 401 errors", async () => {
      mockFetch.mockResolvedValue({ status: 503, ok: false } as Response);

      await expect(
        act(async () => {
          await useAgentConfigStore
            .getState()
            .updateConfig("cfg-1", { name: "X" });
        })
      ).rejects.toThrow("MongoDB is required");

      mockFetch.mockResolvedValue({ status: 401, ok: false } as Response);

      await expect(
        act(async () => {
          await useAgentConfigStore
            .getState()
            .updateConfig("cfg-1", { name: "X" });
        })
      ).rejects.toThrow("Please sign in");
    });
  });

  // --------------------------------------------------------------------------
  // deleteConfig
  // --------------------------------------------------------------------------

  describe("deleteConfig", () => {
    it("sends DELETE request", async () => {
      mockFetch.mockImplementation((url: string | URL) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("/api/agent-configs?id=del-1")) {
          return Promise.resolve({ ok: true } as Response);
        }
        if (u === "/api/agent-configs") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]),
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      await act(async () => {
        await useAgentConfigStore.getState().deleteConfig("del-1");
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/agent-configs?id=del-1",
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("reloads configs after delete", async () => {
      const remainingConfig = {
        id: "keep-1",
        name: "Remaining",
        category: "Custom",
        tasks: [],
        owner_id: "user",
        is_system: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockFetch.mockImplementation((url: string | URL) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("id=del-1")) {
          return Promise.resolve({ ok: true } as Response);
        }
        if (u === "/api/agent-configs") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([remainingConfig]),
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      await act(async () => {
        await useAgentConfigStore.getState().deleteConfig("del-1");
      });

      // Store reloads from API; when API returns configs, we get them (not built-in templates)
      expect(useAgentConfigStore.getState().configs).toHaveLength(1);
      expect(useAgentConfigStore.getState().configs[0].id).toBe("keep-1");
    });

    it("clears selectedConfigId if deleted config was selected", async () => {
      useAgentConfigStore.setState({ selectedConfigId: "selected-to-delete" });

      mockFetch.mockImplementation((url: string | URL) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("id=selected-to-delete")) {
          return Promise.resolve({ ok: true } as Response);
        }
        if (u === "/api/agent-configs") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([]),
          } as Response);
        }
        return Promise.reject(new Error(`Unmocked: ${u}`));
      });

      await act(async () => {
        await useAgentConfigStore.getState().deleteConfig("selected-to-delete");
      });

      expect(useAgentConfigStore.getState().selectedConfigId).toBeNull();
    });

    it("handles 503, 401 errors", async () => {
      mockFetch.mockResolvedValue({ status: 503, ok: false } as Response);

      await expect(
        act(async () => {
          await useAgentConfigStore.getState().deleteConfig("x");
        })
      ).rejects.toThrow("MongoDB is required");

      mockFetch.mockResolvedValue({ status: 401, ok: false } as Response);

      await expect(
        act(async () => {
          await useAgentConfigStore.getState().deleteConfig("x");
        })
      ).rejects.toThrow("Please sign in");
    });
  });

  // --------------------------------------------------------------------------
  // favorites
  // --------------------------------------------------------------------------

  describe("favorites", () => {
    it("toggleFavorite adds new favorite", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      await act(async () => {
        await useAgentConfigStore.getState().toggleFavorite("fav-1");
      });

      expect(useAgentConfigStore.getState().favorites).toContain("fav-1");
    });

    it("toggleFavorite removes existing favorite", async () => {
      useAgentConfigStore.setState({ favorites: ["fav-1", "fav-2"] });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      await act(async () => {
        await useAgentConfigStore.getState().toggleFavorite("fav-1");
      });

      expect(useAgentConfigStore.getState().favorites).not.toContain("fav-1");
      expect(useAgentConfigStore.getState().favorites).toContain("fav-2");
    });

    it("isFavorite returns true for favorited config", () => {
      useAgentConfigStore.setState({ favorites: ["fav-a"] });

      expect(useAgentConfigStore.getState().isFavorite("fav-a")).toBe(true);
    });

    it("isFavorite returns false for non-favorited", () => {
      expect(useAgentConfigStore.getState().isFavorite("non-fav")).toBe(false);
    });

    it("getFavoriteConfigs returns only favorited configs", () => {
      const c1 = makeConfig({ id: "fav-1", name: "Fav 1" });
      const c2 = makeConfig({ id: "fav-2", name: "Fav 2" });
      const c3 = makeConfig({ id: "not-fav", name: "Not Fav" });
      useAgentConfigStore.setState({
        configs: [c1, c2, c3],
        favorites: ["fav-1", "fav-2"],
      });

      const result = useAgentConfigStore.getState().getFavoriteConfigs();
      expect(result).toHaveLength(2);
      expect(result.map((c) => c.id).sort()).toEqual(["fav-1", "fav-2"]);
    });

    it("getFavoriteConfigs deduplicates", () => {
      const c1 = makeConfig({ id: "dup-id", name: "Dup" });
      useAgentConfigStore.setState({
        configs: [c1],
        favorites: ["dup-id", "dup-id"],
      });

      const result = useAgentConfigStore.getState().getFavoriteConfigs();
      expect(result).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // seedTemplates
  // --------------------------------------------------------------------------

  describe("seedTemplates", () => {
    it("skips POST when GET returns needsSeeding false", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ needsSeeding: false }),
      } as Response);

      await act(async () => {
        await useAgentConfigStore.getState().seedTemplates();
      });

      // Only GET should be called, no POST
      const postCalls = mockFetch.mock.calls.filter(
        (call) => (call[1] as RequestInit)?.method === "POST"
      );
      expect(postCalls).toHaveLength(0);
    });

    it("checks seed status via GET", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ needsSeeding: false }),
      } as Response);

      await act(async () => {
        await useAgentConfigStore.getState().seedTemplates();
      });

      expect(mockFetch).toHaveBeenCalledWith("/api/agent-configs/seed");
    });

    it("seeds via POST when needed", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ needsSeeding: true }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ seeded: 11 }),
        } as Response);

      await act(async () => {
        await useAgentConfigStore.getState().seedTemplates();
      });

      const postCalls = mockFetch.mock.calls.filter(
        (call) => (call[1] as RequestInit)?.method === "POST"
      );
      expect(postCalls.length).toBeGreaterThanOrEqual(1);
      expect(useAgentConfigStore.getState().isSeeded).toBe(true);
    });
  });
});
