"use client";

import { useState } from "react";
import { Download, FileCode2, FileText, Globe2, Sparkles } from "lucide-react";

import { BetaBadge } from "@/components/tome/BetaBadge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { PresentationExportDialog } from "@/components/tome/PresentationExportDialog";

const EXPORT_FORMATS = [
  ["pdf", "PDF", "Print-ready document", FileText],
  ["html", "HTML", "Self-contained web page", Globe2],
  ["markdown", "Markdown", "Portable source file", FileCode2],
] as const;

interface Props {
  slug: string;
  /** When present, export only this page; otherwise export the complete wiki. */
  path?: string;
  triggerClassName?: string;
}

export function wikiExportHref(slug: string, format: string, path?: string): string {
  const params = new URLSearchParams({ format });
  if (path) params.set("path", path);
  return `/api/tome/projects/${encodeURIComponent(slug)}/export?${params.toString()}`;
}

/** Shared PDF/HTML/Markdown download menu for complete-wiki and single-page exports. */
export function WikiExportMenu({ slug, path, triggerClassName }: Props) {
  const [open, setOpen] = useState(false);
  const [presentationOpen, setPresentationOpen] = useState(false);
  const pageScoped = Boolean(path);
  const label = pageScoped ? "Export this page" : "Export complete wiki";

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={label}
          aria-label={label}
          className={cn(
            "rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground",
            triggerClassName,
          )}
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-56 p-2">
        <p className="px-2 pb-1.5 text-[11px] font-semibold text-foreground">
          {label}
        </p>
        {EXPORT_FORMATS.map(([format, formatLabel, description, Icon]) => (
          <a
            key={format}
            href={wikiExportHref(slug, format, path)}
            download
            onClick={() => setOpen(false)}
            className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted"
          >
            <Icon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-foreground">{formatLabel}</span>
              <span className="block text-[10px] text-muted-foreground">{description}</span>
            </span>
          </a>
        ))}
        <div className="my-1 border-t" />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPresentationOpen(true);
          }}
          className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
        >
          <Sparkles className="mt-0.5 h-3.5 w-3.5 text-primary" />
          <span>
            <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              Export as presentation
              <BetaBadge />
            </span>
            <span className="block text-[10px] text-muted-foreground">Guide AI, review, and export HTML or editable .pptx</span>
          </span>
        </button>
      </PopoverContent>
      </Popover>
      <PresentationExportDialog
        slug={slug}
        currentPath={path}
        open={presentationOpen}
        onOpenChange={setPresentationOpen}
      />
    </>
  );
}
