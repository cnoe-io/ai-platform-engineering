"use client";

import { EyeOff, Lightbulb } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

interface SuggestedPromptChipsProps {
  prompts: string[];
  onSelect: (prompt: string) => void;
  initiallyHidden?: boolean;
}

export function SuggestedPromptChips({
  prompts,
  onSelect,
  initiallyHidden = false,
}: SuggestedPromptChipsProps) {
  const [hidden, setHidden] = useState(initiallyHidden);

  if (prompts.length === 0) {
    return null;
  }

  if (hidden) {
    return (
      <div className="flex justify-end px-1">
        <button
          type="button"
          aria-label="Show suggested prompts"
          onClick={() => setHidden(false)}
          className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/5 px-2 py-1 text-[10px] font-medium text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
        >
          <Lightbulb className="h-3 w-3" aria-hidden />
          Suggestions
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-1" aria-label="Suggested prompts">
      <div className="flex justify-end">
        <button
          type="button"
          aria-label="Hide suggested prompts"
          onClick={() => setHidden(true)}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
        >
          <EyeOff className="h-3 w-3" aria-hidden />
          Hide
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onSelect(prompt)}
            className={cn(
              "max-w-full rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5",
              "text-left text-xs font-medium leading-snug text-foreground transition-colors",
              "hover:border-primary/40 hover:bg-primary/10",
            )}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
