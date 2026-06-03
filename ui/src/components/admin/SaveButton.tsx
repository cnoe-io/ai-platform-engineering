"use client";

// Shared admin "save" affordance. Normalizes the save UX across the admin
// panel so every settings page behaves the same:
//   - a Save icon (swaps to a spinner while saving)
//   - the visible label is always just "Save" (swaps to "Saving…" in flight)
//   - an "Unsaved changes" badge appears next to the button when dirty
//   - an inline "Saved" / error flash after the action resolves
//   - disabled while saving or when there is nothing to save
//
// Keep the VISIBLE label as "Save" everywhere for consistency — disambiguate
// for screen readers / tests with `ariaLabel` instead of a bespoke visible
// label. Prefer this over hand-rolling the Save-icon + Loader2 + dirty combo.
//
// For modal forms that submit on <form onSubmit>, pass `type="submit"`; the
// button then triggers the form instead of `onSave` and skips dirty-gating.

import React from "react";
import { CheckCircle2, Loader2, Save } from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SaveButtonProps {
  /** Click handler. May be async; the parent owns the actual persistence.
   * Omit when `type="submit"` (the enclosing <form> handles submission). */
  onSave?: () => void | Promise<void>;
  /** True while the save request is in flight (drives the spinner + disable). */
  saving: boolean;
  /** True when the form differs from the last-saved state. Gates the button
   * and toggles the "Unsaved changes" badge. Defaults to true for submit-mode
   * modal forms, where "dirty" isn't tracked. */
  dirty?: boolean;
  /** Resolved outcome of the last save, drives the inline flash. Pass null to
   * hide it (e.g. when the parent surfaces success via a toast instead). */
  result?: "success" | "error" | null;
  /** Accessible name. Defaults to "Save"; set a descriptive value when there
   * are multiple Save buttons on a page so tests/screen-readers can tell them
   * apart. The VISIBLE label stays "Save" regardless. */
  ariaLabel?: string;
  /** data-testid forwarded to the button. */
  testId?: string;
  /** Hide the adjacent "Unsaved changes" badge (some compact layouts opt out). */
  hideDirtyBadge?: boolean;
  /** Extra disabled condition (e.g. invalid form) OR'd with saving/!dirty. */
  disabled?: boolean;
  /** "submit" wires the button to the enclosing form instead of onSave. */
  type?: "button" | "submit";
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  className?: string;
  /** Wrapper class for the row that holds the button + badge + flash. */
  wrapperClassName?: string;
}

export function SaveButton({
  onSave,
  saving,
  dirty,
  result = null,
  ariaLabel = "Save",
  testId,
  hideDirtyBadge = false,
  disabled = false,
  type = "button",
  size = "sm",
  variant = "default",
  className,
  wrapperClassName,
}: SaveButtonProps) {
  const isSubmit = type === "submit";
  // Submit-mode modal forms don't track dirty; treat them as always-enabled.
  const isDirty = isSubmit ? (dirty ?? true) : Boolean(dirty);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", wrapperClassName)}>
      <Button
        type={type}
        size={size}
        variant={variant}
        className={cn("gap-2", className)}
        {...(isSubmit ? {} : { onClick: () => void onSave?.() })}
        disabled={disabled || saving || !isDirty}
        aria-label={ariaLabel}
        {...(testId ? { "data-testid": testId } : {})}
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        {saving ? "Saving…" : "Save"}
      </Button>
      {!hideDirtyBadge && isDirty && !saving && !isSubmit && (
        <span role="status" className="text-[11px] text-amber-700 dark:text-amber-400">
          Unsaved changes
        </span>
      )}
      {result === "success" && !isDirty && (
        <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          Saved
        </span>
      )}
      {result === "error" && (
        <span className="text-sm text-destructive">Failed to save. Try again.</span>
      )}
    </div>
  );
}
