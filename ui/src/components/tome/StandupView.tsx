"use client";

import { AlertTriangle, ArrowRight, RefreshCw, Sparkles } from "lucide-react";

import { MarkdownRenderer, renderInlineMarkdown } from "@/components/shared/timeline/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import { PanelShell } from "@/components/tome/PanelHeader";
import { ViewOnlyTooltip } from "@/components/tome/ViewOnlyTooltip";
import { parseStandup } from "@/lib/tome/standup";
import type { GlossaryResolver } from "@/lib/tome/tome-links";

interface Props {
  /** Full frontmatter+body markdown of `standup.md`, or undefined if the
   * project hasn't been ingested yet. */
  markdown: string | undefined;
  onNavigate?: (path: string) => void;
  glossaryPreview?: GlossaryResolver;
  onStartIngest?: () => void;
  /** True for a BHAG/Area, whose primary action is synthesis. */
  isSynthesized?: boolean;
  canEdit?: boolean;
}

/**
 * The Standup surface — `standup.md`'s report card (headline / what's
 * working / blockers / up-next), rewritten by the agent every ingest.
 * Excluded from the ordinary wiki tree (schema.ts `SURFACE_PATHS`); this is
 * its dedicated entry point (nav rail, see TomeWiki).
 */
export function StandupView({
  markdown,
  onNavigate,
  glossaryPreview,
  onStartIngest,
  isSynthesized,
  canEdit = true,
}: Props) {
  if (!markdown) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
        <Sparkles className="h-10 w-10 text-muted-foreground/40" />
        <p className="font-medium">No standup yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          The standup is a report card the agent writes on every{" "}
          {isSynthesized ? "synthesis" : "ingest"}: the headline, what&apos;s
          blocked, and what&apos;s next.{" "}
          {isSynthesized ? "Synthesize this wiki" : "Run an ingest"} to generate one.
        </p>
        {onStartIngest && (
          <ViewOnlyTooltip viewOnly={!canEdit}>
            <Button
              size="sm"
              onClick={onStartIngest}
              className="gap-1.5"
              disabled={!canEdit}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {isSynthesized ? "Start a synthesis" : "Start an ingest"}
            </Button>
          </ViewOnlyTooltip>
        )}
      </div>
    );
  }

  const s = parseStandup(markdown);
  const headline = s.headline.split(/\n+/).find((line) => line.trim())?.trim() ?? "";

  return (
    <PanelShell maxWidthClassName="max-w-3xl">
      <div className="space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          The Standup
        </span>
        {headline ? (
          <h1
            className="text-2xl font-semibold leading-snug"
            dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(headline) }}
          />
        ) : (
          <h1 className="text-2xl font-semibold leading-snug text-muted-foreground">
            No headline yet
          </h1>
        )}
        {s.whatIsThis && (
          <p
            className="text-sm text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(s.whatIsThis) }}
          />
        )}
      </div>

      {s.fallback ? (
        <div className="rounded-lg border bg-muted/20 p-5">
          <MarkdownRenderer
            content={s.fallback}
            variant="final"
            onInternalLink={onNavigate}
            glossaryPreview={glossaryPreview}
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" />
              Asks / Blockers
            </div>
            {s.blockers ? (
              <MarkdownRenderer
                content={s.blockers}
                variant="final"
                onInternalLink={onNavigate}
                glossaryPreview={glossaryPreview}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Nothing blocking right now.</p>
            )}
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <ArrowRight className="h-3.5 w-3.5" />
              Up Next
            </div>
            {s.upNext ? (
              <MarkdownRenderer
                content={s.upNext}
                variant="final"
                onInternalLink={onNavigate}
                glossaryPreview={glossaryPreview}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Nothing planned yet.</p>
            )}
          </div>
        </div>
      )}
    </PanelShell>
  );
}
