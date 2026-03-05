import { create } from "zustand";

interface UnsavedChangesState {
  hasUnsavedChanges: boolean;
  pendingNavigationHref: string | null;

  setUnsaved: (dirty: boolean) => void;
  requestNavigation: (href: string) => void;
  cancelNavigation: () => void;
  confirmNavigation: () => string | null;
}

export const useUnsavedChangesStore = create<UnsavedChangesState>()((set, get) => ({
  hasUnsavedChanges: false,
  pendingNavigationHref: null,

  setUnsaved: (dirty) => set({ hasUnsavedChanges: dirty }),

  requestNavigation: (href) => set({ pendingNavigationHref: href }),

  cancelNavigation: () => set({ pendingNavigationHref: null }),

  confirmNavigation: () => {
    const href = get().pendingNavigationHref;
    set({ hasUnsavedChanges: false, pendingNavigationHref: null });
    return href;
  },
}));
