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
  Lightbulb,
  BarChart3,
  FileText,
  Zap,
  Database,
  Layers,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { AuthGuard } from "@/components/auth-guard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SimpleLineChart } from "@/components/admin/SimpleLineChart";
import {
  VisibilityBreakdown,
  CategoryBreakdown,
  RunStatsTable,
} from "@/components/admin/SkillMetricsCards";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { cn } from "@/lib/utils";
import { getStorageMode } from "@/lib/storage-config";
import type { SkillMetricsPersonal } from "@/types/agent-config";

// ─── Types ───────────────────────────────────────────────────────
interface SkillUsageEntry {
  category: string;
  total_runs: number;
  completed: number;
  failed: number;
  last_run: string | null;
}

interface InsightsData {
  overview: {
    total_conversations: number;
    total_messages: number;
    total_tokens_used: number;
    conversations_this_week: number;
    messages_this_week: number;
    avg_messages_per_conversation: number;
  };
  skill_usage: SkillUsageEntry[];
  /** @deprecated Use skill_usage instead — kept for backward compatibility */
  recent_prompts?: Array<{
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
  const [skillMetrics, setSkillMetrics] = useState<SkillMetricsPersonal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const storageMode = getStorageMode();
  const mongoEnabled = storageMode === "mongodb";

  useEffect(() => {
    if (!mongoEnabled) return;
    if (status !== "authenticated") return;

    const loadInsights = async () => {
      try {
        setLoading(true);
        setError(null);
        const [res, skillsRes] = await Promise.all([
          fetch("/api/users/me/insights"),
          fetch("/api/users/me/insights/skills").catch(() => null),
        ]);
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

        if (skillsRes?.ok) {
          const skillsJson = await skillsRes.json();
          if (skillsJson.success) setSkillMetrics(skillsJson.data);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadInsights();
  }, [status, mongoEnabled]);

  // Insights requires MongoDB for persistent storage of conversations/messages
  if (!mongoEnabled) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center space-y-3">
            <Database className="h-10 w-10 text-muted-foreground mx-auto" />
            <h2 className="text-lg font-semibold">MongoDB Required</h2>
            <p className="text-sm text-muted-foreground">
              Personal Insights requires MongoDB for persistent storage.
              Configure MongoDB to enable usage analytics and prompt history.
            </p>
            <button
              onClick={() => router.push("/chat")}
              className="mt-4 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Go to Chat
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

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

        {/* Skill Usage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Skill Usage
            </CardTitle>
            <CardDescription>
              Agent Skills you have invoked, grouped by category
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.skill_usage.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <Zap className="h-8 w-8 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">
                  No skill runs yet. Run an Agent Skill to see your usage here.
                </p>
                <button
                  onClick={() => router.push("/agent-builder")}
                  className="mt-2 px-4 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Browse Agent Skills
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {data.skill_usage.map((skill, i) => {
                  const successRate =
                    skill.total_runs > 0
                      ? Math.round((skill.completed / skill.total_runs) * 100)
                      : 0;
                  return (
                    <motion.div
                      key={skill.category}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="flex items-center gap-4 p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-muted/30 transition-all"
                    >
                      {/* Category badge */}
                      <div className="shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Zap className="h-5 w-5 text-primary" />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{skill.category}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-muted-foreground">
                            {skill.total_runs} run{skill.total_runs !== 1 ? "s" : ""}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-green-500">
                            <CheckCircle className="h-3 w-3" />
                            {skill.completed}
                          </span>
                          {skill.failed > 0 && (
                            <span className="flex items-center gap-1 text-xs text-red-500">
                              <XCircle className="h-3 w-3" />
                              {skill.failed}
                            </span>
                          )}
                          {skill.last_run && (
                            <>
                              <span className="text-xs text-muted-foreground/50">|</span>
                              <span className="text-xs text-muted-foreground">
                                Last: {new Date(skill.last_run).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Success rate */}
                      <div className="shrink-0 text-right">
                        <p className={cn(
                          "text-sm font-bold",
                          successRate >= 80 ? "text-green-500" :
                          successRate >= 50 ? "text-amber-500" : "text-red-500"
                        )}>
                          {successRate}%
                        </p>
                        <p className="text-[10px] text-muted-foreground">success</p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Skills Portfolio */}
        {skillMetrics && skillMetrics.total_skills > 0 && (
          <>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 pt-2"
            >
              <div className="p-2 rounded-xl bg-primary/10">
                <Layers className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-bold">Skills Portfolio</h2>
                <p className="text-sm text-muted-foreground">
                  You&apos;ve created {skillMetrics.total_skills} skill{skillMetrics.total_skills !== 1 ? "s" : ""}
                </p>
              </div>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Visibility Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <VisibilityBreakdown
                    byVisibility={skillMetrics.by_visibility}
                    total={skillMetrics.total_skills}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Skills by Category</CardTitle>
                </CardHeader>
                <CardContent>
                  <CategoryBreakdown byCategory={skillMetrics.by_category} />
                </CardContent>
              </Card>
            </div>

            {skillMetrics.daily_created.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Skills Created (Last 30 Days)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <SimpleLineChart
                    data={skillMetrics.daily_created.map((d) => ({
                      label: new Date(d.date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      }),
                      value: d.count,
                    }))}
                    height={200}
                    color="rgb(139, 92, 246)"
                  />
                </CardContent>
              </Card>
            )}

            <RunStatsTable
              runStats={skillMetrics.run_stats}
              title="Your Skill Execution Stats"
              description="Run history for skills you created"
            />
          </>
        )}
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
