"use client";

import { ArrowLeftRight } from "lucide-react";

interface HomeExperienceToggleProps {
  label: string;
  ariaLabel?: string;
  onClick: () => void;
  testId: string;
}

/** Small link used by both Home layouts to switch to the other one. */
export function HomeExperienceToggle({
  label,
  ariaLabel = label,
  onClick,
  testId,
}: HomeExperienceToggleProps) {
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        title={ariaLabel}
        data-testid={testId}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-transparent px-2 text-[11px] font-medium tracking-tight text-muted-foreground/70 transition-colors hover:border-border/40 hover:bg-muted/30 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <ArrowLeftRight className="h-3 w-3" />
        {label}
      </button>
    </div>
  );
}
