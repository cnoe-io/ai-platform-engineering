import { create } from "zustand";
import type {
  AgentConfig,
  CreateAgentConfigInput,
  UpdateAgentConfigInput,
  AgentConfigCategory,
} from "@/types/agent-config";
import { BUILTIN_QUICK_START_TEMPLATES } from "@/types/agent-config";

/**
 * Agent Config Store
 * 
 * Manages agent configurations for the Agentic Workflows feature.
 * MongoDB-only storage (no localStorage fallback) since Agentic Workflows
 * requires persistent, shareable configurations.
 * 
 * On first load, automatically seeds MongoDB with built-in templates.
 */

interface AgentConfigState {
  configs: AgentConfig[];
  isLoading: boolean;
  error: string | null;
  selectedConfigId: string | null;
  isSeeded: boolean;
  favorites: string[]; // Array of config IDs

  // Actions
  loadConfigs: () => Promise<void>;
  createConfig: (config: CreateAgentConfigInput) => Promise<string>;
  updateConfig: (id: string, updates: UpdateAgentConfigInput) => Promise<void>;
  deleteConfig: (id: string) => Promise<void>;
  selectConfig: (id: string | null) => void;
  getConfigById: (id: string) => AgentConfig | undefined;
  getConfigsByCategory: (category: AgentConfigCategory | string) => AgentConfig[];
  importFromYaml: (yamlContent: string) => Promise<string[]>;
  refreshConfigs: () => Promise<void>;
  seedTemplates: () => Promise<void>;
  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
  getFavoriteConfigs: () => AgentConfig[];
}

// Transform API response to ensure proper date handling
function transformConfig(config: any): AgentConfig {
  return {
    ...config,
    created_at: new Date(config.created_at),
    updated_at: new Date(config.updated_at),
  };
}

// Favorites helpers
const FAVORITES_STORAGE_KEY = "agent-config-favorites";

function loadFavoritesFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error("[AgentConfigStore] Failed to load favorites:", error);
    return [];
  }
}

function saveFavoritesToStorage(favorites: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  } catch (error) {
    console.error("[AgentConfigStore] Failed to save favorites:", error);
  }
}

export const useAgentConfigStore = create<AgentConfigState>()((set, get) => ({
  configs: [],
  isLoading: false,
  error: null,
  selectedConfigId: null,
  isSeeded: false,
  favorites: loadFavoritesFromStorage(),

  /**
   * Seed built-in templates to MongoDB
   */
  seedTemplates: async () => {
    try {
      // Check if seeding is needed
      const checkResponse = await fetch("/api/agent-configs/seed");
      if (!checkResponse.ok) {
        console.log("[AgentConfigStore] Seed check failed, skipping");
        return;
      }
      
      const status = await checkResponse.json();
      if (!status.needsSeeding) {
        console.log("[AgentConfigStore] Templates already seeded");
        set({ isSeeded: true });
        return;
      }
      
      // Perform seeding
      console.log("[AgentConfigStore] Seeding built-in templates...");
      const seedResponse = await fetch("/api/agent-configs/seed", {
        method: "POST",
      });
      
      if (seedResponse.ok) {
        const result = await seedResponse.json();
        console.log(`[AgentConfigStore] Seeded ${result.seeded} templates`);
        set({ isSeeded: true });
      }
    } catch (error) {
      console.log("[AgentConfigStore] Seeding skipped:", error);
    }
  },

  loadConfigs: async () => {
    set({ isLoading: true, error: null });

    try {
      // First, try to seed templates if not already done
      if (!get().isSeeded) {
        await get().seedTemplates();
      }
      
      const response = await fetch("/api/agent-configs");
      
      // Handle 503 (MongoDB not configured) gracefully - use built-in templates
      if (response.status === 503) {
        console.log("[AgentConfigStore] MongoDB not configured, using built-in templates only");
        set({ configs: BUILTIN_QUICK_START_TEMPLATES, isLoading: false });
        return;
      }
      
      // Handle 401 (not authenticated) gracefully - use built-in templates
      if (response.status === 401) {
        console.log("[AgentConfigStore] Not authenticated, using built-in templates only");
        set({ configs: BUILTIN_QUICK_START_TEMPLATES, isLoading: false });
        return;
      }
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to fetch agent configs" }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }
      
      const data = await response.json();
      const transformed = data.map(transformConfig);
      
      // If no configs from MongoDB, fall back to built-in templates
      if (transformed.length === 0) {
        console.log("[AgentConfigStore] No configs in MongoDB, using built-in templates");
        set({ configs: BUILTIN_QUICK_START_TEMPLATES, isLoading: false });
        return;
      }
      
      set({ configs: transformed, isLoading: false });
      console.log(`[AgentConfigStore] Loaded ${transformed.length} agent configs from MongoDB`);
    } catch (error: any) {
      console.error("[AgentConfigStore] Failed to load configs:", error);
      // Fall back to built-in templates
      set({ configs: BUILTIN_QUICK_START_TEMPLATES, isLoading: false });
    }
  },

  createConfig: async (configData) => {
    try {
      const response = await fetch("/api/agent-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configData),
      });

      // Handle 503 (MongoDB not configured)
      if (response.status === 503) {
        throw new Error("MongoDB is required to save custom workflows. Please configure MongoDB.");
      }
      
      // Handle 401 (not authenticated)
      if (response.status === 401) {
        throw new Error("Please sign in to save custom workflows.");
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to create agent config" }));
        throw new Error(error.error || "Failed to create agent config");
      }

      const result = await response.json();
      
      // Reload from server to get the created config
      await get().loadConfigs();
      console.log(`[AgentConfigStore] Created agent config "${configData.name}"`);
      
      return result.id;
    } catch (error: any) {
      console.error("[AgentConfigStore] Failed to create config:", error);
      throw error;
    }
  },

  updateConfig: async (id, updates) => {
    try {
      console.log(`[AgentConfigStore] Updating config ${id} with:`, updates);
      
      const response = await fetch(`/api/agent-configs?id=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      // Handle 503 (MongoDB not configured)
      if (response.status === 503) {
        throw new Error("MongoDB is required to update workflows. Please configure MongoDB.");
      }
      
      // Handle 401 (not authenticated)
      if (response.status === 401) {
        throw new Error("Please sign in to update workflows.");
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to update agent config" }));
        throw new Error(error.error || "Failed to update agent config");
      }

      // Reload from server
      await get().loadConfigs();
      
      // Log the updated config
      const updatedConfig = get().configs.find(c => c.id === id);
      console.log(`[AgentConfigStore] Updated agent config "${id}"`);
      console.log(`[AgentConfigStore] Reloaded config:`, updatedConfig);
    } catch (error: any) {
      console.error("[AgentConfigStore] Failed to update config:", error);
      throw error;
    }
  },

  deleteConfig: async (id) => {
    try {
      const response = await fetch(`/api/agent-configs?id=${id}`, {
        method: "DELETE",
      });

      // Handle 503 (MongoDB not configured)
      if (response.status === 503) {
        throw new Error("MongoDB is required to delete workflows. Please configure MongoDB.");
      }
      
      // Handle 401 (not authenticated)
      if (response.status === 401) {
        throw new Error("Please sign in to delete workflows.");
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Failed to delete agent config" }));
        throw new Error(error.error || "Failed to delete agent config");
      }

      // Reload from server
      await get().loadConfigs();
      
      // Clear selection if deleted config was selected
      if (get().selectedConfigId === id) {
        set({ selectedConfigId: null });
      }
      
      console.log(`[AgentConfigStore] Deleted agent config "${id}"`);
    } catch (error: any) {
      console.error("[AgentConfigStore] Failed to delete config:", error);
      throw error;
    }
  },

  selectConfig: (id) => {
    set({ selectedConfigId: id });
  },

  getConfigById: (id) => {
    return get().configs.find((c) => c.id === id);
  },

  getConfigsByCategory: (category) => {
    return get().configs.filter((c) => c.category === category);
  },

  importFromYaml: async (yamlContent) => {
    // Dynamic import of yaml parser
    const { parse } = await import("yaml");
    
    try {
      const parsed = parse(yamlContent);
      const createdIds: string[] = [];
      
      // Parse the task_config.yaml format
      for (const [name, value] of Object.entries(parsed)) {
        if (typeof value !== "object" || !value || !("tasks" in value)) {
          console.warn(`[AgentConfigStore] Skipping invalid entry: ${name}`);
          continue;
        }
        
        const configValue = value as { tasks: Array<{ display_text: string; llm_prompt: string; subagent: string }> };
        
        // Infer category from name
        let category: AgentConfigCategory | string = "Custom";
        const nameLower = name.toLowerCase();
        if (nameLower.includes("github") || nameLower.includes("repo")) {
          category = "GitHub Operations";
        } else if (nameLower.includes("aws") || nameLower.includes("ec2") || nameLower.includes("eks") || nameLower.includes("s3")) {
          category = "AWS Operations";
        } else if (nameLower.includes("argocd") || nameLower.includes("deploy")) {
          category = "ArgoCD Operations";
        } else if (nameLower.includes("llm") || nameLower.includes("api key") || nameLower.includes("aigateway") || nameLower.includes("spend")) {
          category = "AI Gateway Operations";
        } else if (nameLower.includes("group") || nameLower.includes("user") || nameLower.includes("invite")) {
          category = "Group Management";
        }
        
        // Extract env vars from prompts
        const envVarPattern = /\$\{([A-Z_][A-Z0-9_]*)\}/g;
        const envVars = new Set<string>();
        configValue.tasks.forEach((task) => {
          let match;
          while ((match = envVarPattern.exec(task.llm_prompt)) !== null) {
            envVars.add(match[1]);
          }
        });
        
        const configInput: CreateAgentConfigInput = {
          name,
          description: `Multi-step workflow for: ${name}`,
          category,
          tasks: configValue.tasks.map((task) => ({
            display_text: task.display_text,
            llm_prompt: task.llm_prompt,
            subagent: task.subagent,
          })),
          metadata: {
            env_vars_required: Array.from(envVars),
            schema_version: "1.0",
          },
        };
        
        const id = await get().createConfig(configInput);
        createdIds.push(id);
      }
      
      console.log(`[AgentConfigStore] Imported ${createdIds.length} configs from YAML`);
      return createdIds;
    } catch (error: any) {
      console.error("[AgentConfigStore] Failed to import YAML:", error);
      throw new Error(`Failed to parse YAML: ${error.message}`);
    }
  },

  refreshConfigs: async () => {
    await get().loadConfigs();
  },

  toggleFavorite: (id) => {
    const favorites = get().favorites;
    const newFavorites = favorites.includes(id)
      ? favorites.filter((fid) => fid !== id)
      : [...favorites, id];
    
    saveFavoritesToStorage(newFavorites);
    set({ favorites: newFavorites });
    console.log(`[AgentConfigStore] Toggled favorite: ${id}`);
  },

  isFavorite: (id) => {
    return get().favorites.includes(id);
  },

  getFavoriteConfigs: () => {
    const favorites = get().favorites;
    const configs = get().configs;
    
    // Deduplicate by id (in case there are duplicates)
    const seen = new Set<string>();
    const favoriteConfigs = configs.filter((config) => {
      if (!favorites.includes(config.id)) return false;
      if (seen.has(config.id)) return false;
      seen.add(config.id);
      return true;
    });
    
    return favoriteConfigs;
  },
}));
