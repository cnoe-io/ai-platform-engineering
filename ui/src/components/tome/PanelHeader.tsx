"use client";

import type { ReactNode } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface PanelHeaderProps {
  /** Omit to skip the standard title/description row entirely (e.g. when a
   * panel renders its own bespoke header, like the Standup). */
  title?: string;
  description?: string;
  titleAccessory?: ReactNode;
  action?: ReactNode;
}

export function PanelHeader({
  title,
  description,
  titleAccessory,
  action,
}: PanelHeaderProps) {
  if (!title) return action ? <div className="flex justify-end">{action}</div> : null;
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="flex items-center gap-1.5">
          <h2 className="text-lg font-semibold">{title}</h2>
          {titleAccessory}
        </div>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

interface PanelShellProps extends PanelHeaderProps {
  children: ReactNode;
  /** Overrides the default `max-w-4xl` (e.g. `max-w-3xl`, or `` for a full-width board). */
  maxWidthClassName?: string;
}

/**
 * Shared scaffold for the Tome project tabs (Run ingest, Gists, Insights,
 * Project settings, Standup, Critical items): same scroll behavior, max
 * width, padding, and title styling, so it can't drift per-panel the way it
 * did before.
 */
export function PanelShell({
  title,
  description,
  titleAccessory,
  action,
  maxWidthClassName = "max-w-4xl",
  children,
}: PanelShellProps) {
  return (
    <ScrollArea className="h-full">
      <div className={cn("mx-auto space-y-6 p-6", maxWidthClassName)}>
        <PanelHeader
          title={title}
          description={description}
          titleAccessory={titleAccessory}
          action={action}
        />
        {children}
      </div>
    </ScrollArea>
  );
}
