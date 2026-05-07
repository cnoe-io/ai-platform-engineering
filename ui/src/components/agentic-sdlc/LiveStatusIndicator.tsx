"use client";

import { Loader2, WifiOff } from "lucide-react";

import type { AgenticSdlcStreamStatus } from "@/hooks/use-agentic-sdlc-stream";
import { cn } from "@/lib/utils";

interface LiveStatusIndicatorProps {
  status: AgenticSdlcStreamStatus;
  label: string;
  className?: string;
}

const STATUS_LABEL: Record<AgenticSdlcStreamStatus, string> = {
  idle: "idle",
  connecting: "connecting",
  open: "connected",
  reconnecting: "reconnecting",
  closed: "closed",
};

export function LiveStatusIndicator({
  status,
  label,
  className,
}: LiveStatusIndicatorProps) {
  const connected = status === "open";
  const transient = status === "connecting" || status === "reconnecting";

  return (
    <span
      role="status"
      aria-label={`${label}: ${STATUS_LABEL[status]}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        connected &&
          "border-emerald-400/25 bg-emerald-500/10 text-emerald-200",
        transient && "border-amber-400/25 bg-amber-500/10 text-amber-200",
        !connected &&
          !transient &&
          "border-border/40 bg-background/35 text-muted-foreground",
        className,
      )}
    >
      {transient ? (
        <Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden />
      ) : status === "closed" ? (
        <WifiOff className="h-3 w-3" aria-hidden />
      ) : (
        <span
          data-live-dot
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            connected
              ? "bg-emerald-300 motion-safe:animate-pulse"
              : "bg-muted-foreground/70",
          )}
          aria-hidden
        />
      )}
      <span>{connected ? "Live" : STATUS_LABEL[status]}</span>
    </span>
  );
}
