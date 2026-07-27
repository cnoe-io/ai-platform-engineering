"use client";

import type { ReactNode } from "react";

import { ScrollArea } from "@/components/ui/scroll-area";

interface PanelHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PanelHeader({ title, description, action }: PanelHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

interface PanelShellProps extends PanelHeaderProps {
  children: ReactNode;
}

/**
 * Shared scaffold for the Tome project tabs (Run ingest, Gists, Insights,
 * Project settings): same scroll behavior, max width, padding, and title
 * styling, so it can't drift per-panel the way it did before.
 */
export function PanelShell({ title, description, action, children }: PanelShellProps) {
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <PanelHeader title={title} description={description} action={action} />
        {children}
      </div>
    </ScrollArea>
  );
}
