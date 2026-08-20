"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useVersion } from "@/hooks/use-version";
import { cn } from "@/lib/utils";

function displayVersion(version: string | undefined): string | null {
  const normalized = version?.trim().replace(/^v/i, "");
  if (!normalized || normalized === "unknown") return null;
  return `v${normalized}`;
}

export function ApplicationVersion({
  collapsed = false,
}: {
  collapsed?: boolean;
}): React.ReactElement {
  const { versionInfo,isLoading } = useVersion();
  const version = displayVersion(versionInfo?.version ?? versionInfo?.packageVersion);
  const label = version ? `CAIPE ${version}` : "CAIPE build version";

  const content = (
    <div
      aria-label={label}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md text-xs text-muted-foreground",
        collapsed ? "h-8 w-8 justify-center" : "px-1 py-1.5",
      )}
      data-testid="application-version"
    >
      <span
        aria-hidden="true"
        className={cn(
          "h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_3px_hsl(var(--background)),0_0_0_4px_rgb(16_185_129_/_0.2)]",
          isLoading && "animate-pulse",
        )}
      />
      {!collapsed ? <span className="truncate font-medium">{version ?? "Development"}</span> : null}
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
