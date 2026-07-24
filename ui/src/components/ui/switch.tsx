import * as React from "react";

import { cn } from "@/lib/utils";

/** Lightweight toggle switch (no extra dependency): a visually-hidden
 * checkbox drives two sibling spans via Tailwind's `peer` variant. */
export const Switch = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">
>(({ className, ...props }, ref) => {
  return (
    <label
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center",
        props.disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <input ref={ref} type="checkbox" className="peer sr-only" {...props} />
      <span className="absolute inset-0 rounded-full bg-muted transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2" />
      <span className="absolute left-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform peer-checked:translate-x-4" />
    </label>
  );
});
Switch.displayName = "Switch";
