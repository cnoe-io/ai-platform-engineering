"use client";

/**
 * SkillTemplatesMenu — searchable list of bundled skill templates.
 *
 * Used in the Workspace toolbar (Files tab) to load a template into the
 * SKILL.md editor. Templates are fetched lazily from `fetchSkillTemplates()`
 * on first open. Selecting a template fires `onSelect(template)` and the
 * caller is responsible for actually applying it to the form (so we don't
 * couple this UI to the form-state plumbing).
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronDown, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fetchSkillTemplates, type SkillTemplate } from "@/skills";

export interface SkillTemplatesMenuProps {
  onSelect: (template: SkillTemplate) => void;
  /** Currently-loaded template id; rendered as "current" badge. */
  selectedId?: string | null;
  /** Override the trigger label. Default: "Templates". */
  triggerLabel?: string;
  className?: string;
}

export function SkillTemplatesMenu({
  onSelect,
  selectedId,
  triggerLabel = "Templates",
  className,
}: SkillTemplatesMenuProps) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<SkillTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  // Whether we've ever attempted a load (so an empty result doesn't trigger
  // a re-fetch loop).
  const loadedRef = useRef(false);

  // Lazy-load on first open
  useEffect(() => {
    if (!open || loadedRef.current || loading) return;
    loadedRef.current = true;
    setLoading(true);
    fetchSkillTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, [open, loading]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.name?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        (t.tags || []).some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [templates, filter]);

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <BookOpen className="h-3.5 w-3.5" />
        {triggerLabel}
        <ChevronDown className="h-3 w-3" />
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-[360px] rounded-md border border-border bg-popover shadow-lg"
        >
          <div className="border-b border-border/50 p-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search templates..."
                className="h-7 pl-7 text-xs"
                autoFocus
              />
            </div>
          </div>
          <ScrollArea className="max-h-[320px] overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading templates…
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                {templates.length === 0
                  ? "No templates available."
                  : "No templates match that filter."}
              </div>
            ) : (
              <ul className="py-1">
                {filtered.map((tpl) => {
                  const isCurrent = selectedId === tpl.id;
                  return (
                    <li key={tpl.id}>
                      <button
                        type="button"
                        role="menuitem"
                        className={cn(
                          "w-full text-left px-3 py-2 text-xs hover:bg-muted/60",
                          isCurrent && "bg-primary/5",
                        )}
                        onClick={() => {
                          onSelect(tpl);
                          setOpen(false);
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">
                            {tpl.name}
                          </span>
                          {isCurrent && (
                            <Badge variant="secondary" className="text-[10px]">
                              Loaded
                            </Badge>
                          )}
                        </div>
                        {tpl.description && (
                          <div className="text-muted-foreground line-clamp-2 mt-0.5">
                            {tpl.description}
                          </div>
                        )}
                        {tpl.tags && tpl.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {tpl.tags.slice(0, 4).map((t) => (
                              <Badge
                                key={t}
                                variant="outline"
                                className="text-[9px] px-1 py-0"
                              >
                                {t}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
