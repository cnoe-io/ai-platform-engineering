"use client";

import type { ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const PROJECT_VIEW_ONLY_MESSAGE = "Project view only access";

export function ViewOnlyTooltip({
  children,
  viewOnly,
}: {
  children: ReactNode;
  viewOnly: boolean;
}) {
  if (!viewOnly) return children;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        {/* This wrapper receives hover events even when the button disables pointer events. */}
        <TooltipTrigger>{children}</TooltipTrigger>
        <TooltipContent side="top" className="-translate-x-full">
          {PROJECT_VIEW_ONLY_MESSAGE}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
