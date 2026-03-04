"use client";

import React from "react";
import { Radio } from "lucide-react";
import { useChatStore } from "@/store/chat-store";

/**
 * Thin banner that appears at the top of the app when one or more
 * conversations are actively streaming. It gives users a clear,
 * proactive warning *before* they hit Cmd-R / F5, since modern
 * browsers replace the custom `beforeunload` message with a generic
 * "Changes you made may not be saved" string.
 */
export function LiveStreamBanner() {
  const streamingConversations = useChatStore(
    (s) => s.streamingConversations
  );

  if (streamingConversations.size === 0) return null;

  const count = streamingConversations.size;
  const label =
    count === 1
      ? "1 live chat is receiving a response"
      : `${count} live chats are receiving responses`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium bg-emerald-500/10 border-b border-emerald-500/25 text-emerald-700 dark:text-emerald-300 select-none shrink-0"
    >
      <Radio className="h-3.5 w-3.5 animate-pulse" />
      <span>
        {label} — <strong>refreshing will interrupt</strong>
      </span>
    </div>
  );
}
