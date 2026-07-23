"use client";

import { ReportProblemDialog } from "@/components/ticket/ReportProblemDialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getConfig } from "@/lib/config";
import { MessageSquareWarning } from "lucide-react";
import { useState } from "react";

export interface TomeProductFeedbackProps {
  projectSlug?: string;
  pagePath?: string;
  /** ghost icon in toolbars; link as text button in hero sections */
  variant?: "icon" | "link";
  className?: string;
}

/**
 * Entry point for TOME **product** feedback (issue #169): bugs, UX, missing
 * features — not wiki content correctness.
 */
export function TomeProductFeedback({
  projectSlug,
  pagePath,
  variant = "icon",
  className,
}: TomeProductFeedbackProps) {
  const [open, setOpen] = useState(false);
  const enabled =
    getConfig("reportProblemEnabled") && getConfig("ticketEnabled");

  if (!enabled) return null;

  const trigger =
    variant === "link" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
        }
      >
        <MessageSquareWarning className="h-3.5 w-3.5" />
        Report a problem
      </button>
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={
              className ?? "h-8 w-8 text-muted-foreground"
            }
            onClick={() => setOpen(true)}
            aria-label="Report a TOME product problem"
          >
            <MessageSquareWarning className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Report a TOME product problem
        </TooltipContent>
      </Tooltip>
    );

  return (
    <>
      {trigger}
      <ReportProblemDialog
        open={open}
        onOpenChange={setOpen}
        variant="tome-product"
        tomeContext={{ projectSlug, pagePath }}
      />
    </>
  );
}
