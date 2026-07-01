"use client";

import { type ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Inline glossary term: a subtly-styled reference (dotted underline, italic)
 * that reveals its definition on hover.
 *
 * This is the *presentational* half of the `tome://glossary/<term>` UX (#54) —
 * there's no resolver yet, so the `definition` is passed in directly. When the
 * scheme lands, the same component renders resolved terms; `onOpen` is the hook
 * for click-through to the full glossary entry (#53 navigation).
 */
export function GlossaryTerm({
  children,
  definition,
  onOpen,
  className,
}: {
  /** The term as it appears in prose. */
  children: ReactNode;
  /** Definition shown in the hover popover. */
  definition: ReactNode;
  /** Optional click-through to the full glossary entry (wired later). */
  onOpen?: () => void;
  className?: string;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role={onOpen ? "button" : undefined}
            tabIndex={onOpen ? 0 : undefined}
            onClick={onOpen}
            onKeyDown={
              onOpen
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen();
                    }
                  }
                : undefined
            }
            className={cn(
              "italic underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 transition-colors hover:decoration-foreground",
              onOpen && "cursor-pointer",
              className,
            )}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="w-64 whitespace-normal text-[11px] font-normal normal-case leading-relaxed"
        >
          {definition}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
