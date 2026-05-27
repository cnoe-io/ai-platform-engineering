"use client";

import React from "react";
import Link from "next/link";
import { MessageSquare, Plus } from "lucide-react";
import { ConversationCard } from "./ConversationCard";

interface RecentChatsProps {
  conversations: Array<{
    id: string;
    title: string;
    updatedAt: Date | string;
    totalMessages?: number;
    isShared?: boolean;
  }>;
  loading: boolean;
  maxItems?: number;
}

export function RecentChats({
  conversations,
  loading,
  maxItems = 6,
}: RecentChatsProps) {
  const items = conversations.slice(0, maxItems);

  return (
    <div data-testid="recent-chats">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Recent Chats
        </h2>
        <Link
          href="/chat"
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
          data-testid="new-chat-link"
        >
          <Plus className="h-3 w-3" />
          New Chat
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              data-testid="skeleton"
              className="h-24 rounded-lg bg-muted/30 animate-pulse"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div
          data-testid="recent-chats-empty"
          className="flex flex-col items-center justify-center py-8 text-center"
        >
          <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
            <MessageSquare className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground mb-2">
            No conversations yet
          </p>
          <Link
            href="/chat"
            className="text-sm text-primary hover:underline"
          >
            Start a new chat
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((conv) => (
            <ConversationCard
              key={conv.id}
              id={conv.id}
              title={conv.title}
              updatedAt={conv.updatedAt}
              totalMessages={conv.totalMessages}
              isShared={conv.isShared}
            />
          ))}
        </div>
      )}
    </div>
  );
}
