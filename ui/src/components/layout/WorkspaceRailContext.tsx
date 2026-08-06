"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

interface WorkspaceRailState {
  collapsed: boolean;
  collapsible: boolean;
  toggle: () => void;
}

const WorkspaceRailContext = createContext<WorkspaceRailState>({
  collapsed: false,
  collapsible: false,
  toggle: () => undefined,
});

const WORKSPACE_RAIL_STORAGE_EVENT = "caipe:workspace-rail-storage";
const workspaceRailFallback = new Map<string,boolean>();

export function WorkspaceRailProvider({
  children,
  collapsible,
  storageKey = "workspace-navigation-collapsed",
}: {
  children: React.ReactNode;
  collapsible: boolean;
  storageKey?: string;
}): React.ReactElement {
  const readCollapsed = useCallback((): boolean => {
    if (!collapsible || typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(storageKey) === "true";
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
      return workspaceRailFallback.get(storageKey) ?? false;
    }
  },[collapsible,storageKey]);
  const subscribe = useCallback((onStoreChange: () => void) => {
    if (!collapsible || typeof window === "undefined") return () => undefined;
    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey) onStoreChange();
    };
    const handleLocalStorage = (event: Event) => {
      if (
        event instanceof CustomEvent
        && event.detail === storageKey
      ) onStoreChange();
    };
    window.addEventListener("storage",handleStorage);
    window.addEventListener(WORKSPACE_RAIL_STORAGE_EVENT,handleLocalStorage);
    return () => {
      window.removeEventListener("storage",handleStorage);
      window.removeEventListener(WORKSPACE_RAIL_STORAGE_EVENT,handleLocalStorage);
    };
  },[collapsible,storageKey]);
  const collapsed = useSyncExternalStore(subscribe,readCollapsed,() => false);

  const value = useMemo<WorkspaceRailState>(() => ({
    collapsed,
    collapsible,
    toggle: () => {
      if (!collapsible) return;
      try {
        window.localStorage.setItem(storageKey,String(!collapsed));
      } catch {
        workspaceRailFallback.set(storageKey,!collapsed);
      }
      window.dispatchEvent(new CustomEvent(WORKSPACE_RAIL_STORAGE_EVENT,{
        detail: storageKey,
      }));
    },
  }),[collapsed,collapsible,storageKey]);

  return (
    <WorkspaceRailContext.Provider value={value}>
      {children}
    </WorkspaceRailContext.Provider>
  );
}

export function useWorkspaceRail(): WorkspaceRailState {
  return useContext(WorkspaceRailContext);
}
