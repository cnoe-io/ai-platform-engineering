"use client";

import { ChevronDown } from "lucide-react";
import type React from "react";
import { useId, useState } from "react";

import { cn } from "@/lib/utils";

// assisted-by Codex Codex-sonnet-4-6

interface CollapsiblePanelProps {
  title: string;
  subtitle?: React.ReactNode;
  defaultOpen?: boolean;
  leading?: React.ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  titleClassName?: string;
  children: React.ReactNode;
}

export function CollapsiblePanel({
  title,
  subtitle,
  defaultOpen = true,
  leading,
  className,
  headerClassName,
  contentClassName,
  titleClassName,
  children,
}: CollapsiblePanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const action = open ? "Collapse" : "Expand";

  return (
    <section
      className={cn(
        "rounded-xl border border-border/40 bg-card/35 backdrop-blur-sm transition-colors",
        !open && "bg-card/20",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-3 px-3 py-2.5 sm:px-4",
          open && "border-b border-border/25",
          headerClassName,
        )}
      >
        <div className="flex min-w-0 items-start gap-2">
          {leading && <div className="mt-0.5 shrink-0">{leading}</div>}
          <div className="min-w-0">
            <h2
              className={cn(
                "truncate text-xs font-semibold uppercase tracking-widest text-muted-foreground",
                titleClassName,
              )}
            >
              {title}
            </h2>
            {subtitle && open && (
              <div className="mt-1 text-xs text-muted-foreground/75">{subtitle}</div>
            )}
          </div>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          aria-label={`${action} ${title}`}
          title={`${action} ${title}`}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/50 bg-background/50 px-2 text-[11px] font-medium text-muted-foreground transition hover:bg-background hover:text-foreground"
        >
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
            aria-hidden
          />
          <span className="hidden sm:inline">{open ? "Minimize" : "Show"}</span>
        </button>
      </div>
      {open && (
        <div id={contentId} className={cn("p-3 sm:p-4", contentClassName)}>
          {children}
        </div>
      )}
    </section>
  );
}
