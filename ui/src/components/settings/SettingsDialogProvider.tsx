"use client";

import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import {
  DEFAULT_SETTINGS_ROUTE_ID,
  type SettingsRouteId,
} from "@/components/settings/settings-routes";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAdminRole } from "@/hooks/use-admin-role";
import { Settings } from "lucide-react";
import React from "react";

interface SettingsDialogContextValue {
  openSettings: (routeId?: SettingsRouteId) => void;
}

const SettingsDialogContext = React.createContext<SettingsDialogContextValue | null>(null);

export function useSettingsDialog(): SettingsDialogContextValue {
  const context = React.useContext(SettingsDialogContext);
  if (!context) {
    throw new Error("useSettingsDialog must be used within SettingsDialogProvider");
  }
  return context;
}

function SettingsDialogBody({
  activeRouteId,
  onRouteChange,
}: {
  activeRouteId: SettingsRouteId;
  onRouteChange: (routeId: SettingsRouteId) => void;
}): React.ReactElement {
  const { isAdmin } = useAdminRole();
  return (
    <SettingsWorkspace
      activeRouteId={activeRouteId}
      isAdmin={isAdmin}
      onRouteChange={onRouteChange}
    />
  );
}

export function SettingsDialogProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [open,setOpen] = React.useState(false);
  const [activeRouteId,setActiveRouteId] = React.useState<SettingsRouteId>(
    DEFAULT_SETTINGS_ROUTE_ID,
  );

  const openSettings = React.useCallback((routeId = DEFAULT_SETTINGS_ROUTE_ID) => {
    setActiveRouteId(routeId);
    setOpen(true);
  },[]);

  const contextValue = React.useMemo(() => ({ openSettings }),[openSettings]);

  return (
    <SettingsDialogContext.Provider value={contextValue}>
      {children}
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="h-[calc(100dvh-2rem)] max-h-[880px] w-[calc(100vw-2rem)] max-w-6xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0">
          <DialogHeader className="group shrink-0 border-b border-border px-6 py-5 pr-14">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="rounded-xl bg-primary/10 p-2.5 text-primary"
                data-testid="settings-header-icon"
              >
                <Settings className="h-5 w-5 transform-gpu motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-out motion-safe:group-hover:rotate-90" />
              </span>
              <div>
                <DialogTitle className="text-2xl">Settings</DialogTitle>
                <DialogDescription>Manage your experience.</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <SettingsDialogBody
            activeRouteId={activeRouteId}
            onRouteChange={setActiveRouteId}
          />
        </DialogContent>
      </Dialog>
    </SettingsDialogContext.Provider>
  );
}
