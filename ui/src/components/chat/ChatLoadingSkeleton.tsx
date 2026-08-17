import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface LoadingLabelProps {
  label: string;
}

function LoadingLabel({ label }: LoadingLabelProps) {
  return <span className="sr-only">{label}</span>;
}

function MessagePlaceholders() {
  return (
    <div aria-hidden="true" className="mx-auto w-full max-w-4xl space-y-8 px-5 py-8 sm:px-8">
      <div className="flex items-start gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
        <div className="w-full max-w-2xl space-y-2 pt-1">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>

      <div className="flex justify-end">
        <div className="w-full max-w-xl space-y-2 rounded-2xl border border-border/60 p-4">
          <Skeleton className="ml-auto h-3 w-20" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="ml-auto h-4 w-3/4" />
        </div>
      </div>

      <div className="flex items-start gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
        <div className="w-full max-w-2xl space-y-2 pt-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    </div>
  );
}

interface ChatLoadingSkeletonProps {
  className?: string;
  label?: string;
}

/** Full Chat surface shown while the conversation itself is being resolved. */
export function ChatLoadingSkeleton({
  className,
  label = "Loading conversation...",
}: ChatLoadingSkeletonProps) {
  return (
    <div
      aria-busy="true"
      className={cn("flex h-full min-h-0 w-full flex-1 flex-col bg-background", className)}
      data-testid="chat-loading-skeleton"
      role="status"
    >
      <LoadingLabel label={label} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <MessagePlaceholders />
      </div>
      <div aria-hidden="true" className="mx-auto w-full max-w-4xl px-5 pb-5 sm:px-8">
        <div className="rounded-2xl border border-border/70 bg-card/40 p-3 shadow-sm">
          <Skeleton className="h-16 w-full" />
          <div className="mt-3 flex items-center justify-between">
            <div className="flex gap-2">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-8 w-24 rounded-lg" />
            </div>
            <Skeleton className="h-9 w-9 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Message-area skeleton used after metadata is available but history is not. */
export function ChatMessagesSkeleton({
  className,
  label = "Loading conversation...",
}: ChatLoadingSkeletonProps) {
  return (
    <div
      aria-busy="true"
      className={cn("w-full", className)}
      data-testid="chat-messages-skeleton"
      role="status"
    >
      <LoadingLabel label={label} />
      <MessagePlaceholders />
    </div>
  );
}
