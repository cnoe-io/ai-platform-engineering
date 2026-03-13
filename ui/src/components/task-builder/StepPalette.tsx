"use client";

import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, GripVertical, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { getStepTemplates } from "./step-templates";
import { useAgentTools } from "@/hooks/use-agent-tools";
import type { StepTemplate } from "@/types/task-config";

const SUBAGENT_COLORS: Record<string, string> = {
  caipe: "border-l-yellow-500",
  github: "border-l-purple-500",
  jira: "border-l-blue-500",
  webex: "border-l-green-500",
  aws: "border-l-orange-500",
  argocd: "border-l-cyan-500",
  aigateway: "border-l-violet-500",
  backstage: "border-l-purple-400",
  slack: "border-l-pink-500",
  pagerduty: "border-l-emerald-500",
  splunk: "border-l-lime-500",
  komodor: "border-l-teal-500",
  confluence: "border-l-sky-500",
};

interface StepPaletteProps {
  onAddTemplate: (template: StepTemplate) => void;
}

export function StepPalette({ onAddTemplate }: StepPaletteProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const { toolsMap, loading, error, errorMessage, refresh } = useAgentTools();

  const toggleCat = (cat: string) =>
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });

  const availableAgents = useMemo(() => {
    const keys = new Set(Object.keys(toolsMap));
    keys.add("caipe"); // always available
    return keys;
  }, [toolsMap]);

  const filtered = useMemo(() => {
    const base = getStepTemplates().filter((t) => availableAgents.has(t.subagent));
    if (!query.trim()) return base;
    const q = query.toLowerCase();
    return base.filter(
      (t) =>
        t.label.toLowerCase().includes(q) ||
        t.subagent.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.display_text.toLowerCase().includes(q)
    );
  }, [query, availableAgents]);

  const grouped = useMemo(() => {
    return filtered.reduce<Record<string, StepTemplate[]>>((acc, t) => {
      if (!acc[t.category]) acc[t.category] = [];
      acc[t.category].push(t);
      return acc;
    }, {});
  }, [filtered]);

  const handleDragStart = (e: React.DragEvent, template: StepTemplate) => {
    e.dataTransfer.setData("application/step-template", JSON.stringify(template));
    e.dataTransfer.effectAllowed = "move";
  };

  if (collapsed) {
    return (
      <div className="w-10 border-r border-border bg-muted/30 flex flex-col items-center pt-3">
        <button
          onClick={() => setCollapsed(false)}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Expand step palette"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-56 border-r border-border bg-muted/30 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-[10px] font-bold text-foreground uppercase tracking-wider">
          Tools
        </span>
        <div className="flex items-center gap-1">
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : (
            <span className="text-[9px] text-muted-foreground font-mono">
              {filtered.length}
            </span>
          )}
          <button
            onClick={() => setCollapsed(true)}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-border shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools..."
            className={cn(
              "w-full h-7 pl-7 pr-2 rounded-md border border-input bg-background text-xs",
              "placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
            )}
          />
        </div>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5 space-y-0.5 scrollbar-thin">
        {Object.keys(grouped).length === 0 && !loading && (
          <div className="text-xs text-muted-foreground text-center py-6 space-y-2">
            {query ? (
              <p>No tools match &ldquo;{query}&rdquo;</p>
            ) : error ? (
              <>
                <p className="text-destructive">{errorMessage || "Could not load agents"}</p>
                <button onClick={refresh} className="text-primary hover:underline text-xs">
                  Retry
                </button>
              </>
            ) : (
              <p>No agents available. Ensure the supervisor is running.</p>
            )}
          </div>
        )}

        {Object.entries(grouped).map(([category, templates]) => {
          const isCatCollapsed = collapsedCats.has(category);
          return (
            <div key={category}>
              <button
                onClick={() => toggleCat(category)}
                className="w-full flex items-center gap-1 px-1.5 py-1 rounded hover:bg-muted/60 transition-colors"
              >
                <ChevronDown
                  className={cn(
                    "h-3 w-3 text-muted-foreground transition-transform shrink-0",
                    isCatCollapsed && "-rotate-90"
                  )}
                />
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  {category}
                </span>
                <span className="text-[9px] text-muted-foreground/60 font-mono ml-auto">
                  {templates.length}
                </span>
              </button>

              {!isCatCollapsed && (
                <div className="space-y-px mt-px mb-1">
                  {templates.map((t) => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, t)}
                      onClick={() => onAddTemplate(t)}
                      className={cn(
                        "w-full text-left rounded border border-transparent px-2 py-1 transition-all cursor-grab active:cursor-grabbing",
                        "hover:border-primary/30 hover:bg-accent",
                        "border-l-2 flex items-center gap-1.5",
                        SUBAGENT_COLORS[t.subagent] || "border-l-slate-500"
                      )}
                    >
                      <GripVertical className="h-3 w-3 text-muted-foreground/30 shrink-0" />
                      <span className="text-[11px] font-medium text-foreground block truncate">
                        {t.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
