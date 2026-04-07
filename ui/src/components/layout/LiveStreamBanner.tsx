"use client";

import React from "react";
import { Radio } from "lucide-react";
import { useChatStore } from "@/store/chat-store";

/**
 * Thin banner that appears at the top of the app when one or more
 * conversations are actively streaming. Purely informational — the
 * server persists all streaming events in real-time, so refreshing
 * will not lose data (the UI will poll and recover on reload).
 */
export function LiveStreamBanner() {
  const streamingConversations = useChatStore(
    (s) => s.streamingConversations
  );

  if (streamingConversations.size === 0) return null;

  const count = streamingConversations.size;
  const label =
    count === 1
      ? "1 live response in progress"
      : `${count} live responses in progress`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium bg-emerald-500/10 border-b border-emerald-500/25 text-emerald-700 dark:text-emerald-300 select-none shrink-0"
    >
      <Radio className="h-3.5 w-3.5 animate-pulse" />
      <span>{label}</span>
    </div>
  );
}
