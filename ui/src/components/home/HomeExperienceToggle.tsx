"use client";

import { ArrowLeftRight } from "lucide-react";

interface HomeExperienceToggleProps {
  label: string;
  onClick: () => void;
  testId: string;
}

/** Small link used by both Home layouts to switch to the other one. */
export function HomeExperienceToggle({ label, onClick, testId }: HomeExperienceToggleProps) {
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftRight className="h-3 w-3" />
        {label}
      </button>
    </div>
  );
}
