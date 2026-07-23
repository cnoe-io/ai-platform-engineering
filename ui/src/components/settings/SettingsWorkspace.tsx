"use client";

import { SettingsNavigation } from "@/components/settings/SettingsNavigation";
import {
  DEFAULT_SETTINGS_ROUTE_ID,
  findSettingsRouteById,
  type SettingsRouteDefinition,
  type SettingsRouteId,
} from "@/components/settings/settings-routes";
import { AccessSettings } from "@/components/settings/sections/AccessSettings";
import { AppearanceSettings } from "@/components/settings/sections/AppearanceSettings";
import { ChatSettings } from "@/components/settings/sections/ChatSettings";
import { DeveloperSettings } from "@/components/settings/sections/DeveloperSettings";
import { NotificationsSettings } from "@/components/settings/sections/NotificationsSettings";
import { PlatformAnnouncementsSettings } from "@/components/settings/sections/PlatformAnnouncementsSettings";
import { PlatformDefaultsSettings } from "@/components/settings/sections/PlatformDefaultsSettings";
import { Shield } from "lucide-react";

function SettingsContent({ route }: { route: SettingsRouteDefinition }): React.ReactElement {
  switch (route.id) {
    case "appearance":
      return <AppearanceSettings />;
    case "chat":
      return <ChatSettings />;
    case "notifications":
      return <NotificationsSettings />;
    case "access":
      return <AccessSettings />;
    case "developer":
      return <DeveloperSettings />;
    case "defaults":
      return <PlatformDefaultsSettings />;
    case "announcements":
      return <PlatformAnnouncementsSettings />;
  }
}

export function SettingsWorkspace({
  activeRouteId,
  isAdmin,
  onRouteChange,
}: {
  activeRouteId: SettingsRouteId;
  isAdmin: boolean;
  onRouteChange: (routeId: SettingsRouteId) => void;
}): React.ReactElement {
  const requestedRoute = findSettingsRouteById(activeRouteId);
  const defaultRoute = findSettingsRouteById(DEFAULT_SETTINGS_ROUTE_ID)!;
  const matchedRoute = requestedRoute?.scope === "platform" && !isAdmin
    ? defaultRoute
    : requestedRoute ?? defaultRoute;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="space-y-6 lg:flex lg:items-start lg:gap-8 lg:space-y-0">
        <SettingsNavigation
          activeRoute={matchedRoute}
          isAdmin={isAdmin}
          onSelect={onRouteChange}
        />

        <section className="min-w-0 flex-1 lg:max-w-4xl" aria-labelledby="settings-section-title">
          <div className="mb-6 border-b border-border pb-5">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold" id="settings-section-title">
                {matchedRoute.label}
              </h2>
              {matchedRoute.scope === "platform" ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  <Shield aria-hidden="true" className="h-3 w-3" />
                  Platform · Admins
                </span>
              ) : (
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Personal
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{matchedRoute.description}</p>
          </div>

          <SettingsContent route={matchedRoute} />
        </section>
      </div>
    </div>
  );
}
