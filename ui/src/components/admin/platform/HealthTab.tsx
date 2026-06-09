"use client";

import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { useServiceHealth,type HealthStatus } from "@/hooks/use-service-health";
import { cn } from "@/lib/utils";
import {
AlertTriangle,
CheckCircle2,
Database,
HelpCircle,
Loader2,
MessageSquare,
RefreshCw,
Server,
Shield,
XCircle,
} from "lucide-react";
import React,{ useCallback,useEffect,useState } from "react";

const STATUS_CONFIG: Record<
  HealthStatus,
  { icon: typeof CheckCircle2; color: string; bg: string; label: string }
> = {
  healthy: {
    icon: CheckCircle2,
    color: "text-green-500",
    bg: "bg-green-500",
    label: "Healthy",
  },
  degraded: {
    icon: AlertTriangle,
    color: "text-yellow-500",
    bg: "bg-yellow-500",
    label: "Degraded",
  },
  down: {
    icon: XCircle,
    color: "text-red-500",
    bg: "bg-red-500",
    label: "Down",
  },
  unknown: {
    icon: HelpCircle,
    color: "text-muted-foreground",
    bg: "bg-muted-foreground",
    label: "Unknown",
  },
};

interface HealthTabProps {
  ssoEnabled?: boolean;
  mongodbEnabled?: boolean;
  ragEnabled?: boolean;
}

interface SlackDirectoryStatus {
  configured: boolean;
  bot_admin: { reachable: boolean; error?: string };
  users: {
    status: "warming" | "ready" | "stale" | "empty";
    users_indexed: number;
    active_users_indexed: number;
    pages_scanned: number;
    members_seen: number;
    fetched_at: number | null;
    updated_at: number | null;
    started_at: number | null;
    last_error?: string;
  };
  emoji: {
    status: "warming" | "ready" | "stale" | "empty";
    emoji_indexed: number;
    fetched_at: number | null;
    updated_at: number | null;
    started_at: number | null;
    last_error?: string;
  };
}

export function HealthTab({
  ssoEnabled = true,
  mongodbEnabled = true,
  ragEnabled = true,
}: HealthTabProps) {
  const { services, overall, loading, error, configured, refetch } =
    useServiceHealth({ refreshInterval: 30_000 });

  const overallConfig = STATUS_CONFIG[overall];
  const OverallIcon = overallConfig.icon;
  const [slackStatus, setSlackStatus] = useState<SlackDirectoryStatus | null>(null);
  const [slackLoading, setSlackLoading] = useState(false);
  const [slackError, setSlackError] = useState<string | null>(null);

  const loadSlackStatus = useCallback(async () => {
    setSlackLoading(true);
    setSlackError(null);
    try {
      const res = await fetch("/api/admin/slack/directory/status");
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error(payload?.error || "Failed to load Slack status");
      setSlackStatus(payload.data);
    } catch (err) {
      setSlackError(err instanceof Error ? err.message : "Failed to load Slack status");
    } finally {
      setSlackLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSlackStatus();
  }, [loadSlackStatus]);

  useEffect(() => {
    if (!slackStatus || (slackStatus.users.status !== "warming" && slackStatus.emoji.status !== "warming")) return;
    const id = window.setInterval(() => void loadSlackStatus(), 5000);
    return () => window.clearInterval(id);
  }, [loadSlackStatus, slackStatus]);

  // Separate agent-specific services from platform services
  const agentServices = services.filter((s) => s.name.startsWith("Agent: "));
  const platformServices = services.filter((s) => !s.name.startsWith("Agent: "));

  return (
    <div className="space-y-4">
      {/* Overall Status Banner */}
      {configured && !loading && (
        <Card className={cn(
          "border-l-4",
          overall === "healthy" && "border-l-green-500",
          overall === "degraded" && "border-l-yellow-500",
          overall === "down" && "border-l-red-500",
          overall === "unknown" && "border-l-muted-foreground",
        )}>
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <OverallIcon className={cn("h-6 w-6", overallConfig.color)} />
              <div>
                <p className="font-medium">System Status: {overallConfig.label}</p>
                <p className="text-xs text-muted-foreground">
                  {platformServices.filter((s) => s.status === "healthy").length} of{" "}
                  {platformServices.length} platform services healthy
                  {agentServices.length > 0 && (
                    <> · {agentServices.filter((s) => s.status === "healthy").length} of{" "}
                    {agentServices.length} agents enabled</>
                  )}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={refetch}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Refresh
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Platform Services */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Services</CardTitle>
          <CardDescription>
            {configured
              ? "Live health status from Prometheus metrics"
              : "Set PROMETHEUS_URL to enable live health monitoring"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {/* Static services (always shown) */}
            <ServiceRow
              name="MongoDB"
              description="Database connection"
              icon={<Database className="h-4 w-4 text-muted-foreground" />}
              status={mongodbEnabled ? "healthy" : "unknown"}
              detail={mongodbEnabled ? "Connected" : "Not configured"}
            />
            <ServiceRow
              name="Authentication"
              description="OIDC SSO"
              icon={<Shield className="h-4 w-4 text-muted-foreground" />}
              status={ssoEnabled ? "healthy" : "unknown"}
              detail={ssoEnabled ? "Active" : "Disabled"}
            />
            <ServiceRow
              name="RAG Server"
              description="Knowledge base operations"
              icon={<Server className="h-4 w-4 text-muted-foreground" />}
              status={ragEnabled ? "healthy" : "unknown"}
              detail={ragEnabled ? "Operational" : "Disabled"}
            />
            <SlackIntegrationStatus
              status={slackStatus}
              loading={slackLoading}
              error={slackError}
              onRefresh={loadSlackStatus}
            />

            {/* Prometheus-sourced platform services */}
            {configured && platformServices.map((svc) => (
              <ServiceRow
                key={svc.name}
                name={svc.name}
                status={svc.status}
                detail={svc.detail}
              />
            ))}

            {loading && services.length === 0 && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground ml-2">
                  Loading metrics...
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Agent Status */}
      {configured && agentServices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Agent Status</CardTitle>
            <CardDescription>Individual sub-agent availability</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {agentServices.map((svc) => {
                const cfg = STATUS_CONFIG[svc.status];
                const Icon = cfg.icon;
                return (
                  <div
                    key={svc.name}
                    className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", cfg.color)} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {svc.name.replace("Agent: ", "")}
                      </p>
                      <p className="text-xs text-muted-foreground">{svc.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="py-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// ServiceRow — single service status row
// ────────────────────────────────────────────────────────────────

function ServiceRow({
  name,
  description,
  icon,
  status,
  detail,
}: {
  name: string;
  description?: string;
  icon?: React.ReactNode;
  status: HealthStatus;
  detail: string;
}) {
  const cfg = STATUS_CONFIG[status];

  return (
    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <p className="text-sm font-medium">{name}</p>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className={cn("h-2 w-2 rounded-full", cfg.bg)} />
        <span className="text-sm">{detail}</span>
      </div>
    </div>
  );
}

function cacheStateToHealth(status: SlackDirectoryStatus["users"]["status"], error?: string): HealthStatus {
  if (error) return "degraded";
  if (status === "ready") return "healthy";
  if (status === "warming" || status === "stale") return "degraded";
  return "unknown";
}

function formatTime(ts: number | null | undefined): string {
  if (!ts) return "never";
  return new Date(ts).toLocaleTimeString();
}

function SlackIntegrationStatus({
  status,
  loading,
  error,
  onRefresh,
}: {
  status: SlackDirectoryStatus | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void | Promise<void>;
}) {
  if (error && !status) {
    return (
      <ServiceRow
        name="Slack Integration"
        description="Bot admin API and Slack directory caches"
        icon={<MessageSquare className="h-4 w-4 text-muted-foreground" />}
        status="degraded"
        detail={error}
      />
    );
  }

  const botStatus: HealthStatus = status?.bot_admin.reachable ? "healthy" : status ? "degraded" : "unknown";
  const userStatus = status ? cacheStateToHealth(status.users.status, status.users.last_error) : "unknown";
  const emojiStatus = status ? cacheStateToHealth(status.emoji.status, status.emoji.last_error) : "unknown";
  const overallStatus: HealthStatus =
    [botStatus, userStatus, emojiStatus].includes("down") ? "down"
      : [botStatus, userStatus, emojiStatus].includes("degraded") ? "degraded"
        : [botStatus, userStatus, emojiStatus].every((s) => s === "healthy") ? "healthy"
          : "unknown";
  const cfg = STATUS_CONFIG[overallStatus];

  return (
    <div className="rounded-lg bg-muted/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <MessageSquare className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Slack Integration</p>
            <p className="text-xs text-muted-foreground">Bot admin API and Slack directory caches</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn("h-2 w-2 rounded-full", cfg.bg)} />
          <Button type="button" variant="ghost" size="sm" onClick={() => void onRefresh()} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
      <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
        <div className="rounded-md border bg-background/60 p-2">
          <div className="font-medium">Bot admin API</div>
          <div className={status?.bot_admin.reachable ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
            {status ? (status.bot_admin.reachable ? "reachable" : "unreachable") : "checking"}
          </div>
          {status?.bot_admin.error && <div className="mt-1 text-muted-foreground line-clamp-2">{status.bot_admin.error}</div>}
        </div>
        <div className="rounded-md border bg-background/60 p-2">
          <div className="font-medium">User directory cache</div>
          <div className="text-muted-foreground">
            {status ? `${status.users.status}: ${status.users.active_users_indexed} active / ${status.users.users_indexed} indexed` : "checking"}
          </div>
          {status && (
            <div className="text-muted-foreground">
              {status.users.pages_scanned} pages · {status.users.members_seen} Slack records · updated {formatTime(status.users.updated_at)}
            </div>
          )}
          {status?.users.last_error && <div className="mt-1 text-amber-700 dark:text-amber-400 line-clamp-2">{status.users.last_error}</div>}
        </div>
        <div className="rounded-md border bg-background/60 p-2">
          <div className="font-medium">Emoji cache</div>
          <div className="text-muted-foreground">
            {status ? `${status.emoji.status}: ${status.emoji.emoji_indexed} emoji indexed` : "checking"}
          </div>
          {status && <div className="text-muted-foreground">updated {formatTime(status.emoji.updated_at)}</div>}
          {status?.emoji.last_error && <div className="mt-1 text-amber-700 dark:text-amber-400 line-clamp-2">{status.emoji.last_error}</div>}
        </div>
      </div>
    </div>
  );
}
