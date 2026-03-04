"use client";

import React from "react";
import Link from "next/link";
import {
  MessageSquare,
  TrendingUp,
  Bot,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface InsightsWidgetProps {
  stats: {
    total_conversations: number;
    conversations_this_week: number;
    messages_this_week: number;
    favorite_agents: Array<{ name: string; count: number }>;
  } | null;
  loading: boolean;
}

export function InsightsWidget({ stats, loading }: InsightsWidgetProps) {
  return (
    <div data-testid="insights-widget">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Your Insights
        </h3>
        <Link
          href="/insights"
          data-testid="view-all-insights"
          className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
        >
          View all
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {loading ? (
        <div data-testid="insights-widget-loading" className="p-4 rounded-lg border border-border/50 bg-card/50 space-y-3">
          <div className="h-8 w-16 bg-muted/30 animate-pulse rounded" />
          <div className="h-4 w-32 bg-muted/30 animate-pulse rounded" />
        </div>
      ) : !stats ? (
        <div data-testid="insights-widget-empty" className="p-4 rounded-lg border border-border/50 bg-card/50">
          <p className="text-sm text-muted-foreground">
            Start chatting to build your insights.
          </p>
        </div>
      ) : (
        <div className="p-4 rounded-lg border border-border/50 bg-card/50 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <MessageSquare className="h-3.5 w-3.5" />
                <span className="text-xs">Conversations</span>
              </div>
              <p className="text-xl font-bold text-foreground" data-testid="total-conversations">
                {stats.total_conversations}
              </p>
              <p className="text-xs text-muted-foreground" data-testid="conversations-this-week">
                {stats.conversations_this_week} this week
              </p>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5" />
                <span className="text-xs">Messages</span>
              </div>
              <p className="text-xl font-bold text-foreground" data-testid="messages-this-week-value">
                {stats.messages_this_week}
              </p>
              <p className="text-xs text-muted-foreground">this week</p>
            </div>
          </div>

          {stats.favorite_agents.slice(0, 3).length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
                <Bot className="h-3.5 w-3.5" />
                <span className="text-xs">Top Agents</span>
              </div>
              <div className="space-y-1.5">
                {stats.favorite_agents.slice(0, 3).map((agent) => (
                  <div key={agent.name} className="flex items-center justify-between">
                    <span className="text-xs text-foreground capitalize" data-testid={`agent-${agent.name}`}>
                      {agent.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {agent.count} {agent.count === 1 ? "use" : "uses"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
