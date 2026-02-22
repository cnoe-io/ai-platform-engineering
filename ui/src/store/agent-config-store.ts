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
 * Manages agent configurations for the Agent Skills feature.
 * MongoDB-only storage (no localStorage fallback) since Agent Skills
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
  favoritesLoaded: boolean; // Track if favorites have been loaded from MongoDB

  // Actions
  loadConfigs: () => Promise<void>;
  loadFavorites: () => Promise<void>;
  createConfig: (config: CreateAgentConfigInput) => Promise<string>;
  updateConfig: (id: string, updates: UpdateAgentConfigInput) => Promise<void>;
  deleteConfig: (id: string) => Promise<void>;
  selectConfig: (id: string | null) => void;
  getConfigById: (id: string) => AgentConfig | undefined;
  getConfigsByCategory: (category: AgentConfigCategory | string) => AgentConfig[];
  refreshConfigs: () => Promise<void>;
  seedTemplates: () => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
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
const FAVORITES_MIGRATED_KEY = "agent-config-favorites-migrated";

/**
 * Load favorites from localStorage (fallback only)
 */
function loadFavoritesFromLocalStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error("[AgentConfigStore] Failed to load favorites from localStorage:", error);
    return [];
  }
}

/**
 * Save favorites to localStorage (fallback only)
 */
function saveFavoritesToLocalStorage(favorites: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  } catch (error) {
    console.error("[AgentConfigStore] Failed to save favorites to localStorage:", error);
  }
}

/**
 * Load favorites from MongoDB
 */
async function loadFavoritesFromMongoDB(): Promise<string[]> {
  try {
    const response = await fetch("/api/users/me/favorites");
    
    // Handle 503 (MongoDB not configured) - use localStorage
    if (response.status === 503) {
      console.log("[AgentConfigStore] MongoDB not configured, using localStorage for favorites");
      return loadFavoritesFromLocalStorage();
    }
    
    // Handle 401 (not authenticated) - use localStorage
    if (response.status === 401) {
      console.log("[AgentConfigStore] Not authenticated, using localStorage for favorites");
      return loadFavoritesFromLocalStorage();
    }
    
    if (!response.ok) {
      throw new Error(`Failed to load favorites: ${response.status}`);
    }
    
    const result = await response.json();
    // API returns { success: true, data: { favorites: [...] } }
    const favorites = result.data?.favorites || [];
    console.log(`[AgentConfigStore] Loaded ${favorites.length} favorites from MongoDB`);
    return favorites;
  } catch (error) {
    console.error("[AgentConfigStore] Failed to load favorites from MongoDB:", error);
    // Fallback to localStorage
    return loadFavoritesFromLocalStorage();
  }
}

/**
 * Save favorites to MongoDB
 */
async function saveFavoritesToMongoDB(favorites: string[]): Promise<boolean> {
  try {
    const response = await fetch("/api/users/me/favorites", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorites }),
    });
    
    // Handle 503 (MongoDB not configured) - use localStorage
    if (response.status === 503) {
      console.log("[AgentConfigStore] MongoDB not configured, using localStorage for favorites");
      saveFavoritesToLocalStorage(favorites);
      return false;
    }
    
    // Handle 401 (not authenticated) - use localStorage
    if (response.status === 401) {
      console.log("[AgentConfigStore] Not authenticated, using localStorage for favorites");
      saveFavoritesToLocalStorage(favorites);
      return false;
    }
    
    if (!response.ok) {
      throw new Error(`Failed to save favorites: ${response.status}`);
    }
    
    console.log(`[AgentConfigStore] Saved ${favorites.length} favorites to MongoDB`);
    return true;
  } catch (error) {
    console.error("[AgentConfigStore] Failed to save favorites to MongoDB:", error);
    // Fallback to localStorage
    saveFavoritesToLocalStorage(favorites);
    return false;
  }
}

/**
 * Migrate favorites from localStorage to MongoDB (one-time)
 */
async function migrateFavoritesToMongoDB(): Promise<void> {
  if (typeof window === "undefined") return;
  
  // Check if already migrated
  const alreadyMigrated = localStorage.getItem(FAVORITES_MIGRATED_KEY);
  if (alreadyMigrated) {
    return;
  }
  
  // Get favorites from localStorage
  const localFavorites = loadFavoritesFromLocalStorage();
  
  if (localFavorites.length === 0) {
    // No favorites to migrate, mark as migrated
    localStorage.setItem(FAVORITES_MIGRATED_KEY, "true");
    return;
  }
  
  console.log(`[AgentConfigStore] Migrating ${localFavorites.length} favorites from localStorage to MongoDB...`);
  
  // Save to MongoDB
  const success = await saveFavoritesToMongoDB(localFavorites);
  
  if (success) {
    // Mark as migrated
    localStorage.setItem(FAVORITES_MIGRATED_KEY, "true");
    console.log(`[AgentConfigStore] Successfully migrated ${localFavorites.length} favorites to MongoDB`);
  }
}

export const useAgentConfigStore = create<AgentConfigState>()((set, get) => ({
  configs: [],
  isLoading: false,
  error: null,
  selectedConfigId: null,
  isSeeded: false,
  favorites: [], // Will be loaded from MongoDB
  favoritesLoaded: false,

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

  loadFavorites: async () => {
    // Migrate favorites from localStorage to MongoDB (one-time)
    await migrateFavoritesToMongoDB();
    
    // Load favorites from MongoDB
    const favorites = await loadFavoritesFromMongoDB();
    set({ favorites, favoritesLoaded: true });
    console.log(`[AgentConfigStore] Loaded ${favorites.length} favorites`);
  },

  loadConfigs: async () => {
    set({ isLoading: true, error: null });

    try {
      // First, try to seed templates if not already done
      if (!get().isSeeded) {
        await get().seedTemplates();
      }
      
      // Load favorites if not already loaded
      if (!get().favoritesLoaded) {
        await get().loadFavorites();
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

  refreshConfigs: async () => {
    await get().loadConfigs();
  },

  toggleFavorite: async (id) => {
    const favorites = get().favorites;
    const newFavorites = favorites.includes(id)
      ? favorites.filter((fid) => fid !== id)
      : [...favorites, id];
    
    // Optimistically update UI
    set({ favorites: newFavorites });
    console.log(`[AgentConfigStore] Toggled favorite: ${id} (${newFavorites.length} total)`);
    
    // Save to MongoDB (fallback to localStorage if MongoDB fails)
    await saveFavoritesToMongoDB(newFavorites);
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
