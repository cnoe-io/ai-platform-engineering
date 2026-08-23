"use client";

import { AdminNavigation } from "@/components/admin/workspace/AdminNavigation";
import {
  filterAdminCategories,
  findAdminDestinationByPath,
} from "@/components/admin/workspace/admin-routes";
import { CREDENTIALS_GROUPS } from "@/components/credentials/navigation";
import {
  buildDynamicAgentNavigationGroups,
  type DynamicAgentNavigationTab,
} from "@/components/dynamic-agents/navigation";
import { WorkspaceNavigationList } from "@/components/layout/WorkspaceNavigation";
import { KnowledgeSidebar } from "@/components/rag/KnowledgeSidebar";
import { SettingsNavigation } from "@/components/settings/SettingsNavigation";
import {
  DEFAULT_SETTINGS_ROUTE_ID,
  findSettingsRouteById,
  findSettingsRouteBySegment,
} from "@/components/settings/settings-routes";
import { useRAGHealth } from "@/hooks/use-rag-health";
import { config } from "@/lib/config";
import type { AdminTabGatesMap } from "@/lib/rbac/types";
import { usePathname,useSearchParams } from "next/navigation";
import type React from "react";

export const APPLICATION_SECTION_AREA_KEYS = new Set([
  "knowledge",
  "dynamic-agents",
  "credentials",
  "admin",
  "settings",
]);

function DynamicAgentsApplicationNavigation({
  adminGates,
}: {
  adminGates: AdminTabGatesMap;
}): React.ReactElement {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const groups = buildDynamicAgentNavigationGroups({
    destinationForTab: (tab: DynamicAgentNavigationTab) => ({
      href: `/dynamic-agents?tab=${tab}`,
    }),
    showConversations: Boolean(adminGates.dynamic_agent_conversations),
  });

  return (
    <WorkspaceNavigationList
      activeItemId={
        pathname?.startsWith("/dynamic-agents")
          ? searchParams.get("tab") ?? "agents"
          : ""
      }
      ariaLabel="Agent sections"
      groups={groups}
    />
  );
}

function KnowledgeApplicationNavigation(): React.ReactElement {
  const { graphRagEnabled,status } = useRAGHealth();
  return (
    <KnowledgeSidebar
      graphRagEnabled={status === "connected" && graphRagEnabled}
    />
  );
}

function AdminApplicationNavigation({
  adminGates,
  adminGatesLoading,
  isAdmin,
}: {
  adminGates: AdminTabGatesMap;
  adminGatesLoading: boolean;
  isAdmin: boolean;
}): React.ReactElement | null {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (adminGatesLoading) return null;

  const categories = filterAdminCategories({
    ...adminGates,
    platform_settings: isAdmin,
    feedback: Boolean(adminGates.feedback && config.feedbackEnabled),
    audit_logs: Boolean(adminGates.audit_logs && config.auditLogsEnabled),
    credentials: Boolean(adminGates.credentials && config.credentialsEnabled),
    agents: isAdmin,
    mcp: isAdmin,
    identity_sync: Boolean(adminGates.identity_group_sync && config.oktaSyncEnabled),
  });
  const visibleDestinations = categories.flatMap(
    (category) => category.destinations,
  );
  const requestedDestination = findAdminDestinationByPath(pathname);
  const activeDestination = requestedDestination && visibleDestinations.some(
    (destination) => destination.id === requestedDestination.id,
  )
    ? requestedDestination
    : visibleDestinations[0];

  return categories.length > 0 ? (
    <AdminNavigation
      activeDestination={activeDestination}
      categories={categories}
      searchParams={new URLSearchParams(searchParams.toString())}
    />
  ) : null;
}

function SettingsApplicationNavigation(): React.ReactElement {
  const pathname = usePathname();
  const section = pathname?.split("/")[2];
  const activeRoute = pathname?.startsWith("/settings/")
    ? findSettingsRouteBySegment(section)
      ?? findSettingsRouteById(DEFAULT_SETTINGS_ROUTE_ID)
    : undefined;

  return <SettingsNavigation activeRoute={activeRoute} />;
}

export function ApplicationSectionNavigation({
  adminGates,
  adminGatesLoading,
  areaKey,
  isAdmin,
}: {
  adminGates: AdminTabGatesMap;
  adminGatesLoading: boolean;
  areaKey: string;
  isAdmin: boolean;
}): React.ReactElement | null {
  if (areaKey === "knowledge") return <KnowledgeApplicationNavigation />;
  if (areaKey === "dynamic-agents") {
    return <DynamicAgentsApplicationNavigation adminGates={adminGates} />;
  }
  if (areaKey === "credentials") {
    return (
      <WorkspaceNavigationList
        activeItemId=""
        ariaLabel="Credentials sections"
        groups={CREDENTIALS_GROUPS}
      />
    );
  }
  if (areaKey === "admin") {
    return (
      <AdminApplicationNavigation
        adminGates={adminGates}
        adminGatesLoading={adminGatesLoading}
        isAdmin={isAdmin}
      />
    );
  }
  if (areaKey === "settings") return <SettingsApplicationNavigation />;
  return null;
}
