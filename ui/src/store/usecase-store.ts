import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { UseCase } from "@/types/a2a";
import { getStorageMode, shouldUseLocalStorage } from "@/lib/storage-config";

interface UseCaseState {
  useCases: UseCase[];
  isLoading: boolean;
  error: string | null;

  // Actions
  loadUseCases: () => Promise<void>;
  createUseCase: (useCase: Omit<UseCase, "id" | "createdAt">) => Promise<string>;
  updateUseCase: (id: string, updates: Partial<UseCase>) => Promise<void>;
  deleteUseCase: (id: string) => Promise<void>;
  refreshUseCases: () => Promise<void>;
}

// Transform API response to UseCase format
function transformUseCase(uc: any): UseCase {
  const category = uc.category || "Custom";
  const tags = Array.isArray(uc.tags) ? uc.tags : [];
  const finalTags = tags.includes(category) ? tags : [...tags, category];

  return {
    ...uc,
    thumbnail: uc.thumbnail || "Sparkles",
    category,
    tags: finalTags,
    expectedAgents: Array.isArray(uc.expectedAgents) ? uc.expectedAgents : [],
  };
}

// Create store with conditional persistence
const storeImplementation = (set: any, get: any): UseCaseState => ({
  useCases: [],
  isLoading: false,
  error: null,

  loadUseCases: async () => {
    const storageMode = getStorageMode();
    set({ isLoading: true, error: null });

    try {
      if (storageMode === "mongodb") {
        // MongoDB mode: Fetch from API
        const response = await fetch("/api/usecases");
        if (!response.ok) {
          throw new Error("Failed to fetch use cases");
        }
        const data = await response.json();
        const transformed = data.map(transformUseCase);
        set({ useCases: transformed, isLoading: false });
        console.log(`[UseCaseStore] Loaded ${transformed.length} use cases from MongoDB`);
      } else {
        // localStorage mode: Zustand persist middleware automatically loads from localStorage
        // Just mark as loaded (state is already loaded by persist middleware)
        const state = get();
        set({ isLoading: false });
        console.log(`[UseCaseStore] Using ${state.useCases.length} use cases from localStorage`);
      }
    } catch (error: any) {
      console.error("[UseCaseStore] Failed to load use cases:", error);
      set({ error: error.message, isLoading: false });
    }
  },

  createUseCase: async (useCaseData) => {
    const storageMode = getStorageMode();
    const id = `usecase-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newUseCase: UseCase = {
      ...useCaseData,
      id,
      createdAt: new Date().toISOString(),
    };

    try {
      if (storageMode === "mongodb") {
        // MongoDB mode: Create on server
        const response = await fetch("/api/usecases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: useCaseData.title,
            description: useCaseData.description,
            category: useCaseData.category,
            tags: useCaseData.tags,
            prompt: useCaseData.prompt,
            expectedAgents: useCaseData.expectedAgents,
            difficulty: useCaseData.difficulty,
          }),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: "Failed to create use case" }));
          throw new Error(error.error || "Failed to create use case");
        }

        // Reload from server to get the created use case
        await get().loadUseCases();
        console.log(`[UseCaseStore] Created use case "${useCaseData.title}" in MongoDB`);
      } else {
        // localStorage mode: Add to local state (persisted via Zustand)
        set((state: UseCaseState) => ({
          useCases: [transformUseCase(newUseCase), ...state.useCases],
        }));
        console.log(`[UseCaseStore] Created use case "${useCaseData.title}" in localStorage`);
      }

      return id;
    } catch (error: any) {
      console.error("[UseCaseStore] Failed to create use case:", error);
      throw error;
    }
  },

  updateUseCase: async (id, updates) => {
    const storageMode = getStorageMode();

    try {
      if (storageMode === "mongodb") {
        // MongoDB mode: Update on server
        const response = await fetch(`/api/usecases?id=${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: "Failed to update use case" }));
          throw new Error(error.error || "Failed to update use case");
        }

        // Reload from server
        await get().loadUseCases();
        console.log(`[UseCaseStore] Updated use case "${id}" in MongoDB`);
      } else {
        // localStorage mode: Update local state
        set((state: UseCaseState) => ({
          useCases: state.useCases.map((uc) =>
            uc.id === id
              ? transformUseCase({ ...uc, ...updates, updatedAt: new Date().toISOString() })
              : uc
          ),
        }));
        console.log(`[UseCaseStore] Updated use case "${id}" in localStorage`);
      }
    } catch (error: any) {
      console.error("[UseCaseStore] Failed to update use case:", error);
      throw error;
    }
  },

  deleteUseCase: async (id) => {
    const storageMode = getStorageMode();

    try {
      if (storageMode === "mongodb") {
        // MongoDB mode: Delete on server
        const response = await fetch(`/api/usecases?id=${id}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: "Failed to delete use case" }));
          throw new Error(error.error || "Failed to delete use case");
        }

        // Reload from server
        await get().loadUseCases();
        console.log(`[UseCaseStore] Deleted use case "${id}" from MongoDB`);
      } else {
        // localStorage mode: Remove from local state
        set((state: UseCaseState) => ({
          useCases: state.useCases.filter((uc) => uc.id !== id),
        }));
        console.log(`[UseCaseStore] Deleted use case "${id}" from localStorage`);
      }
    } catch (error: any) {
      console.error("[UseCaseStore] Failed to delete use case:", error);
      throw error;
    }
  },

  refreshUseCases: async () => {
    await get().loadUseCases();
  },
});

// Create store with conditional persistence
export const useUseCaseStore = create<UseCaseState>()(
  shouldUseLocalStorage()
    ? persist(storeImplementation, {
        name: "caipe-usecases",
        storage: createJSONStorage(() => localStorage),
      })
    : storeImplementation
);
