"use client";

import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  /** When set, the crumb is a clickable link back to that level (same page,
   * different view — e.g. back to the Agent tab). */
  onClick?: () => void;
  /** When set, the crumb navigates to a different project's wiki (e.g. up
   * the BHAG/Area hierarchy). Takes precedence over `onClick` if both are set. */
  href?: string;
  /** Optional leading icon (e.g. Target for a BHAG crumb, Layers for Area). */
  icon?: ReactNode;
  /** Text color class that overrides the default muted/foreground styling —
   * e.g. "text-primary" for a BHAG crumb, "text-sky-600 dark:text-sky-400"
   * for an Area crumb — so it keeps its brand color regardless of hover or
   * position in the trail, the same way its icon already does. */
  colorClass?: string;
}

/** Breadcrumb trail for the main pane — shows where you are once a page or
 * ingest view replaces the chat, with each ancestor clickable. Also carries
 * the BHAG → Area → Project hierarchy chain when applicable, so navigating
 * up the tree doesn't require a trip back to the Projects hub. */
export function Breadcrumb({
  items,
  onBeforeNavigate,
}: {
  items: Crumb[];
  /** Return true when the caller intercepted this link navigation. */
  onBeforeNavigate?: (href: string) => boolean;
}) {
  return (
    <nav className="flex min-w-0 items-center gap-1 text-sm">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        // The label span (not the outer flex wrapper) is what actually
        // truncates: `truncate` needs `min-w-0` on the shrinking element
        // itself, and putting it on a multi-child flex box (icon + text)
        // doesn't reliably ellipsis just the text — it can end up wrapping
        // instead. `shrink-0` on the icon keeps it from squishing.
        const content = (
          <>
            {c.icon}
            <span className="min-w-0 truncate">{c.label}</span>
          </>
        );
        return (
          <Fragment key={i}>
            {i > 0 && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            {c.href ? (
              <Link
                href={c.href}
                onClick={(event) => {
                  if (onBeforeNavigate?.(c.href!)) event.preventDefault();
                }}
                className={cn(
                  "inline-flex min-w-0 shrink items-center gap-1 transition-colors",
                  c.colorClass
                    ? cn(c.colorClass, "hover:opacity-80")
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {content}
              </Link>
            ) : c.onClick && !last ? (
              <button
                type="button"
                onClick={c.onClick}
                className={cn(
                  "inline-flex min-w-0 shrink items-center gap-1 transition-colors",
                  c.colorClass
                    ? cn(c.colorClass, "hover:opacity-80")
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {content}
              </button>
            ) : (
              <span
                className={cn(
                  "inline-flex min-w-0 shrink items-center gap-1",
                  c.colorClass ?? (last ? "font-medium text-foreground" : "text-muted-foreground"),
                  last && c.colorClass && "font-medium",
                )}
              >
                {content}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
