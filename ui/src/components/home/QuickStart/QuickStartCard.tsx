"use client";

import { NavigationProgressLink } from "@/components/layout/NavigationProgressLink";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuickStartCard as QuickStartCardData } from "./quickStartCards";

interface QuickStartCardProps {
  card: QuickStartCardData;
}

export function QuickStartCard({ card }: QuickStartCardProps) {
  const Icon = card.icon;

  return (
    <div
      data-testid={`quick-start-card-${card.id}`}
      className="flex flex-col rounded-lg border border-border/50 bg-card/50 p-5"
    >
      <div className="flex items-center gap-3">
        <div
          data-testid={`quick-start-icon-${card.id}`}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm",
            card.iconClassName,
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">{card.title}</h3>
      </div>
      <p className="mt-3 flex-1 text-xs text-muted-foreground">{card.description}</p>
      <div className="mt-4 flex justify-end">
        <Button asChild size="sm" variant="outline">
          <NavigationProgressLink href={card.href} data-testid={`quick-start-cta-${card.id}`}>
            {card.ctaLabel}
          </NavigationProgressLink>
        </Button>
      </div>
    </div>
  );
}
