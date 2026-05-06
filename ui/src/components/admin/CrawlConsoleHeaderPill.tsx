"use client";

/**
 * Compact status pill for the admin header that surfaces the
 * current state of the global Crawl Console.
 *
 * Three reasons this is its own component:
 *
 *   1. The pill needs to render IN ADDITION to the dialog -- it's
 *      the always-visible reminder that crawls are running.
 *      Putting both in one component would couple the dialog's
 *      open/close state to the header's render, which forces
 *      the entire dialog tree to re-render on every header tick.
 *
 *   2. The header already lives at the top of the page; the
 *      dialog is a portal. Keeping them separate means the
 *      dialog's portal target doesn't need to live underneath
 *      the header DOM subtree.
 *
 *   3. The pill is conditionally rendered: hidden when no runs
 *      have happened yet, ghost when only finished runs exist,
 *      pulse when at least one run is in flight. Bundling the
 *      logic with the dialog would hurt readability.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Activity } from "lucide-react";
import {
  useCrawlConsoleStore,
  selectRunningCount,
} from "@/store/crawl-console-store";

export function CrawlConsoleHeaderPill() {
  const runs = useCrawlConsoleStore((s) => s.runs);
  const open = useCrawlConsoleStore((s) => s.open);
  const isOpen = useCrawlConsoleStore((s) => s.isOpen);
  const running = useCrawlConsoleStore(selectRunningCount);

  // Hide the pill entirely when nothing has happened yet -- the
  // alternative is a permanently-visible "0 crawls" pill, which
  // is just visual noise on a page that already has a lot of
  // header chrome.
  if (runs.length === 0) return null;

  const finished = runs.length - running;
  const label =
    running > 0
      ? `${running} crawl${running === 1 ? "" : "s"} running`
      : `${finished} recent crawl${finished === 1 ? "" : "s"}`;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={open}
      aria-label="Open Crawl Console"
      aria-expanded={isOpen}
      className={cn(
        "gap-1.5 text-xs h-7",
        running > 0 &&
          "border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-200",
      )}
      data-testid="crawl-console-header-pill"
    >
      <Activity
        className={cn(
          "h-3 w-3",
          running > 0 && "animate-pulse",
        )}
      />
      {label}
    </Button>
  );
}
