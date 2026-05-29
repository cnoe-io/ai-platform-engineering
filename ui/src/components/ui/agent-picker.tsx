"use client";

import * as React from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface AgentPickerOption {
  value: string;
  label?: string;
  disabled?: boolean;
}

function labelOf(option: AgentPickerOption): string {
  return option.label?.trim() || option.value;
}

interface AgentPickerProps {
  options: AgentPickerOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  triggerClassName?: string;
  contentClassName?: string;
  id?: string;
  ariaLabel?: string;
  /** Hide the `agent:<id>` code suffix on rows and trigger. */
  hideIdSuffix?: boolean;
}

export function AgentPicker({
  options,
  value,
  onChange,
  placeholder = "Select agent...",
  searchPlaceholder = "Search agents...",
  emptyLabel = "No agents match",
  disabled = false,
  triggerClassName,
  contentClassName,
  id,
  ariaLabel,
  hideIdSuffix = false,
}: AgentPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  }, []);

  const selected = React.useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const ranked = needle
      ? options.filter(
          (o) =>
            o.value.toLowerCase().includes(needle) ||
            (o.label ?? "").toLowerCase().includes(needle),
        )
      : options;
    if (!selected) return ranked;
    const out = ranked.filter((o) => o !== selected);
    if (ranked.includes(selected)) out.unshift(selected);
    return out;
  }, [options, query, selected]);

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
  };

  const pick = (option: AgentPickerOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "inline-flex w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-left",
            "hover:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-60",
            triggerClassName,
          )}
        >
          <div className="flex-1 min-w-0">
            {selected ? (
              <span className="flex items-center gap-2">
                <span className="truncate">{labelOf(selected)}</span>
                {!hideIdSuffix && (
                  <code className="shrink-0 text-[10px] text-muted-foreground">
                    agent:{selected.value}
                  </code>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </div>
          {selected && !disabled && (
            <X
              role="button"
              aria-label="Clear agent selection"
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={clear}
            />
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("w-[min(360px,90vw)] p-0", contentClassName)}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoFocus
            aria-label={searchPlaceholder}
          />
        </div>
        <div
          className="max-h-[260px] overflow-y-auto py-1"
          role="listbox"
          aria-label={ariaLabel || placeholder}
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              {emptyLabel}
            </div>
          ) : (
            filtered.map((option) => {
              const isSelected = selected === option;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  onClick={() => pick(option)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                    "hover:bg-muted/50 focus:bg-muted/50 focus:outline-none",
                    isSelected && "bg-muted/30",
                    option.disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                  )}
                >
                  <Check
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      isSelected ? "text-primary" : "text-transparent",
                    )}
                    aria-hidden="true"
                  />
                  <span className="flex-1 min-w-0 truncate">{labelOf(option)}</span>
                  {!hideIdSuffix && (
                    <code className="shrink-0 text-[10px] text-muted-foreground">
                      agent:{option.value}
                    </code>
                  )}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
