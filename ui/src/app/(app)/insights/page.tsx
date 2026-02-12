"use client";

import React, { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  MessageSquare,
  Hash,
  TrendingUp,
  Clock,
  Calendar,
  Bot,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  ExternalLink,
  Lightbulb,
  BarChart3,
  FileText,
  Zap,
} from "lucide-react";
import { AuthGuard } from "@/components/auth-guard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SimpleLineChart } from "@/components/admin/SimpleLineChart";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────
interface InsightsData {
  overview: {
    total_conversations: number;
    total_messages: number;
    total_tokens_used: number;
    conversations_this_week: number;
    messages_this_week: number;
    avg_messages_per_conversation: number;
  };
  recent_prompts: Array<{
    content: string;
    content_length: number;
    conversation_id: string;
    conversation_title: string;
    timestamp: string;
  }>;
  daily_usage: Array<{
    date: string;
    prompts: number;
    responses: number;
  }>;
  prompt_patterns: {
    avg_length: number;
    max_length: number;
    total_prompts: number;
    peak_hour: number | null;
    peak_hour_label: string;
    peak_day: string;
  };
  favorite_agents: Array<{ name: string; count: number }>;
  feedback_given: {
    positive: number;
    negative: number;
    total: number;
  };
}

// ─── Stat Card ───────────────────────────────────────────────────
function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color = "text-primary",
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className={cn("text-2xl font-bold mt-1", color)}>{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </div>
          <div className="p-2 rounded-lg bg-muted">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ───────────────────────────────────────────────────
function InsightsPage() {
  const { status } = useSession();
  const router = useRouter();
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;

    const loadInsights = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/users/me/insights");
        if (!res.ok) {
          if (res.status === 401) {
            setError("Please sign in to view insights.");
            return;
          }
          throw new Error(`Failed to load insights: ${res.statusText}`);
        }
        const json = await res.json();
        if (json.success) {
          setData(json.data);
        } else {
          throw new Error(json.error || "Unknown error");
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadInsights();
  }, [status]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-center space-y-4">
          <CAIPESpinner size="lg" />
          <p className="text-muted-foreground text-sm">Loading your insights...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive mb-2">Failed to load insights</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3"
        >
          <div className="p-2.5 rounded-xl bg-primary/10">
            <Lightbulb className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Personal Insights</h1>
            <p className="text-sm text-muted-foreground">
              Your usage patterns, prompt history, and analytics
            </p>
          </div>
        </motion.div>

        {/* Overview Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard
            title="Conversations"
            value={data.overview.total_conversations}
            subtitle={`${data.overview.conversations_this_week} this week`}
            icon={MessageSquare}
          />
          <StatCard
            title="Messages"
            value={data.overview.total_messages}
            subtitle={`${data.overview.messages_this_week} this week`}
            icon={Hash}
          />
          <StatCard
            title="Prompts Sent"
            value={data.prompt_patterns.total_prompts}
            icon={FileText}
            color="text-blue-500"
          />
          <StatCard
            title="Tokens Used"
            value={data.overview.total_tokens_used > 1000
              ? `${(data.overview.total_tokens_used / 1000).toFixed(1)}k`
              : data.overview.total_tokens_used}
            icon={Zap}
            color="text-orange-500"
          />
          <StatCard
            title="Avg Msgs/Chat"
            value={data.overview.avg_messages_per_conversation}
            icon={TrendingUp}
            color="text-green-500"
          />
          <StatCard
            title="Feedback Given"
            value={data.feedback_given.total}
            subtitle={data.feedback_given.total > 0
              ? `${Math.round((data.feedback_given.positive / data.feedback_given.total) * 100)}% positive`
              : undefined}
            icon={ThumbsUp}
            color="text-purple-500"
          />
        </div>

        {/* Usage Trend Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Usage Over Time (Last 30 Days)
            </CardTitle>
            <CardDescription>Your daily prompts and responses</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleLineChart
              data={data.daily_usage.map((day) => ({
                label: new Date(day.date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                }),
                value: day.prompts + day.responses,
              }))}
              height={250}
              color="rgb(99, 102, 241)"
            />
            <div className="mt-4 grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-lg font-bold text-indigo-500">
                  {data.daily_usage.reduce((sum, d) => sum + d.prompts, 0)}
                </p>
                <p className="text-xs text-muted-foreground">Prompts (30d)</p>
              </div>
              <div>
                <p className="text-lg font-bold">
                  {data.daily_usage.reduce((sum, d) => sum + d.responses, 0)}
                </p>
                <p className="text-xs text-muted-foreground">Responses (30d)</p>
              </div>
              <div>
                <p className="text-lg font-bold text-green-500">
                  {Math.round(
                    data.daily_usage.reduce((sum, d) => sum + d.prompts + d.responses, 0) /
                      Math.max(data.daily_usage.filter((d) => d.prompts + d.responses > 0).length, 1)
                  )}
                </p>
                <p className="text-xs text-muted-foreground">Avg/Active Day</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Prompt Patterns + Agents + Feedback */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Prompt Patterns */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Prompt Patterns
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Avg Length</span>
                <span className="text-sm font-medium">{data.prompt_patterns.avg_length} chars</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Longest Prompt</span>
                <span className="text-sm font-medium">{data.prompt_patterns.max_length} chars</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Peak Hour</span>
                <span className="text-sm font-medium flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {data.prompt_patterns.peak_hour_label}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Peak Day</span>
                <span className="text-sm font-medium flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {data.prompt_patterns.peak_day}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Favorite Agents */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-4 w-4" />
                Favorite Agents
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.favorite_agents.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No agent data yet
                </p>
              ) : (
                <div className="space-y-3">
                  {data.favorite_agents.map((agent, i) => {
                    const maxCount = data.favorite_agents[0].count;
                    const pct = maxCount > 0 ? (agent.count / maxCount) * 100 : 0;
                    return (
                      <div key={agent.name}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm capitalize">{agent.name}</span>
                          <span className="text-xs text-muted-foreground">{agent.count}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Feedback */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ThumbsUp className="h-4 w-4" />
                Your Feedback
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.feedback_given.total === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No feedback given yet
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div className="p-3 rounded-lg bg-green-500/10">
                      <ThumbsUp className="h-5 w-5 text-green-500 mx-auto mb-1" />
                      <p className="text-xl font-bold text-green-500">
                        {data.feedback_given.positive}
                      </p>
                      <p className="text-xs text-muted-foreground">Positive</p>
                    </div>
                    <div className="p-3 rounded-lg bg-red-500/10">
                      <ThumbsDown className="h-5 w-5 text-red-500 mx-auto mb-1" />
                      <p className="text-xl font-bold text-red-500">
                        {data.feedback_given.negative}
                      </p>
                      <p className="text-xs text-muted-foreground">Negative</p>
                    </div>
                  </div>
                  {/* Satisfaction bar */}
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Satisfaction Rate</span>
                      <span>
                        {Math.round(
                          (data.feedback_given.positive / data.feedback_given.total) * 100
                        )}
                        %
                      </span>
                    </div>
                    <div className="h-2 bg-red-100 dark:bg-red-900/30 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full"
                        style={{
                          width: `${(data.feedback_given.positive / data.feedback_given.total) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Prompts */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Recent Prompts
            </CardTitle>
            <CardDescription>Your last 20 prompts with conversation links</CardDescription>
          </CardHeader>
          <CardContent>
            {data.recent_prompts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No prompts yet. Start a conversation to see your history here.
              </p>
            ) : (
              <div className="space-y-3">
                {data.recent_prompts.map((prompt, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className="group flex items-start gap-3 p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-muted/30 transition-all cursor-pointer"
                    onClick={() => router.push(`/chat/${prompt.conversation_id}`)}
                  >
                    <div className="text-xs text-muted-foreground font-mono shrink-0 pt-0.5 w-6 text-right">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-clamp-2">{prompt.content}</p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {prompt.conversation_title}
                        </span>
                        <span className="text-xs text-muted-foreground/50">|</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(prompt.timestamp).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="text-xs text-muted-foreground/50">|</span>
                        <span className="text-xs text-muted-foreground">
                          {prompt.content_length} chars
                        </span>
                      </div>
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
                  </motion.div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}

export default function Insights() {
  return (
    <AuthGuard>
      <InsightsPage />
    </AuthGuard>
  );
}
