"use client";

import { ListFilter } from "lucide-react";

import type { TomeTrackedIssueLabel } from "@/lib/tome/issue-filter-views";
import { cn } from "@/lib/utils";

interface IssueLabelViewListProps {
  labels: readonly TomeTrackedIssueLabel[];
  activeLabel?: string;
  onSelect: (label: string) => void;
}

export function IssueLabelViewList({
  labels,
  activeLabel,
  onSelect,
}: IssueLabelViewListProps) {
  return (
    <div className="flex flex-col gap-0.5">
      {labels.map((tracked) => {
        const active = activeLabel?.toLowerCase() === tracked.label;
        return (
          <button
            key={tracked.id}
            type="button"
            data-issue-label-view={tracked.label}
            aria-label={tracked.title}
            onClick={() => onSelect(tracked.label)}
            className={cn(
              "ml-5 flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
              active && "bg-muted font-medium text-primary",
            )}
          >
            <ListFilter className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">
              <span className="block truncate">{tracked.title}</span>
              <code className="block truncate font-mono text-[10px] font-normal text-muted-foreground">
                {tracked.label}
              </code>
            </span>
          </button>
        );
      })}
    </div>
  );
}
