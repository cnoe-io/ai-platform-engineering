"use client";

import {
  PERSONAL_SETTINGS_ROUTES,
  PLATFORM_SETTINGS_ROUTES,
  type SettingsRouteDefinition,
} from "@/components/settings/settings-routes";
import { cn } from "@/lib/utils";
import { ChevronDown,Shield } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface SettingsNavigationProps {
  activeRoute: SettingsRouteDefinition;
  isAdmin: boolean;
}

function NavigationGroup({
  activeRoute,
  label,
  routes,
}: {
  activeRoute: SettingsRouteDefinition;
  label: string;
  routes: SettingsRouteDefinition[];
}): React.ReactElement {
  return (
    <div className="space-y-1">
      {label ? (
        <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      ) : null}
      {routes.map((route) => {
        const Icon = route.icon;
        const active = route.id === activeRoute.id;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-primary/12 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            href={route.href}
            key={route.id}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {route.label}
          </Link>
        );
      })}
    </div>
  );
}

export function SettingsNavigation({
  activeRoute,
  isAdmin,
}: SettingsNavigationProps): React.ReactElement {
  const router = useRouter();
  const availableRoutes = isAdmin
    ? [...PERSONAL_SETTINGS_ROUTES,...PLATFORM_SETTINGS_ROUTES]
    : PERSONAL_SETTINGS_ROUTES;

  return (
    <>
      <div className="relative lg:hidden">
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="settings-section">
          Settings section
        </label>
        <select
          className="h-11 w-full appearance-none rounded-lg border border-input bg-background px-3 pr-10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          id="settings-section"
          onChange={(event) => router.push(event.target.value)}
          value={activeRoute.href}
        >
          <optgroup label="Personal">
            {PERSONAL_SETTINGS_ROUTES.map((route) => (
              <option key={route.id} value={route.href}>{route.label}</option>
            ))}
          </optgroup>
          {isAdmin ? (
            <optgroup label="Platform">
              {PLATFORM_SETTINGS_ROUTES.map((route) => (
                <option key={route.id} value={route.href}>{route.label}</option>
              ))}
            </optgroup>
          ) : null}
        </select>
        <ChevronDown className="pointer-events-none absolute bottom-3.5 right-3 h-4 w-4 text-muted-foreground" />
      </div>

      <aside aria-label="Settings sections" className="hidden w-60 shrink-0 lg:block">
        <nav className="sticky top-6 space-y-7">
          <NavigationGroup
            activeRoute={activeRoute}
            label="Personal"
            routes={PERSONAL_SETTINGS_ROUTES}
          />
          {isAdmin ? (
            <div>
              <div className="mb-2 flex items-center gap-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Shield className="h-3 w-3" />
                Platform
              </div>
              <NavigationGroup
                activeRoute={activeRoute}
                label=""
                routes={PLATFORM_SETTINGS_ROUTES}
              />
            </div>
          ) : null}
        </nav>
      </aside>
      <span className="sr-only">{availableRoutes.length} settings sections available</span>
    </>
  );
}
