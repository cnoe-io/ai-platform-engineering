"use client";

import { SimpleLineChart } from "@/components/admin/shared/SimpleLineChart";
import {
Card,
CardContent,
CardDescription,
CardHeader,
CardTitle,
} from "@/components/ui/card";
import { CheckCircle2,Hash } from "lucide-react";

interface SlackStats {
  channels: {
    total: number;
    qanda_enabled: number;
    alerts_enabled: number;
    ai_enabled: number;
  };
  total_interactions: number;
  unique_users: number;
  configured_channels?: number;
  configured_channels_daily?: Array<{
    date: string;
    total: number;
  }>;
  resolution: {
    total_threads: number;
    resolved_threads: number;
    resolution_rate: number;
    estimated_hours_saved: number;
  };
  daily: Array<{
    date: string;
    interactions: number;
    unique_users: number;
    resolved: number;
    escalated: number;
  }>;
  top_channels: Array<{
    channel_name: string;
    interactions: number;
    resolved: number;
    resolution_rate: number;
  }>;
}

interface SlackStatsSectionProps {
  slack: SlackStats;
  rangeLabel: string;
}

export function SlackStatsSection({ slack, rangeLabel }: SlackStatsSectionProps) {
  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center gap-2 pt-2">
        <Hash className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Slack</h3>
      </div>
      <div className="h-px bg-border" />

      {/* Configured Channels */}
      {slack.configured_channels !== undefined && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Hash className="h-5 w-5" />
              Configured Channels
            </CardTitle>
            <CardDescription>Slack channels wired to an agent</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-bold">{slack.configured_channels.toLocaleString()}</p>
              <p className="text-sm text-muted-foreground">currently configured</p>
            </div>
            {slack.configured_channels_daily && slack.configured_channels_daily.length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-muted-foreground mb-2">Configured channels over time ({rangeLabel})</p>
                <SimpleLineChart
                  data={slack.configured_channels_daily.map((point) => ({
                    label: new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    value: point.total,
                  }))}
                  height={160}
                  color="rgb(168, 85, 247)"
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Daily Activity Chart */}
      {slack.daily.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Daily Slack Activity ({rangeLabel})</CardTitle>
            <CardDescription>Thread interactions per day</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleLineChart
              data={slack.daily.map((day) => ({
                label: new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                value: day.interactions,
              }))}
              height={200}
              color="rgb(59, 130, 246)"
            />
            <div className="mt-4 grid grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-lg font-bold">
                  {Math.round(slack.daily.reduce((sum, d) => sum + d.interactions, 0) / Math.max(slack.daily.length, 1))}
                </p>
                <p className="text-xs text-muted-foreground">Avg/Day</p>
              </div>
              <div>
                <p className="text-lg font-bold text-green-500">
                  {slack.daily.reduce((sum, d) => sum + d.resolved, 0).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Resolved</p>
              </div>
              <div>
                <p className="text-lg font-bold text-orange-500">
                  {slack.daily.reduce((sum, d) => sum + d.escalated, 0).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Escalated</p>
              </div>
              <div>
                <p className="text-lg font-bold text-purple-500">
                  {Math.round(slack.daily.reduce((sum, d) => sum + d.unique_users, 0) / Math.max(slack.daily.length, 1))}
                </p>
                <p className="text-xs text-muted-foreground">Avg Users/Day</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resolution + Top Channels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Self-Resolution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              Self-Resolution
            </CardTitle>
            <CardDescription>User questions resolved without human escalation (excludes bot/alert posts)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-green-500">
                    {slack.resolution.resolved_threads.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    / {slack.resolution.total_threads.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-primary">
                    {slack.resolution.resolution_rate}%
                  </p>
                  <p className="text-xs text-muted-foreground">Rate</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-blue-500">
                    ~{slack.resolution.estimated_hours_saved}h
                  </p>
                  <p className="text-xs text-muted-foreground">Est. Hours Saved</p>
                </div>
              </div>
              {/* Resolution bar */}
              {slack.resolution.total_threads > 0 && (
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Resolution Rate</span>
                    <span>{slack.resolution.resolution_rate}%</span>
                  </div>
                  <div className="h-2.5 bg-orange-100 dark:bg-orange-900/20 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full transition-all"
                      style={{ width: `${slack.resolution.resolution_rate}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Top Channels */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Hash className="h-5 w-5" />
              Top Channels
            </CardTitle>
            <CardDescription>Most active Slack channels</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {slack.top_channels.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No channel data yet</p>
              ) : slack.top_channels.map((channel, i) => {
                const maxCount = slack.top_channels[0].interactions;
                const pct = maxCount > 0 ? (channel.interactions / maxCount) * 100 : 0;
                return (
                  <div key={channel.channel_name}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-6 text-sm text-muted-foreground">#{i + 1}</div>
                        <div className="text-sm font-medium">{channel.channel_name}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {channel.interactions} ({channel.resolution_rate}% resolved)
                      </div>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden ml-8">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
