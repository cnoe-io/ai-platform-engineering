"use client";

import React from "react";
import { motion } from "framer-motion";
import {
  Lock,
  Users,
  Globe,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
  Layers,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SkillRunStats } from "@/types/agent-config";

// ---------------------------------------------------------------------------
// Visibility Breakdown
// ---------------------------------------------------------------------------

interface VisibilityBreakdownProps {
  byVisibility: { private: number; team: number; global: number };
  total: number;
}

export function VisibilityBreakdown({ byVisibility, total }: VisibilityBreakdownProps) {
  const items = [
    { label: "Private", value: byVisibility.private, icon: Lock, color: "text-amber-500", bg: "bg-amber-500/10" },
    { label: "Team", value: byVisibility.team, icon: Users, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Global", value: byVisibility.global, icon: Globe, color: "text-green-500", bg: "bg-green-500/10" },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map((item) => (
        <div key={item.label} className={cn("flex flex-col items-center p-3 rounded-lg", item.bg)}>
          <item.icon className={cn("h-4 w-4 mb-1", item.color)} />
          <p className={cn("text-xl font-bold", item.color)}>{item.value}</p>
          <p className="text-[10px] text-muted-foreground">{item.label}</p>
          {total > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {Math.round((item.value / total) * 100)}%
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category Breakdown
// ---------------------------------------------------------------------------

interface CategoryBreakdownProps {
  byCategory: Array<{ category: string; count: number }>;
}

export function CategoryBreakdown({ byCategory }: CategoryBreakdownProps) {
  if (byCategory.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No skills created yet
      </p>
    );
  }

  const maxCount = byCategory[0]?.count || 1;

  return (
    <div className="space-y-2">
      {byCategory.map((cat, i) => (
        <motion.div
          key={cat.category}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.03 }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm">{cat.category}</span>
            <span className="text-xs text-muted-foreground">{cat.count}</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${(cat.count / maxCount) * 100}%` }}
            />
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run Stats Table
// ---------------------------------------------------------------------------

interface RunStatsTableProps {
  runStats: SkillRunStats[];
  title?: string;
  description?: string;
}

export function RunStatsTable({
  runStats,
  title = "Skill Execution Stats",
  description = "Run history by skill",
}: RunStatsTableProps) {
  if (runStats.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 space-y-2">
            <Zap className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">No skill runs yet.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {runStats.map((stat, i) => {
            const rate = stat.success_rate;
            return (
              <motion.div
                key={stat.skill_id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-center gap-4 p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-muted/30 transition-all"
              >
                <div className="shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Layers className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{stat.skill_name}</p>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="text-xs text-muted-foreground">
                      {stat.total_runs} run{stat.total_runs !== 1 ? "s" : ""}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-green-500">
                      <CheckCircle className="h-3 w-3" />
                      {stat.completed}
                    </span>
                    {stat.failed > 0 && (
                      <span className="flex items-center gap-1 text-xs text-red-500">
                        <XCircle className="h-3 w-3" />
                        {stat.failed}
                      </span>
                    )}
                    {stat.avg_duration_ms != null && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {stat.avg_duration_ms > 60_000
                          ? `${(stat.avg_duration_ms / 60_000).toFixed(1)}m`
                          : `${(stat.avg_duration_ms / 1000).toFixed(1)}s`}
                      </span>
                    )}
                    {stat.last_run && (
                      <>
                        <span className="text-xs text-muted-foreground/50">|</span>
                        <span className="text-xs text-muted-foreground">
                          Last:{" "}
                          {new Date(stat.last_run).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={cn(
                      "text-sm font-bold",
                      rate >= 80 ? "text-green-500" : rate >= 50 ? "text-amber-500" : "text-red-500"
                    )}
                  >
                    {rate}%
                  </p>
                  <p className="text-[10px] text-muted-foreground">success</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Overall Run Stats Card (admin)
// ---------------------------------------------------------------------------

interface OverallRunStatsProps {
  stats: {
    total_runs: number;
    completed: number;
    failed: number;
    success_rate: number;
    avg_duration_ms: number | null;
  };
}

export function OverallRunStatsCard({ stats }: OverallRunStatsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Overall Run Performance
        </CardTitle>
        <CardDescription>Aggregate execution stats across all skills</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 text-center">
          <div className="p-3 rounded-lg bg-primary/10">
            <p className="text-2xl font-bold text-primary">{stats.total_runs}</p>
            <p className="text-xs text-muted-foreground">Total Runs</p>
          </div>
          <div className="p-3 rounded-lg bg-green-500/10">
            <p className="text-2xl font-bold text-green-500">{stats.completed}</p>
            <p className="text-xs text-muted-foreground">Completed</p>
          </div>
          <div className="p-3 rounded-lg bg-red-500/10">
            <p className="text-2xl font-bold text-red-500">{stats.failed}</p>
            <p className="text-xs text-muted-foreground">Failed</p>
          </div>
          <div className="p-3 rounded-lg bg-blue-500/10">
            <p
              className={cn(
                "text-2xl font-bold",
                stats.success_rate >= 80
                  ? "text-green-500"
                  : stats.success_rate >= 50
                    ? "text-amber-500"
                    : "text-red-500"
              )}
            >
              {stats.success_rate}%
            </p>
            <p className="text-xs text-muted-foreground">Success Rate</p>
          </div>
          <div className="p-3 rounded-lg bg-purple-500/10">
            <p className="text-2xl font-bold text-purple-500">
              {stats.avg_duration_ms != null
                ? stats.avg_duration_ms > 60_000
                  ? `${(stats.avg_duration_ms / 60_000).toFixed(1)}m`
                  : `${(stats.avg_duration_ms / 1000).toFixed(1)}s`
                : "—"}
            </p>
            <p className="text-xs text-muted-foreground">Avg Duration</p>
          </div>
        </div>
        {stats.total_runs > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Success Rate</span>
              <span>{stats.success_rate}%</span>
            </div>
            <div className="h-2.5 bg-red-100 dark:bg-red-900/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${stats.success_rate}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Top Creators Leaderboard
// ---------------------------------------------------------------------------

interface TopCreatorsProps {
  creators: Array<{ email: string; count: number }>;
}

export function TopCreatorsCard({ creators }: TopCreatorsProps) {
  if (creators.length === 0) {
    return null;
  }

  const maxCount = creators[0]?.count || 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Top Skill Creators
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {creators.map((creator, i) => (
            <div key={creator.email}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="w-6 text-sm text-muted-foreground">#{i + 1}</div>
                  <div className="text-sm truncate max-w-[200px]">{creator.email}</div>
                </div>
                <div className="text-sm text-muted-foreground">
                  {creator.count} skill{creator.count !== 1 ? "s" : ""}
                </div>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden ml-8">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${(creator.count / maxCount) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
