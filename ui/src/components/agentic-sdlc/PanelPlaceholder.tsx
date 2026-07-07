"use client";

/**
 * Lightweight placeholder card used for panels that are configurable
 * via the chooser but whose real implementation lands in a later
 * wave. Renders inside a CollapsiblePanel so the layout is
 * representative.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import { Sparkles } from "lucide-react";
import { CollapsiblePanel } from "@/components/agentic-sdlc/CollapsiblePanel";
import { getPanel, type PanelId } from "@/lib/agentic-sdlc/panel-registry";

interface PanelPlaceholderProps {
  panelId: PanelId;
}

export function PanelPlaceholder({ panelId }: PanelPlaceholderProps) {
  const panel = getPanel(panelId);
  return (
    <CollapsiblePanel
      title={panel.title}
      leading={<Sparkles className="h-4 w-4 text-primary" aria-hidden />}
      subtitle={panel.description}
      className="glass-panel"
      titleClassName="text-foreground normal-case tracking-normal"
    >
      <div className="flex items-start gap-3 rounded-md border border-dashed border-border/40 bg-background/20 px-3 py-3 text-[11px] text-muted-foreground">
        <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-[9px] font-bold uppercase text-primary">
          Soon
        </span>
        <div>
          <p className="font-semibold text-foreground">{panel.title}</p>
          <p>{panel.description}</p>
          <p className="mt-1 text-muted-foreground/70">
            This panel is opt-in today and renders demo data until live
            signals are connected. Toggle it off any time from the
            chooser at the top of the page.
          </p>
        </div>
      </div>
    </CollapsiblePanel>
  );
}
