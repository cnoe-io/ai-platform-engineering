// Styled single-select for credential providers (GitHub, GitLab, …).
//
// Mirrors the platform's Popover-based picker idiom (see team-picker.tsx) so the
// SA Credentials "Add a credential" form matches the rest of the admin UI rather
// than rendering a bare native <select>. Single-select, controlled: the parent
// owns the selected provider key and receives changes via onChange. Options are
// expected to be the *enabled* connectors only (the caller filters); this
// component just renders whatever it's given.
"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface ProviderOption {
  /** Provider key — the value persisted/sent to the API (e.g. "gitlab"). */
  provider: string;
  /** Human label rendered in the trigger and list (e.g. "GitLab"). */
  name: string;
}

interface ProviderSelectProps {
  options: ProviderOption[];
  value: string;
  onChange: (provider: string) => void;
  disabled?: boolean;
  /** Accessible name for the trigger (defaults to "Provider"). */
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
}

export function ProviderSelect({
  options,
  value,
  onChange,
  disabled = false,
  ariaLabel = "Provider",
  placeholder = "Select a provider…",
  className,
}: ProviderSelectProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.provider === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "flex h-9 min-w-[10rem] items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            disabled && "cursor-not-allowed opacity-50",
            className,
          )}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.name : placeholder}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="min-w-[12rem] p-1" align="start">
        <ul role="listbox" className="max-h-64 overflow-y-auto">
          {options.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              No providers available
            </li>
          ) : (
            options.map((option) => {
              const isSelected = option.provider === value;
              return (
                <li key={option.provider}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                      "hover:bg-accent hover:text-accent-foreground",
                      isSelected && "bg-accent/50",
                    )}
                    onClick={() => {
                      onChange(option.provider);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{option.name}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
