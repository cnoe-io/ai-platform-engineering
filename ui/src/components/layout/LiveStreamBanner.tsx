"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, MessageSquare, Radio } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useChatStore } from "@/store/chat-store";
import { useTomeChatStore } from "@/store/tome-chat-store";

interface LiveStreamDestination {
  id: string;
  href: string;
  label: string;
  kind: "CAIPE chat" | "TOME agent";
}

/**
 * Thin banner that appears at the top of the app when one or more
 * CAIPE conversations or TOME project chats are actively streaming. TOME
 * streams stay live across internal navigation and can reattach after a full
 * browser reload through the backend-owned run replay API.
 */
export function LiveStreamBanner() {
  const [open, setOpen] = useState(false);
  const streamingConversations = useChatStore(
    (s) => s.streamingConversations,
  );
  const conversations = useChatStore((s) => s.conversations);
  const tomeChats = useTomeChatStore((s) => s.chats);

  const destinations = useMemo<LiveStreamDestination[]>(() => {
    const conversationById = new Map(
      conversations.map((conversation) => [conversation.id, conversation]),
    );
    const caipeDestinations = Array.from(streamingConversations.keys()).map(
      (conversationId) => ({
        id: `caipe:${conversationId}`,
        href: `/chat/${conversationId}`,
        label: conversationById.get(conversationId)?.title || "CAIPE conversation",
        kind: "CAIPE chat" as const,
      }),
    );
    const tomeDestinations = Object.entries(tomeChats)
      .filter(([, chat]) => chat.streaming && chat.streamDestination)
      .map(([key, chat]) => ({
        id: `tome:${key}`,
        href: chat.streamDestination!.href,
        label: chat.streamDestination!.label,
        kind: "TOME agent" as const,
      }));
    return [...caipeDestinations, ...tomeDestinations];
  }, [conversations, streamingConversations, tomeChats]);

  const count = destinations.length;

  if (count === 0) return null;

  const label =
    count === 1
      ? "1 live response in progress"
      : `${count} live responses in progress`;
  const actionLabel = `${label}. Click to navigate`;

  const bannerContent = (
    <>
      <Radio className="h-3.5 w-3.5 animate-pulse" />
      <span>{actionLabel}</span>
    </>
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 border-b border-emerald-500/25 bg-emerald-500/10 text-xs font-medium text-emerald-700 dark:text-emerald-300"
    >
      {count === 1 ? (
        <Link
          href={destinations[0].href}
          className="flex w-full cursor-pointer items-center justify-center gap-2 px-3 py-1.5 transition-colors hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
          aria-label={`${actionLabel}: ${destinations[0].label}`}
        >
          {bannerContent}
        </Link>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex w-full cursor-pointer items-center justify-center gap-2 px-3 py-1.5 transition-colors hover:bg-emerald-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
              aria-label={`${actionLabel}; choose a response`}
            >
              {bannerContent}
            </button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="center" className="w-80 p-2">
            <p className="px-2 pb-1.5 text-xs font-medium text-muted-foreground">
              Live responses
            </p>
            <div className="space-y-1">
              {destinations.map((destination) => (
                <Link
                  key={destination.id}
                  href={destination.href}
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MessageSquare className="h-4 w-4 shrink-0 text-emerald-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {destination.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {destination.kind}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
