"use client";

import React from "react";
import Link from "next/link";
import { MessageSquare, Users2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConversationCardProps {
  id: string;
  title: string;
  updatedAt: Date | string;
  totalMessages?: number;
  isShared?: boolean;
  sharedBy?: string;
  teamName?: string;
}

function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

export function ConversationCard({
  id,
  title,
  updatedAt,
  totalMessages,
  isShared,
  sharedBy,
  teamName,
}: ConversationCardProps) {
  return (
    <Link
      href={`/chat/${id}`}
      data-testid={`conversation-card-${id}`}
      className={cn(
        "group block p-4 rounded-lg border border-border/50 bg-card/50",
        "hover:border-primary/30 hover:bg-card/80 transition-all",
        "cursor-pointer"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
          <MessageSquare className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium truncate text-foreground group-hover:text-primary transition-colors">
            {title || "Untitled Conversation"}
          </h4>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatRelativeTime(updatedAt)}
            </span>
            {totalMessages != null && totalMessages > 0 && (
              <span className="text-xs text-muted-foreground">
                {totalMessages} {totalMessages === 1 ? "message" : "messages"}
              </span>
            )}
          </div>
          {isShared && (
            <div className="flex items-center gap-1 mt-1.5">
              <Users2 className="h-3 w-3 text-blue-400" />
              <span className="text-xs text-blue-400">
                {teamName
                  ? `Shared with ${teamName}`
                  : sharedBy
                  ? `Shared by ${sharedBy}`
                  : "Shared"}
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

export { formatRelativeTime };
