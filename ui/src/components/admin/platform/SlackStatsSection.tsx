"use client";

import { SimpleLineChart } from "@/components/admin/shared/SimpleLineChart";
import { AsyncStatsCard } from "@/components/admin/insights/AsyncStatsCard";
import {
Card,
CardContent,
CardDescription,
CardHeader,
CardTitle,
} from "@/components/ui/card";
import type { AdminSlackStats } from "@/types/admin-stats";
import { Hash } from "lucide-react";

interface SlackStatsSectionProps {
  error?: string | null;
  loading?: boolean;
  rangeLabel: string;
  slack?: AdminSlackStats;
}

export function SlackStatsSection({ error, loading = false, slack, rangeLabel }: SlackStatsSectionProps) {
  if (!slack && !loading && !error) return null;

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center gap-2 pt-2">
        <Hash className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Slack</h3>
      </div>
      <div className="h-px bg-border" />

      {/* Configured Channels */}
      {(slack?.configured_channels !== undefined || loading) && (
        <AsyncStatsCard
          error={error}
          loading={loading}
          minHeightClassName="min-h-72"
          testId="stats-card-slack-configured-channels"
        >
          {slack?.configured_channels !== undefined ? <Card>
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
          </Card> : undefined}
        </AsyncStatsCard>
      )}

      {/* Daily Activity Chart */}
      {((slack?.daily.length ?? 0) > 0 || loading) && (
        <AsyncStatsCard
          error={error}
          loading={loading}
          minHeightClassName="min-h-80"
          testId="stats-card-slack-daily-activity"
        >
          {slack && slack.daily.length > 0 ? <Card>
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
            <div className="mt-4 grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-lg font-bold">
                  {Math.round(slack.daily.reduce((sum, d) => sum + d.interactions, 0) / Math.max(slack.daily.length, 1))}
                </p>
                <p className="text-xs text-muted-foreground">Avg/Day</p>
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
          </Card> : undefined}
        </AsyncStatsCard>
      )}

      {/* Top Channels */}
      <AsyncStatsCard
        error={error}
        loading={loading}
        minHeightClassName="min-h-56"
        testId="stats-card-slack-top-channels"
      >
        {slack ? <Card>
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
                      {channel.interactions} interactions
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
        </Card> : undefined}
      </AsyncStatsCard>
    </div>
  );
}
