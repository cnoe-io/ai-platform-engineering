"use client";

import { Info } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RUBRIC_DEFINITIONS } from "@/lib/tome/rubric-definitions";
import type { TomeRubricId } from "@/types/tome-evaluation";

interface RubricInfoProps {
  rubricId: TomeRubricId;
}

interface InfoTooltipProps {
  label: string;
  description: string;
}

export function InfoTooltip({ label, description }: InfoTooltipProps) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`About ${label}`}
            className="inline-flex rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs whitespace-normal text-left leading-relaxed">
          <p className="font-medium text-foreground">{label}</p>
          <p>{description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function RubricInfo({ rubricId }: RubricInfoProps) {
  const definition = RUBRIC_DEFINITIONS[rubricId];
  return <InfoTooltip label={definition.label} description={definition.description} />;
}
