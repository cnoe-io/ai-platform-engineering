"use client";

// Small "Beta" tag with a hover tooltip, for features still in testing
// (currently: the Standup report and the Issues/Decisions report — #157).

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function BetaBadge({
  tooltip = "This feature is still in testing.",
}: {
  tooltip?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="h-auto cursor-default gap-1 border-muted-foreground/30 bg-transparent px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground/60"
        >
          Beta
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-64 text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
