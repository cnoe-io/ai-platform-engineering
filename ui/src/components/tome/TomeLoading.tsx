import { cn } from "@/lib/utils";

/**
 * Shared loading skeleton for Tome panels, so "loading gists" doesn't look
 * different from "loading settings" or "loading the activity feed" - one
 * pulse treatment, sized to the kind of content being loaded.
 */
export function TomeLoading({
  variant = "lines",
  rows = 3,
  className,
}: {
  /** "lines": paragraph-style skeleton, for a page/detail/form.
   *  "list": a few row-card skeletons, for a list of items. */
  variant?: "lines" | "list";
  rows?: number;
  className?: string;
}) {
  if (variant === "list") {
    return (
      <div
        className={cn("mx-auto flex w-full max-w-3xl flex-col gap-2 p-4", className)}
        aria-hidden
      >
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border px-4 py-3">
            <div className="h-4 w-4 shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div
                className={cn("h-4 animate-pulse rounded bg-muted", i % 2 ? "w-2/3" : "w-1/2")}
              />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted/70" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("mx-auto w-full max-w-3xl space-y-4 px-8 py-10", className)} aria-hidden>
      <div className="h-7 w-1/3 animate-pulse rounded bg-muted" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-4 animate-pulse rounded bg-muted",
              i === rows - 1 ? "w-4/5" : i === rows - 2 ? "w-11/12" : "w-full",
            )}
          />
        ))}
      </div>
    </div>
  );
}
