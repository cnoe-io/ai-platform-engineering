"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const EXPORT_FORMATS = [
  ["pdf", "PDF", "Print-ready document"],
  ["html", "HTML", "Self-contained web page"],
  ["markdown", "Markdown", "Portable source file"],
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
  const pageScoped = Boolean(path);
  const label = pageScoped ? "Export this page" : "Export complete wiki";

  return (
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
        {EXPORT_FORMATS.map(([format, formatLabel, description]) => (
          <a
            key={format}
            href={wikiExportHref(slug, format, path)}
            download
            onClick={() => setOpen(false)}
            className="block rounded px-2 py-1.5 hover:bg-muted"
          >
            <span className="block text-xs font-medium text-foreground">{formatLabel}</span>
            <span className="block text-[10px] text-muted-foreground">{description}</span>
          </a>
        ))}
      </PopoverContent>
    </Popover>
  );
}
