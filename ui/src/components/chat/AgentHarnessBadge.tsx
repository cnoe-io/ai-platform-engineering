"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getHarnessPresentation } from "@/lib/agent-presentation";
import { cn } from "@/lib/utils";
import { Cpu } from "lucide-react";
import Image from "next/image";

interface AgentHarnessBadgeProps {
  harnessId?: string | null;
  compact?: boolean;
  className?: string;
}

export function AgentHarnessBadge({
  harnessId,
  compact = false,
  className,
}: AgentHarnessBadgeProps) {
  const harness = getHarnessPresentation(harnessId);
  const label = `Execution harness: ${harness.label}`;

  return (
    <Tooltip className={cn("inline-flex shrink-0 align-middle", className)}>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          className={cn(
            "inline-flex shrink-0 items-center justify-center",
            compact ? "h-4 w-4" : "h-5 w-5",
          )}
        >
          {harness.logoSrc ? (
            <Image
              src={harness.logoSrc}
              alt=""
              width={20}
              height={20}
              className="h-full w-full object-contain"
              aria-hidden="true"
            />
          ) : (
            <Cpu className="h-full w-full text-muted-foreground" aria-hidden="true" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
