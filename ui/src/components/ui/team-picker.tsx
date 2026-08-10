// assisted-by Cursor Claude:claude-opus-4-7
//
// Searchable team picker(s) shared across every admin surface that
// grants OpenFGA access to a team (Agent editor, Slack/Webex channel
// panels, RAG team access, KB team access, connector onboarding
// wizard). The native `<select>` we used to ship became unusable as
// soon as a real environment had hundreds of AWS-* / SSO-* teams —
// admins had to scroll a 600-row dropdown to find one team. This
// component:
//
//   - Renders ONLY the current selection on the trigger (a chip for
//     each picked team, capped at 2 then "+N more"). The full list is
//     hidden until the popover opens.
//   - Surfaces an always-focused search box as the first child so the
//     admin can type to filter immediately — exactly the muscle
//     memory of a Linear-style combobox.
//   - Floats already-selected entries to the top of the filtered
//     list and prefixes them with a checked checkbox so picks are
//     instantly distinguishable from candidates.
//   - Is purely controlled — parent owns the selection (slug-string
//     or string-array) and we hand it back via `onChange`. Identity
//     is the team `slug` (the OpenFGA subject) and the human-facing
//     label is the team `name`, falling back to the slug.

"use client";

import { Badge } from "@/components/ui/badge";
import { Popover,PopoverContent,PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check,ChevronDown,Search,X } from "lucide-react";
import * as React from "react";

/**
 * One team entry. `slug` is the OpenFGA subject identifier (what we
 * write to tuples); `name` is the human label (what we render). When
 * `name` is missing the slug is shown so admins can still pick it.
 *
 * `id` is the optional Mongo _id — accepted because some pre-existing
 * callers persist team _id strings rather than slugs and need the
 * picker to match both shapes (the picker compares incoming `value`
 * against `slug`, `id`, and `_id` so legacy data still re-renders the
 * right selection).
 */
export interface TeamPickerOption {
  slug: string;
  name?: string;
  id?: string;
  _id?: string;
  description?: string;
  /** When false, the entry is rendered greyed-out and not selectable. */
  disabled?: boolean;
}

function labelOf(option: TeamPickerOption): string {
  return option.name?.trim() || option.slug;
}

function tokensFor(option: TeamPickerOption): string[] {
  const tokens: string[] = [];
  if (option.slug) tokens.push(option.slug.toLowerCase());
  if (option.name) tokens.push(option.name.toLowerCase());
  return tokens;
}

function matchesValue(option: TeamPickerOption, value: string): boolean {
  if (!value) return false;
  return (
    option.slug === value ||
    option.id === value ||
    option._id === value
  );
}

interface CommonPickerProps {
  options: TeamPickerOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  /** Width applied to the trigger. Defaults to `w-full` so single-team
   *  pickers fill their parent column the same way `<select>` did. */
  triggerClassName?: string;
  /** Popover width — defaults to `min(360px, 90vw)` so it can show
   *  long team names without growing the trigger. */
  contentClassName?: string;
  /** ARIA: associates the trigger with an external `<Label htmlFor>`. */
  id?: string;
  /** ARIA: alternative label when the picker has no visible <Label>. */
  ariaLabel?: string;
  /** ARIA: marks the combobox trigger invalid for required/error states. */
  ariaInvalid?: boolean;
  /** ARIA: links the trigger to help or error text. */
  ariaDescribedBy?: string;
  /** Hide the `team:<slug>` code suffix on rows and trigger. Useful
   *  for callers that pass opaque identifiers (e.g. Mongo `_id` for
   *  KB team assignments) where rendering `team:<objectid>` is just
   *  noise. */
  hideSlugSuffix?: boolean;
  /** Render inside the trigger wrapper instead of document.body.
   *  Use inside modal dialogs so focus traps keep the search input usable.
   */
  portalled?: boolean;
  /** Popover placement relative to the trigger. Prefer `top` when the trigger
   *  sits low on the page (e.g. MCP server editor) so the list is not clipped. */
  contentSide?: "top" | "bottom";
}

// ---------------------------------------------------------------------------
// TeamPicker — single-select
// ---------------------------------------------------------------------------

interface TeamPickerProps extends CommonPickerProps {
  value: string;
  onChange: (value: string) => void;
  /** When true, picking the same entry again clears the selection
   *  instead of being a no-op. Defaults to false because most callers
   *  prefer an explicit "Clear" affordance via the trigger's X icon. */
  toggleOnReselect?: boolean;
  /** Optional small caption shown below the search bar inside the
   *  popover (e.g. "Type to filter 612 teams"). */
  helperText?: string;
}

export function TeamPicker({
  options,
  value,
  onChange,
  placeholder = "Select team...",
  searchPlaceholder = "Search teams...",
  emptyLabel = "No teams match",
  disabled = false,
  triggerClassName,
  contentClassName,
  id,
  ariaLabel,
  ariaInvalid,
  ariaDescribedBy,
  hideSlugSuffix = false,
  portalled = true,
  contentSide = "bottom",
  toggleOnReselect = false,
  helperText,
}: TeamPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  // Stable id so the combobox trigger can point aria-controls at its listbox.
  const listboxId = React.useId();

  // Reset the search every time the popover closes so the next open
  // starts on the full list — admins don't expect a stale filter to
  // be remembered. (Same convention as the existing MultiSelect.)
  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  }, []);

  const selected = React.useMemo(
    () => options.find((o) => matchesValue(o, value)),
    [options, value],
  );

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const ranked = needle
      ? options.filter((o) =>
          tokensFor(o).some((t) => t.includes(needle)),
        )
      : options;
    // Float the current selection to the top so re-opening the picker
    // anchors on the existing choice.
    if (!selected) return ranked;
    const out = ranked.filter((o) => o !== selected);
    if (ranked.includes(selected)) out.unshift(selected);
    return out;
  }, [options, query, selected]);

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
  };

  const pick = (option: TeamPickerOption) => {
    if (option.disabled) return;
    const isAlreadySelected = selected === option;
    if (isAlreadySelected && toggleOnReselect) {
      onChange("");
    } else {
      onChange(option.slug);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <div className="w-full min-w-0">
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          // role=combobox so aria-invalid is honored by assistive tech — a
          // plain button role silently drops it. Pair with the expanded/popup
          // state so the searchable popover reads as a combobox listbox.
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
          disabled={disabled}
          className={cn(
            "inline-flex w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-left",
            "hover:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-60",
            triggerClassName,
          )}
        >
          <div className="flex flex-1 min-w-0 items-center gap-2">
            {selected ? (
              <>
                <span
                  className="truncate"
                  style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {labelOf(selected)}
                </span>
                {!hideSlugSuffix && (
                  <code
                    className="truncate text-[10px] text-muted-foreground"
                    style={{ flexShrink: 9999, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    team:{selected.slug}
                  </code>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </div>
          {selected && !disabled && (
            <X
              role="button"
              aria-label="Clear team selection"
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={clear}
            />
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      </div>
      <PopoverContent
        align="start"
        side={contentSide}
        className={cn("w-[min(360px,90vw)] p-0", contentClassName)}
        portalled={portalled}
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
        {helperText && (
          <div className="px-3 pt-1.5 pb-0 text-[11px] text-muted-foreground">
            {helperText}
          </div>
        )}
        <div
          id={listboxId}
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
                  key={option.slug}
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
                  <span
                    className="truncate"
                    style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {labelOf(option)}
                  </span>
                  {!hideSlugSuffix && (
                    <code
                      className="truncate text-[10px] text-muted-foreground"
                      style={{ flexShrink: 9999, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      team:{option.slug}
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

// ---------------------------------------------------------------------------
// TeamMultiPicker — multi-select
// ---------------------------------------------------------------------------

interface TeamMultiPickerProps extends CommonPickerProps {
  selected: string[];
  onChange: (next: string[]) => void;
  /** Cap how many chips render on the trigger before collapsing to
   *  "+N more". Defaults to 2 to match the existing MultiSelect. */
  triggerChipCap?: number;
  /** Optional small caption shown below the search bar inside the
   *  popover. */
  helperText?: string;
  /** When true, render a "Clear all" button at the bottom of the
   *  popover whenever any teams are selected. */
  allowClearAll?: boolean;
}

export function TeamMultiPicker({
  options,
  selected,
  onChange,
  placeholder = "Share with teams...",
  searchPlaceholder = "Search teams...",
  emptyLabel = "No teams match",
  disabled = false,
  triggerClassName,
  contentClassName,
  id,
  ariaLabel,
  hideSlugSuffix = false,
  portalled = true,
  triggerChipCap = 2,
  helperText,
  allowClearAll = true,
}: TeamMultiPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  }, []);

  // Resolve every value in `selected` against the options list once so
  // both the trigger chip render and the popover sort path can reuse
  // the lookup. Unresolved entries (i.e. a slug that no longer matches
  // any team in the options list — usually a team that was deleted
  // after the selection was made) still render as a chip with the raw
  // slug so the admin can see them and decide to remove them.
  const selectedOptions = React.useMemo(() => {
    const byValue = new Map<string, TeamPickerOption>();
    for (const value of selected) {
      const match = options.find((o) => matchesValue(o, value));
      byValue.set(value, match ?? { slug: value });
    }
    return Array.from(byValue.values());
  }, [options, selected]);

  const selectedSet = React.useMemo(
    () => new Set(selectedOptions.map((o) => o.slug)),
    [selectedOptions],
  );

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visible = needle
      ? options.filter((o) =>
          tokensFor(o).some((t) => t.includes(needle)),
        )
      : options;
    // Selected first, then unselected — within each group preserve
    // the order returned by the caller (usually alphabetised already).
    const selectedHits: TeamPickerOption[] = [];
    const otherHits: TeamPickerOption[] = [];
    for (const option of visible) {
      if (selectedSet.has(option.slug)) selectedHits.push(option);
      else otherHits.push(option);
    }
    return { selectedHits, otherHits };
  }, [options, query, selectedSet]);

  const toggle = (option: TeamPickerOption) => {
    if (option.disabled) return;
    if (selectedSet.has(option.slug)) {
      onChange(
        selected.filter(
          (entry) =>
            entry !== option.slug && entry !== option.id && entry !== option._id,
        ),
      );
    } else {
      onChange([...selected, option.slug]);
    }
  };

  const removeChip = (option: TeamPickerOption, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(
      selected.filter(
        (entry) =>
          entry !== option.slug && entry !== option.id && entry !== option._id,
      ),
    );
  };

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const visibleChips = selectedOptions.slice(0, triggerChipCap);
  const overflow = selectedOptions.length - visibleChips.length;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel || placeholder}
          disabled={disabled}
          className={cn(
            "inline-flex w-full items-center gap-2 rounded-md border border-input bg-background px-2.5 py-2 text-sm text-left",
            "hover:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-60",
            triggerClassName,
          )}
        >
          <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1">
            {selectedOptions.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              <>
                {visibleChips.map((option) => (
                  <Badge
                    key={option.slug}
                    variant="secondary"
                    className="h-6 gap-1 px-1.5 text-[11px]"
                  >
                    <span className="truncate max-w-[140px]">{labelOf(option)}</span>
                    {!disabled && (
                      <X
                        role="button"
                        aria-label={`Remove ${labelOf(option)}`}
                        className="h-3 w-3 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                        onClick={(e) => removeChip(option, e)}
                      />
                    )}
                  </Badge>
                ))}
                {overflow > 0 && (
                  <Badge variant="outline" className="h-6 px-1.5 text-[11px]">
                    +{overflow} more
                  </Badge>
                )}
              </>
            )}
          </div>
          {selectedOptions.length > 0 && !disabled && allowClearAll && (
            <X
              role="button"
              aria-label="Clear all selected teams"
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={clearAll}
            />
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("w-[min(360px,90vw)] p-0", contentClassName)}
        portalled={portalled}
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
        {helperText && (
          <div className="px-3 pt-1.5 pb-0 text-[11px] text-muted-foreground">
            {helperText}
          </div>
        )}
        <div
          className="max-h-[280px] overflow-y-auto py-1"
          role="listbox"
          aria-label={ariaLabel || placeholder}
          aria-multiselectable="true"
        >
          {filtered.selectedHits.length === 0 && filtered.otherHits.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">{emptyLabel}</div>
          ) : (
            <>
              {filtered.selectedHits.length > 0 && (
                <div className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Selected
                </div>
              )}
              {filtered.selectedHits.map((option) => (
                <OptionRow
                  key={`s-${option.slug}`}
                  option={option}
                  selected
                  onToggle={() => toggle(option)}
                  hideSlugSuffix={hideSlugSuffix}
                />
              ))}
              {filtered.selectedHits.length > 0 && filtered.otherHits.length > 0 && (
                <div className="my-1 border-t border-border" />
              )}
              {filtered.otherHits.length > 0 && (
                <div className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Available
                </div>
              )}
              {filtered.otherHits.map((option) => (
                <OptionRow
                  key={`o-${option.slug}`}
                  option={option}
                  selected={false}
                  onToggle={() => toggle(option)}
                  hideSlugSuffix={hideSlugSuffix}
                />
              ))}
            </>
          )}
        </div>
        {selectedOptions.length > 0 && allowClearAll && (
          <div className="border-t border-border px-3 py-1.5 text-right">
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function OptionRow({
  option,
  selected,
  onToggle,
  hideSlugSuffix = false,
}: {
  option: TeamPickerOption;
  selected: boolean;
  onToggle: () => void;
  hideSlugSuffix?: boolean;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={option.disabled}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
        "hover:bg-muted/50 focus:bg-muted/50 focus:outline-none",
        selected && "bg-muted/30",
        option.disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-input",
          selected && "border-primary bg-primary",
        )}
      >
        {selected && (
          <Check className="h-3 w-3 text-primary-foreground" aria-hidden="true" />
        )}
      </span>
      <span
        className="truncate"
        style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {labelOf(option)}
      </span>
      {!hideSlugSuffix && (
        <code
          className="truncate text-[10px] text-muted-foreground"
          style={{ flexShrink: 9999, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          team:{option.slug}
        </code>
      )}
    </button>
  );
}
