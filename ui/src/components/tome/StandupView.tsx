"use client";

import { AlertTriangle, ArrowRight, RefreshCw, Sparkles } from "lucide-react";

import { MarkdownRenderer, renderInlineMarkdown } from "@/components/shared/timeline/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { parseFrontmatter } from "@/lib/tome/schema";
import type { GlossaryResolver } from "@/lib/tome/tome-links";

interface Props {
  /** Full frontmatter+body markdown of `standup.md`, or undefined if the
   * project hasn't been ingested yet. */
  markdown: string | undefined;
  onNavigate?: (path: string) => void;
  glossaryPreview?: GlossaryResolver;
  onStartIngest?: () => void;
}

interface StandupSections {
  whatIsThis: string;
  headline: string;
  blockers: string;
  upNext: string;
}

// INGEST.md's report-card spec: `## What is this` / `## Headline` /
// `## Asks / Blockers` / `## Up next`. Matched case-insensitively with a
// couple of punctuation variants since the agent's exact spacing can drift.
const SECTION_ALIASES: Record<string, keyof StandupSections> = {
  "what is this": "whatIsThis",
  headline: "headline",
  "asks / blockers": "blockers",
  "asks/blockers": "blockers",
  blockers: "blockers",
  "up next": "upNext",
};

function parseStandup(markdown: string): StandupSections {
  const [, body] = parseFrontmatter(markdown);
  const sections: Partial<StandupSections> = {};
  const heading = /^##\s+(.+?)\s*$/gm;
  const matches = [...body.matchAll(heading)];
  for (let i = 0; i < matches.length; i++) {
    const key = SECTION_ALIASES[matches[i][1].trim().toLowerCase()];
    if (!key) continue;
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? body.length : body.length;
    sections[key] = body.slice(start, end).trim();
  }
  return {
    whatIsThis: sections.whatIsThis ?? "",
    headline: sections.headline ?? "",
    blockers: sections.blockers ?? "",
    upNext: sections.upNext ?? "",
  };
}

/**
 * The Standup surface — `standup.md`'s report card (headline / what's
 * working / blockers / up-next), rewritten by the agent every ingest.
 * Excluded from the ordinary wiki tree (schema.ts `SURFACE_PATHS`); this is
 * its dedicated entry point (nav rail, see TomeWiki).
 */
export function StandupView({ markdown, onNavigate, glossaryPreview, onStartIngest }: Props) {
  if (!markdown) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
        <Sparkles className="h-10 w-10 text-muted-foreground/40" />
        <p className="font-medium">No standup yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          The standup is a report card the agent writes on every ingest: the
          headline, what&apos;s blocked, and what&apos;s next. Run an ingest to
          generate one.
        </p>
        {onStartIngest && (
          <Button size="sm" onClick={onStartIngest} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Start an ingest
          </Button>
        )}
      </div>
    );
  }

  const s = parseStandup(markdown);

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto w-full max-w-3xl space-y-6 p-8">
        <div className="space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            The Standup
          </span>
          {s.headline ? (
            <h1
              className="text-2xl font-semibold leading-snug"
              dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(s.headline) }}
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
      </div>
    </ScrollArea>
  );
}
