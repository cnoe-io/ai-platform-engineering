"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import { AuthGuard } from "@/components/auth-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatRelativeTime } from "@/lib/utils";

interface ScheduleRun {
  ts: string | null;
  status: "ok" | "error" | null;
  error: string | null;
  http_status: number | null;
}

interface ScheduleItem {
  schedule_id: string;
  agent_id: string;
  agent_name: string;
  message_template: string;
  pod_id: string | null;
  cron: string;
  tz: string;
  enabled: boolean;
  cronjob_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_run: ScheduleRun | null;
}

interface SchedulesResponse {
  success: boolean;
  data?: {
    items: ScheduleItem[];
    total: number;
  };
  error?: string;
}

interface ScheduleMutationResponse {
  success: boolean;
  data?: ScheduleItem;
  error?: string;
}

function formatDateTime(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatRelative(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatRelativeTime(date);
}

function lastRunLabel(schedule: ScheduleItem): string {
  if (!schedule.last_run?.ts) return "Never";
  const prefix = schedule.last_run.status === "error" ? "Failed" : "Ran";
  return `${prefix} ${formatRelative(schedule.last_run.ts)}`;
}

export default function SchedulesPage() {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSchedules = useCallback(async () => {
    setError(null);
    setRefreshing(true);
    try {
      const response = await fetch("/api/schedules", { cache: "no-store" });
      const body = (await response.json()) as SchedulesResponse;
      if (!response.ok || !body.success || !body.data) {
        throw new Error(body.error || "Failed to load schedules");
      }
      setItems(body.data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  const toggleSchedule = useCallback(async (item: ScheduleItem) => {
    const nextEnabled = !item.enabled;
    const verb = nextEnabled ? "restart" : "pause";

    setError(null);
    setMutatingId(item.schedule_id);
    try {
      const response = await fetch(
        `/api/schedules/${encodeURIComponent(item.schedule_id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: nextEnabled ? "restart" : "pause" }),
        }
      );
      const body = (await response.json()) as ScheduleMutationResponse;
      if (!response.ok || !body.success || !body.data) {
        throw new Error(body.error || `Failed to ${verb} schedule`);
      }
      const updated = body.data;

      setItems((current) =>
        current.map((currentItem) =>
          currentItem.schedule_id === item.schedule_id ? updated : currentItem
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMutatingId(null);
    }
  }, []);

  const stats = useMemo(() => {
    const enabled = items.filter((item) => item.enabled).length;
    const failed = items.filter((item) => item.last_run?.status === "error").length;
    return { enabled, paused: items.length - enabled, failed };
  }, [items]);

  return (
    <AuthGuard>
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-7xl space-y-6 p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                  <CalendarClock className="h-6 w-6 text-primary" />
                  Scheduled Jobs
                </h1>
                <p className="text-sm text-muted-foreground">
                  Recurring agent jobs created for your account.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadSchedules()}
                disabled={refreshing}
              >
                <RefreshCw className={refreshing ? "animate-spin" : ""} />
                Refresh
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Card>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Active
                    </p>
                    <p className="text-2xl font-semibold">{stats.enabled}</p>
                  </div>
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Paused
                    </p>
                    <p className="text-2xl font-semibold">{stats.paused}</p>
                  </div>
                  <Clock3 className="h-5 w-5 text-amber-400" />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Failed Last Run
                    </p>
                    <p className="text-2xl font-semibold">{stats.failed}</p>
                  </div>
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                </CardContent>
              </Card>
            </div>

            {error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            <div className="overflow-hidden rounded-lg border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1060px] text-sm">
                  <thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Job</th>
                      <th className="px-4 py-3 text-left font-medium">Schedule</th>
                      <th className="px-4 py-3 text-left font-medium">Message</th>
                      <th className="px-4 py-3 text-left font-medium">Last Run</th>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="px-4 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td className="px-4 py-8 text-center text-muted-foreground" colSpan={6}>
                          Loading scheduled jobs...
                        </td>
                      </tr>
                    ) : items.length === 0 ? (
                      <tr>
                        <td className="px-4 py-8 text-center text-muted-foreground" colSpan={6}>
                          No scheduled jobs yet.
                        </td>
                      </tr>
                    ) : (
                      items.map((item) => (
                        <tr key={item.schedule_id} className="border-b last:border-b-0">
                          <td className="px-4 py-3 align-top">
                            <div className="space-y-1">
                              <div className="font-medium">{item.agent_name}</div>
                              <div className="font-mono text-xs text-muted-foreground">
                                {item.schedule_id}
                              </div>
                              {item.cronjob_name && (
                                <div className="font-mono text-xs text-muted-foreground">
                                  {item.cronjob_name}
                                </div>
                              )}
                              {item.pod_id && (
                                <Badge variant="outline" className="mt-1">
                                  {item.pod_id}
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="space-y-1">
                              <div className="font-mono">{item.cron}</div>
                              <div className="text-xs text-muted-foreground">{item.tz}</div>
                              <div className="text-xs text-muted-foreground">
                                Created {formatRelative(item.created_at)}
                              </div>
                            </div>
                          </td>
                          <td className="max-w-md px-4 py-3 align-top">
                            <code className="block max-h-24 overflow-hidden whitespace-pre-wrap break-words rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                              {item.message_template}
                            </code>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="space-y-1">
                              <div>{lastRunLabel(item)}</div>
                              {item.last_run?.ts && (
                                <div className="text-xs text-muted-foreground">
                                  {formatDateTime(item.last_run.ts)}
                                </div>
                              )}
                              {item.last_run?.error && (
                                <div className="max-w-xs break-words text-xs text-red-300">
                                  {item.last_run.error}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <Badge
                              variant={item.enabled ? "status" : "secondary"}
                              className={item.enabled ? "" : "text-muted-foreground"}
                            >
                              {item.enabled ? "Enabled" : "Paused"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right align-top">
                            <Button
                              variant={item.enabled ? "outline" : "default"}
                              size="sm"
                              className="min-w-28"
                              onClick={() => void toggleSchedule(item)}
                              disabled={mutatingId === item.schedule_id}
                              title={
                                item.enabled
                                  ? "Pause scheduled runs"
                                  : "Restart scheduled runs"
                              }
                              aria-label={
                                item.enabled
                                  ? `Pause ${item.schedule_id}`
                                  : `Restart ${item.schedule_id}`
                              }
                            >
                              {mutatingId === item.schedule_id ? (
                                <RefreshCw className="animate-spin" />
                              ) : item.enabled ? (
                                <Pause />
                              ) : (
                                <Play />
                              )}
                              {item.enabled ? "Pause" : "Restart"}
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </AuthGuard>
  );
}
