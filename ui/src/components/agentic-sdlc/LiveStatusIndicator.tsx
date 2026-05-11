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
        <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center" aria-hidden>
          <span className="absolute inset-0 rounded-full border border-amber-300/30 motion-safe:animate-ping" />
          <Loader2
            data-live-spinner
            className="relative h-3 w-3 motion-safe:animate-spin"
          />
        </span>
      ) : status === "closed" ? (
        <WifiOff className="h-3 w-3" aria-hidden />
      ) : (
        <span
          className="relative inline-flex h-2.5 w-2.5 items-center justify-center"
          aria-hidden
        >
          {connected ? (
            <span
              data-live-halo
              className="absolute inline-flex h-full w-full rounded-full bg-emerald-300/50 opacity-75 motion-safe:animate-ping"
            />
          ) : null}
          <span
            data-live-dot
            className={cn(
              "relative h-1.5 w-1.5 rounded-full",
              connected
                ? "bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.8)] motion-safe:animate-pulse"
                : "bg-muted-foreground/70",
            )}
          />
        </span>
      )}
      <span>{connected ? "Live" : STATUS_LABEL[status]}</span>
    </span>
  );
}
