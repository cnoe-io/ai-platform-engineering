"use client";

import { GitCommitHorizontal } from "lucide-react";
import Link from "next/link";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAdminRole } from "@/hooks/use-admin-role";
import { usePlatformHealthProbes } from "@/hooks/use-platform-health-probes";
import { useVersion } from "@/hooks/use-version";
import { formatBuildIdentifier } from "@/lib/build-identifier";
import { cn } from "@/lib/utils";

export function ApplicationVersion({
  collapsed = false,
}: {
  collapsed?: boolean;
}): React.ReactElement {
  const { isAdmin,loading } = useAdminRole();
  const { versionInfo,isLoading } = useVersion();
  const version = formatBuildIdentifier({
    version: versionInfo?.version,
    packageVersion: versionInfo?.packageVersion,
    gitCommit: versionInfo?.gitCommit,
  });

  if (loading || !isAdmin) {
    return <BuildIdentifier collapsed={collapsed} isLoading={isLoading} version={version} />;
  }

  return <AdminApplicationVersion collapsed={collapsed} isLoading={isLoading} version={version} />;
}

function BuildIdentifier({
  collapsed,
  isLoading,
  version,
}: {
  collapsed: boolean;
  isLoading: boolean;
  version: string | null;
}): React.ReactElement {
  const versionLabel = version ? `CAIPE ${version}` : "CAIPE development build";
  const label = isLoading ? "Loading CAIPE build information" : versionLabel;
  const content = (
    <div
      aria-label={label}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        collapsed ? "h-8 w-8 justify-center" : "px-1 py-1.5",
      )}
      data-testid="application-version"
      tabIndex={collapsed ? 0 : undefined}
    >
      <GitCommitHorizontal aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {!collapsed ? (
        <span className="truncate font-medium">{isLoading ? "Loading…" : version ?? "Development"}</span>
      ) : null}
    </div>
  );

  if (!collapsed) return content;

  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function AdminApplicationVersion({
  collapsed,
  isLoading,
  version,
}: {
  collapsed: boolean;
  isLoading: boolean;
  version: string | null;
}): React.ReactElement {
  const health = usePlatformHealthProbes({ diagnostics: false });
  const healthLabel =
    health.status === "healthy"
      ? "healthy"
      : health.status === "degraded"
        ? "degraded"
        : health.status === "down"
          ? "down"
          : "checking";
  const versionLabel = version ? `CAIPE ${version}` : "CAIPE development build";
  const label = `${versionLabel}, platform health ${healthLabel}. Open Admin Health.`;

  const content = (
    <Link
      aria-label={label}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        collapsed ? "h-8 w-8 justify-center" : "px-1 py-1.5",
      )}
      data-testid="application-version"
      href="/admin/operations/health"
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-2 w-2 shrink-0 rounded-full shadow-[0_0_0_3px_hsl(var(--background))]",
          health.status === "healthy" && "bg-emerald-500 shadow-[0_0_0_3px_hsl(var(--background)),0_0_0_4px_rgb(16_185_129_/_0.2)]",
          health.status === "degraded" && "bg-amber-500 shadow-[0_0_0_3px_hsl(var(--background)),0_0_0_4px_rgb(245_158_11_/_0.22)]",
          health.status === "down" && "bg-red-500 shadow-[0_0_0_3px_hsl(var(--background)),0_0_0_4px_rgb(239_68_68_/_0.22)]",
          (health.status === "checking" || isLoading) && "animate-pulse bg-muted-foreground",
        )}
      />
      {!collapsed ? <span className="truncate font-medium">{version ?? "Development"}</span> : null}
    </Link>
  );

  if (!collapsed) return content;

  return (
    <TooltipProvider delayDuration={500}>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
