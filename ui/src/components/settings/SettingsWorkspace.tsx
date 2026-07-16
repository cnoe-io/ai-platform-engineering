"use client";

import { ReviewConfigsTab } from "@/components/admin/settings/ReviewConfigsTab";
import { SettingsNavigation } from "@/components/settings/SettingsNavigation";
import {
  PERSONAL_SETTINGS_ROUTES,
  findSettingsRoute,
  type SettingsRouteDefinition,
} from "@/components/settings/settings-routes";
import { AccessSettings } from "@/components/settings/sections/AccessSettings";
import { AppearanceSettings } from "@/components/settings/sections/AppearanceSettings";
import { ChatSettings } from "@/components/settings/sections/ChatSettings";
import { DeveloperSettings } from "@/components/settings/sections/DeveloperSettings";
import { NotificationsSettings } from "@/components/settings/sections/NotificationsSettings";
import { PlatformAccessSettings } from "@/components/settings/sections/PlatformAccessSettings";
import { PlatformAnnouncementsSettings } from "@/components/settings/sections/PlatformAnnouncementsSettings";
import { PlatformDefaultsSettings } from "@/components/settings/sections/PlatformDefaultsSettings";
import { useAdminRole } from "@/hooks/use-admin-role";
import { Loader2,Settings,Shield } from "lucide-react";
import { usePathname,useRouter } from "next/navigation";
import { useEffect } from "react";

const DEFAULT_ROUTE = PERSONAL_SETTINGS_ROUTES.find((route) => route.id === "chat")!;

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
    case "platform-defaults":
      return <PlatformDefaultsSettings />;
    case "platform-access":
      return <PlatformAccessSettings />;
    case "platform-announcements":
      return <PlatformAnnouncementsSettings />;
    case "platform-ai-review":
      return <ReviewConfigsTab />;
  }
}

export function SettingsWorkspace(): React.ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const { isAdmin,loading } = useAdminRole();
  const matchedRoute = findSettingsRoute(pathname);
  const unauthorizedPlatformRoute = matchedRoute?.scope === "platform" && !loading && !isAdmin;

  useEffect(() => {
    if (!matchedRoute || unauthorizedPlatformRoute) {
      router.replace(DEFAULT_ROUTE.href);
    }
  }, [matchedRoute,router,unauthorizedPlatformRoute]);

  if (!matchedRoute || unauthorizedPlatformRoute || (matchedRoute.scope === "platform" && loading)) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center" role="status">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Opening settings…</span>
      </main>
    );
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="mb-8 flex items-center gap-3">
          <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <Settings className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage your experience.
            </p>
          </div>
        </header>

        <div className="space-y-6 lg:flex lg:items-start lg:gap-10 lg:space-y-0">
          <SettingsNavigation activeRoute={matchedRoute} isAdmin={isAdmin} />

          <section className="min-w-0 flex-1 lg:max-w-3xl" aria-labelledby="settings-section-title">
            <div className="mb-6 border-b border-border pb-5">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold" id="settings-section-title">{matchedRoute.label}</h2>
                {matchedRoute.scope === "platform" ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    <Shield className="h-3 w-3" />
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
    </main>
  );
}
