"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock3,
  History,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";
import { AuthGuard } from "@/components/auth-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { getConfig } from "@/lib/config";
import { formatRelativeTime } from "@/lib/utils";
import { useChatStore } from "@/store/chat-store";

interface ScheduleRun {
  ts: string | null;
  status: "ok" | "error" | null;
  error: string | null;
  http_status: number | null;
}

interface ScheduleVersion {
  version: number;
  superseded_at: string | null;
  changed_fields: string[];
  agent_id: string;
  message_template: string;
  pod_id: string | null;
  cron: string;
  tz: string;
  enabled: boolean;
  cronjob_name: string | null;
  created_at: string | null;
  updated_at: string | null;
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
  version: number;
  versions: ScheduleVersion[];
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

function changedFieldsLabel(version: ScheduleVersion): string {
  return version.changed_fields.length > 0
    ? version.changed_fields.join(", ")
    : "settings";
}

export default function SchedulesPage() {
  const router = useRouter();
  const createConversation = useChatStore((state) => state.createConversation);
  const setPendingMessage = useChatStore((state) => state.setPendingMessage);
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [chattingId, setChattingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<ScheduleItem | null>(null);
  const [editCron, setEditCron] = useState("");
  const [editTz, setEditTz] = useState("");
  const [editMessage, setEditMessage] = useState("");

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

  const openEditor = useCallback((item: ScheduleItem) => {
    setEditingItem(item);
    setEditCron(item.cron);
    setEditTz(item.tz);
    setEditMessage(item.message_template);
  }, []);

  const applyUpdatedSchedule = useCallback((updated: ScheduleItem) => {
    setItems((current) =>
      current.map((currentItem) =>
        currentItem.schedule_id === updated.schedule_id ? updated : currentItem
      )
    );
    setEditingItem((current) =>
      current?.schedule_id === updated.schedule_id ? updated : current
    );
    setEditCron(updated.cron);
    setEditTz(updated.tz);
    setEditMessage(updated.message_template);
  }, []);

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
      applyUpdatedSchedule(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMutatingId(null);
    }
  }, [applyUpdatedSchedule]);

  const patchSchedule = useCallback(
    async (
      item: ScheduleItem,
      patch: {
        cron?: string;
        tz?: string;
        message_template?: string;
        enabled?: boolean;
      },
      failureMessage: string
    ) => {
      setError(null);
      setMutatingId(item.schedule_id);
      try {
        const response = await fetch(
          `/api/schedules/${encodeURIComponent(item.schedule_id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          }
        );
        const body = (await response.json()) as ScheduleMutationResponse;
        if (!response.ok || !body.success || !body.data) {
          throw new Error(body.error || failureMessage);
        }
        applyUpdatedSchedule(body.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setMutatingId(null);
      }
    },
    [applyUpdatedSchedule]
  );

  const saveEdit = useCallback(async () => {
    if (!editingItem) return;
    await patchSchedule(
      editingItem,
      {
        cron: editCron,
        tz: editTz,
        message_template: editMessage,
      },
      "Failed to update schedule"
    );
  }, [editCron, editMessage, editTz, editingItem, patchSchedule]);

  const rollbackToVersion = useCallback(
    async (version: ScheduleVersion) => {
      if (!editingItem) return;
      await patchSchedule(
        editingItem,
        {
          cron: version.cron,
          tz: version.tz,
          message_template: version.message_template,
          enabled: version.enabled,
        },
        "Failed to roll back schedule"
      );
    },
    [editingItem, patchSchedule]
  );

  const chatWithEditorAgent = useCallback(
    async (item: ScheduleItem) => {
      setError(null);
      setChattingId(item.schedule_id);
      try {
        const scheduleEditorAgentId = getConfig("scheduleEditorAgentId")?.trim() || undefined;
        const conversationId = await createConversation(scheduleEditorAgentId);
        setPendingMessage(
          [
            "Help me modify this scheduled job.",
            "",
            `schedule_id: ${item.schedule_id}`,
            `agent_id: ${item.agent_id}`,
            `pod_id: ${item.pod_id || "none"}`,
            `cron: ${item.cron}`,
            `timezone: ${item.tz}`,
            `enabled: ${item.enabled}`,
            "",
            "Current message_template:",
            item.message_template,
            "",
            "Please fetch the schedule first, verify it belongs to me, then help me make the change safely.",
          ].join("\n")
        );
        router.push(`/chat/${conversationId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setChattingId(null);
      }
    },
    [createConversation, router, setPendingMessage]
  );

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

            <Dialog
              open={Boolean(editingItem)}
              onOpenChange={(open) => {
                if (!open) setEditingItem(null);
              }}
            >
              <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden">
                {editingItem && (
                  <>
                    <DialogHeader>
                      <DialogTitle>Modify Scheduled Job</DialogTitle>
                      <DialogDescription>
                        {editingItem.schedule_id}
                      </DialogDescription>
                    </DialogHeader>

                    <ScrollArea className="max-h-[68vh] pr-4">
                      <div className="space-y-5">
                        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
                          <div className="space-y-2">
                            <Label htmlFor="schedule-cron">Cron</Label>
                            <Input
                              id="schedule-cron"
                              value={editCron}
                              onChange={(event) => setEditCron(event.target.value)}
                              className="font-mono"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="schedule-tz">Timezone</Label>
                            <Input
                              id="schedule-tz"
                              value={editTz}
                              onChange={(event) => setEditTz(event.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Status</Label>
                            <div className="flex h-10 items-center">
                              <Badge
                                variant={editingItem.enabled ? "status" : "secondary"}
                                className={editingItem.enabled ? "" : "text-muted-foreground"}
                              >
                                {editingItem.enabled ? "Enabled" : "Paused"}
                              </Badge>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="schedule-message">Message</Label>
                          <Textarea
                            id="schedule-message"
                            value={editMessage}
                            onChange={(event) => setEditMessage(event.target.value)}
                            className="min-h-56 font-mono text-xs"
                          />
                        </div>

                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-xs text-muted-foreground">
                            Agent {editingItem.agent_name} - Version {editingItem.version || 1}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void chatWithEditorAgent(editingItem)}
                            disabled={chattingId === editingItem.schedule_id}
                          >
                            {chattingId === editingItem.schedule_id ? (
                              <RefreshCw className="animate-spin" />
                            ) : (
                              <Bot />
                            )}
                            Chat with agent
                          </Button>
                        </div>

                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <History className="h-4 w-4" />
                            Previous Versions
                          </div>
                          {editingItem.versions.length === 0 ? (
                            <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                              No previous versions yet.
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {editingItem.versions.map((version) => (
                                <div
                                  key={`${version.version}-${version.superseded_at || "unknown"}`}
                                  className="rounded-md border px-3 py-3"
                                >
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0 space-y-1">
                                      <div className="text-sm font-medium">
                                        Version {version.version}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        {formatDateTime(version.superseded_at)} -{" "}
                                        {changedFieldsLabel(version)}
                                      </div>
                                      <div className="font-mono text-xs">
                                        {version.cron} - {version.tz}
                                      </div>
                                    </div>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="min-w-24"
                                      onClick={() => void rollbackToVersion(version)}
                                      disabled={mutatingId === editingItem.schedule_id}
                                    >
                                      {mutatingId === editingItem.schedule_id ? (
                                        <RefreshCw className="animate-spin" />
                                      ) : (
                                        <RotateCcw />
                                      )}
                                      Rollback
                                    </Button>
                                  </div>
                                  <code className="mt-2 block max-h-20 overflow-hidden whitespace-pre-wrap break-words rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                    {version.message_template}
                                  </code>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </ScrollArea>

                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setEditingItem(null)}
                      >
                        Close
                      </Button>
                      <Button
                        onClick={() => void saveEdit()}
                        disabled={mutatingId === editingItem.schedule_id}
                      >
                        {mutatingId === editingItem.schedule_id ? (
                          <RefreshCw className="animate-spin" />
                        ) : (
                          <Save />
                        )}
                        Save
                      </Button>
                    </DialogFooter>
                  </>
                )}
              </DialogContent>
            </Dialog>

            <div className="overflow-hidden rounded-lg border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1160px] text-sm">
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
                                Version {item.version || 1}
                              </div>
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
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="min-w-24"
                                onClick={() => openEditor(item)}
                                disabled={mutatingId === item.schedule_id}
                                title="Modify schedule"
                                aria-label={`Modify ${item.schedule_id}`}
                              >
                                <Pencil />
                                Modify
                              </Button>
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
                            </div>
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
