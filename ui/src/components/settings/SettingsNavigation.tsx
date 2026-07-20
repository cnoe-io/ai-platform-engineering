"use client";

import {
  PERSONAL_SETTINGS_ROUTES,
  PLATFORM_SETTINGS_ROUTES,
  type SettingsRouteDefinition,
  type SettingsRouteId,
} from "@/components/settings/settings-routes";
import {
  WorkspaceSectionNavigation,
  type WorkspaceNavigationGroup,
} from "@/components/layout/WorkspaceNavigation";
import { Shield,UserRound } from "lucide-react";

interface SettingsNavigationProps {
  activeRoute: SettingsRouteDefinition;
  isAdmin: boolean;
  onSelect: (routeId: SettingsRouteId) => void;
}

export function SettingsNavigation({
  activeRoute,
  isAdmin,
  onSelect,
}: SettingsNavigationProps): React.ReactElement {
  const groups: WorkspaceNavigationGroup[] = [
    {
      id: "personal",
      label: "Personal",
      icon: UserRound,
      items: PERSONAL_SETTINGS_ROUTES.map((route) => ({
        ...route,
        onSelect: () => onSelect(route.id),
      })),
    },
    ...(isAdmin ? [{
      id: "platform",
      label: "Platform settings",
      icon: Shield,
      items: PLATFORM_SETTINGS_ROUTES.map((route) => ({
        ...route,
        onSelect: () => onSelect(route.id),
      })),
    }] : []),
  ];

  return (
    <>
      <WorkspaceSectionNavigation
        activeItemId={activeRoute.id}
        groups={groups}
        navigationLabel="Settings sections"
        pickerLabel="Settings section"
      />
      <span className="sr-only">
        {groups.reduce((count,group) => count + group.items.length,0)} settings sections available
      </span>
    </>
  );
}
