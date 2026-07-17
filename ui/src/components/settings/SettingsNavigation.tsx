"use client";

import {
  PERSONAL_SETTINGS_ROUTES,
  PLATFORM_SETTINGS_ROUTES,
  type SettingsRouteDefinition,
} from "@/components/settings/settings-routes";
import { cn } from "@/lib/utils";
import { ChevronDown,Shield,UserRound,type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface SettingsNavigationProps {
  activeRoute: SettingsRouteDefinition;
  isAdmin: boolean;
}

function NavigationGroup({
  activeRoute,
  icon: GroupIcon,
  id,
  label,
  routes,
}: {
  activeRoute: SettingsRouteDefinition;
  icon: LucideIcon;
  id: string;
  label: string;
  routes: SettingsRouteDefinition[];
}): React.ReactElement {
  const headingId = `settings-navigation-${id}`;

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2
        className="flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
        id={headingId}
      >
        <GroupIcon aria-hidden="true" className="h-3 w-3" />
        <span>{label}</span>
      </h2>
      <div className="space-y-1">
        {routes.map((route) => {
          const Icon = route.icon;
          const active = route.id === activeRoute.id;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex min-h-12 items-center gap-3 rounded-xl border px-2.5 py-2 text-sm outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                active
                  ? "settings-navigation-active border-transparent font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border/70 hover:bg-muted/60 hover:text-foreground",
              )}
              href={route.href}
              key={route.id}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                  active
                    ? "gradient-primary-br text-white shadow-sm"
                    : "bg-muted text-muted-foreground group-hover:bg-background group-hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 truncate">{route.label}</span>
            </Link>
          );
        })}
      </div>
    </section>
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
          className="h-12 w-full appearance-none rounded-xl border border-input bg-background px-3 pr-10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute bottom-4 right-3 h-4 w-4 text-muted-foreground" />
      </div>

      <aside className="hidden w-64 shrink-0 lg:block">
        <nav aria-label="Settings sections" className="sticky top-6 space-y-7">
          <NavigationGroup
            activeRoute={activeRoute}
            icon={UserRound}
            id="personal"
            label="Personal"
            routes={PERSONAL_SETTINGS_ROUTES}
          />
          {isAdmin ? (
            <NavigationGroup
              activeRoute={activeRoute}
              icon={Shield}
              id="platform"
              label="Platform"
              routes={PLATFORM_SETTINGS_ROUTES}
            />
          ) : null}
        </nav>
      </aside>
      <span className="sr-only">{availableRoutes.length} settings sections available</span>
    </>
  );
}
