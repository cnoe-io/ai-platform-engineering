"use client";

import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  /** When set, the crumb is a clickable link back to that level. */
  onClick?: () => void;
}

/** Breadcrumb trail for the main pane — shows where you are once a page or
 * ingest view replaces the chat, with each ancestor clickable. */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="flex min-w-0 items-center gap-1 text-sm">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <Fragment key={i}>
            {i > 0 && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            {c.onClick && !last ? (
              <button
                type="button"
                onClick={c.onClick}
                className="truncate text-muted-foreground transition-colors hover:text-foreground"
              >
                {c.label}
              </button>
            ) : (
              <span
                className={cn(
                  "truncate",
                  last ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {c.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
