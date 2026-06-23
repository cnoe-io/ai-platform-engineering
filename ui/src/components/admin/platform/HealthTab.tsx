// assisted-by Codex Codex-sonnet-4-6
"use client";

import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { usePlatformHealthProbes,type PlatformHealthProbe } from "@/hooks/use-platform-health-probes";
import { useServiceHealth,type HealthStatus } from "@/hooks/use-service-health";
import {
PROMETHEUS_SETUP_GUIDANCE,
PROMETHEUS_UNAVAILABLE_MESSAGE,
type PlatformHealthRemediationLink,
} from "@/lib/platform-health-remediation";
import { cn } from "@/lib/utils";
import {
AlertTriangle,
CheckCircle2,
Database,
ExternalLink,
HelpCircle,
Info,
Loader2,
MessageSquare,
RefreshCw,
Server,
Shield,
XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import React,{ useCallback,useEffect,useMemo,useState } from "react";

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

interface WebexDirectoryStatus {
  configured: boolean;
  bot_admin: {
    reachable: boolean;
    error?: string;
    runtime?: {
      route_mode?: string;
      static_spaces?: number;
      static_routes?: number;
      cache_size?: number;
    };
  };
  platform: {
    reachable: boolean;
    spaces_onboarded: number;
    routes_configured: number;
    error?: string;
  };
  space_discovery: {
    configured: boolean;
    status: "warming" | "ready" | "stale" | "empty";
    spaces_indexed: number;
    fetched_at: number | null;
    updated_at: number | null;
    started_at: number | null;
    ttl_seconds?: number;
    last_error?: string;
  };
}

export function HealthTab({
  ssoEnabled = true,
  mongodbEnabled = true,
  ragEnabled = true,
}: HealthTabProps) {
  const router = useRouter();
  const { services, overall, loading, error, configured, refetch } =
    useServiceHealth({ refreshInterval: 30_000 });
  const {
    probes: platformProbes,
    summary: platformProbeSummary,
    status: platformProbeStatus,
    checkNow: refreshPlatformProbes,
    secondsUntilNextCheck: platformProbeNextCheck,
  } = usePlatformHealthProbes();

  const prometheusUnavailable = !configured || error === "Prometheus not configured";
  const operationalError =
    error && error !== "Prometheus not configured" ? error : null;

  const systemStatus = useMemo((): HealthStatus => {
    if (platformProbeStatus === "checking") return "unknown";
    if (platformProbeStatus === "down") return "down";
    if (platformProbeStatus === "degraded") return "degraded";
    if (platformProbeStatus === "healthy") {
      if (!prometheusUnavailable && overall !== "unknown") {
        if (overall === "down") return "down";
        if (overall === "degraded") return "degraded";
      }
      return "healthy";
    }
    return overall;
  }, [platformProbeStatus, prometheusUnavailable, overall]);

  const overallConfig = STATUS_CONFIG[systemStatus];
  const OverallIcon = overallConfig.icon;
  const [slackStatus, setSlackStatus] = useState<SlackDirectoryStatus | null>(null);
  const [slackLoading, setSlackLoading] = useState(false);
  const [slackError, setSlackError] = useState<string | null>(null);
  const [webexStatus, setWebexStatus] = useState<WebexDirectoryStatus | null>(null);
  const [webexLoading, setWebexLoading] = useState(false);
  const [webexError, setWebexError] = useState<string | null>(null);

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

  const loadWebexStatus = useCallback(async () => {
    setWebexLoading(true);
    setWebexError(null);
    try {
      const res = await fetch("/api/admin/webex/directory/status");
      const payload = await res.json();
      if (res.status === 404) {
        throw new Error("Webex health API is unavailable. Rebuild or restart the UI service to pick up the latest Health tab.");
      }
      if (!res.ok || !payload.success) throw new Error(payload?.error || "Failed to load Webex status");
      setWebexStatus(payload.data);
    } catch (err) {
      setWebexError(err instanceof Error ? err.message : "Failed to load Webex status");
    } finally {
      setWebexLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSlackStatus();
    void loadWebexStatus();
  }, [loadSlackStatus, loadWebexStatus]);

  useEffect(() => {
    if (!slackStatus || (slackStatus.users.status !== "warming" && slackStatus.emoji.status !== "warming")) return;
    const id = window.setInterval(() => void loadSlackStatus(), 5000);
    return () => window.clearInterval(id);
  }, [loadSlackStatus, slackStatus]);

  useEffect(() => {
    if (!webexStatus || webexStatus.space_discovery.status !== "warming") return;
    const id = window.setInterval(() => void loadWebexStatus(), 5000);
    return () => window.clearInterval(id);
  }, [loadWebexStatus, webexStatus]);

  // Separate agent-specific services from platform services
  const agentServices = services.filter((s) => s.name.startsWith("Agent: "));
  const platformMetricServices = services.filter((s) => !s.name.startsWith("Agent: "));
  const platformProbeIssues = platformProbes.filter((probe) => probe.status !== "healthy");

  const refreshAll = useCallback(() => {
    void refetch();
    refreshPlatformProbes();
    void loadSlackStatus();
    void loadWebexStatus();
  }, [refetch, refreshPlatformProbes, loadSlackStatus, loadWebexStatus]);

  return (
    <div className="space-y-4">
      {/* Overall Status Banner */}
      {(platformProbeSummary || !prometheusUnavailable) && platformProbeStatus !== "checking" && (
        <Card className={cn(
          "border-l-4",
          systemStatus === "healthy" && "border-l-green-500",
          systemStatus === "degraded" && "border-l-yellow-500",
          systemStatus === "down" && "border-l-red-500",
          systemStatus === "unknown" && "border-l-muted-foreground",
        )}>
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <OverallIcon className={cn("h-6 w-6", overallConfig.color)} />
              <div>
                <p className="font-medium">System Status: {overallConfig.label}</p>
                <p className="text-xs text-muted-foreground">
                  {platformProbeSummary
                    ? `${platformProbeSummary.healthy} of ${platformProbeSummary.total} dependency checks passing`
                    : "Running dependency checks"}
                  {configured && !prometheusUnavailable && platformMetricServices.length > 0 && (
                    <> · {platformMetricServices.filter((s) => s.status === "healthy").length} of{" "}
                    {platformMetricServices.length} Prometheus metrics healthy</>
                  )}
                  {agentServices.length > 0 && (
                    <> · {agentServices.filter((s) => s.status === "healthy").length} of{" "}
                    {agentServices.length} agents enabled</>
                  )}
                  {prometheusUnavailable && platformProbeSummary ? (
                    <> · optional Prometheus metrics not configured</>
                  ) : null}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={refreshAll}
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
            {configured && !prometheusUnavailable
              ? "Live dependency checks plus Prometheus-backed agent metrics"
              : PROMETHEUS_UNAVAILABLE_MESSAGE}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Dependency checks</p>
                <p className="text-xs text-muted-foreground">
                  Keycloak, OpenFGA, AgentGateway, databases, RAG stack, and bootstrap migrations
                </p>
              </div>
              {platformProbeSummary ? (
                <span className="text-xs text-muted-foreground">
                  {platformProbeSummary.healthy}/{platformProbeSummary.total} OK · next in {platformProbeNextCheck}s
                </span>
              ) : null}
            </div>

            {platformProbeStatus === "checking" && platformProbes.length === 0 ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground ml-2">Checking platform dependencies...</span>
              </div>
            ) : (
              <div className="space-y-2">
                {platformProbes.map((probe) => (
                  <PlatformProbeRow
                    key={probe.id}
                    probe={probe}
                    onNavigate={(href) => router.push(href)}
                  />
                ))}
              </div>
            )}

            {platformProbeIssues.length > 0 ? (
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                <p className="font-semibold">Remediation tips</p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-amber-900/90 dark:text-amber-100/90">
                  {platformProbeIssues.slice(0, 4).map((probe) => (
                    <li key={probe.id}>
                      <span className="font-medium">{probe.label}:</span>{" "}
                      {probe.remediation?.description ?? probe.detail}
                    </li>
                  ))}
                  {platformProbeIssues.length > 4 ? (
                    <li>{platformProbeIssues.length - 4} more checks need attention.</li>
                  ) : null}
                </ul>
              </div>
            ) : platformProbes.length > 0 ? (
              <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-muted-foreground">
                All dependency checks are passing.
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            <div>
              <p className="text-sm font-medium">Configured integrations</p>
              <p className="text-xs text-muted-foreground">
                Feature flags and integration caches for this deployment
              </p>
            </div>
            <div className="space-y-3">
              <ServiceRow
                name="MongoDB"
                description="Database connection"
                icon={<Database className="h-4 w-4 text-muted-foreground" />}
                status={mongodbEnabled ? "healthy" : "unknown"}
                detail={mongodbEnabled ? "Configured" : "Not configured"}
                remediation={
                  mongodbEnabled
                    ? undefined
                    : {
                        label: "Docs",
                        href: "/admin?cat=metrics&tab=health",
                        description: "Set MONGODB_URI on the UI service and verify the caipe-mongodb container is running.",
                      }
                }
                onNavigate={(href) => router.push(href)}
              />
              <ServiceRow
                name="Authentication"
                description="OIDC SSO"
                icon={<Shield className="h-4 w-4 text-muted-foreground" />}
                status={ssoEnabled ? "healthy" : "unknown"}
                detail={ssoEnabled ? "SSO enabled" : "Disabled"}
                remediation={
                  ssoEnabled
                    ? {
                        label: "Keycloak",
                        href: "/admin?cat=security&tab=keycloak",
                        description: "Review realm reconciliation, IdP mappers, and admin credentials.",
                      }
                    : {
                        label: "Enable SSO",
                        href: "/admin?cat=security&tab=keycloak",
                        description: "Configure OIDC_CLIENT_ID, OIDC_ISSUER, and OIDC_CLIENT_SECRET on the UI service.",
                      }
                }
                onNavigate={(href) => router.push(href)}
              />
              <ServiceRow
                name="RAG Server"
                description="Knowledge base operations"
                icon={<Server className="h-4 w-4 text-muted-foreground" />}
                status={ragEnabled ? "healthy" : "unknown"}
                detail={ragEnabled ? "Enabled" : "Disabled"}
                remediation={
                  ragEnabled
                    ? {
                        label: "Knowledge Bases",
                        href: "/knowledge-bases",
                        description: "Open knowledge bases to verify ingest jobs and retrieval.",
                      }
                    : {
                        label: "Setup",
                        href: "/knowledge-bases/ingest",
                        description: "Start the rag compose profile and set RAG_SERVER_URL on the UI service.",
                      }
                }
                onNavigate={(href) => router.push(href)}
              />
              <SlackIntegrationStatus
                status={slackStatus}
                loading={slackLoading}
                error={slackError}
                onRefresh={loadSlackStatus}
                onNavigate={(href) => router.push(href)}
              />
              <WebexIntegrationStatus
                status={webexStatus}
                loading={webexLoading}
                error={webexError}
                onRefresh={loadWebexStatus}
                onNavigate={(href) => router.push(href)}
              />
            </div>
          </section>

          {prometheusUnavailable ? (
            <section className="rounded-lg border border-border/70 bg-muted/20 p-4">
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">{PROMETHEUS_SETUP_GUIDANCE.title}</p>
                  <p className="text-xs text-muted-foreground">{PROMETHEUS_SETUP_GUIDANCE.body}</p>
                </div>
              </div>
            </section>
          ) : (
            <>
              {loading && platformMetricServices.length === 0 ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground ml-2">Loading Prometheus metrics...</span>
                </div>
              ) : null}
              {platformMetricServices.map((svc) => (
                <ServiceRow
                  key={svc.name}
                  name={svc.name}
                  status={svc.status}
                  detail={svc.detail}
                />
              ))}
            </>
          )}
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

      {operationalError && (
        <Card className="border-destructive/50">
          <CardContent className="py-4">
            <p className="text-sm text-destructive">{operationalError}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// ServiceRow — single service status row
// ────────────────────────────────────────────────────────────────

function probeStatusToHealth(status: PlatformHealthProbe["status"]): HealthStatus {
  if (status === "healthy") return "healthy";
  if (status === "warning") return "degraded";
  return "down";
}

function PlatformProbeRow({
  probe,
  onNavigate,
}: {
  probe: PlatformHealthProbe;
  onNavigate: (href: string) => void;
}) {
  const status = probeStatusToHealth(probe.status);
  const cfg = STATUS_CONFIG[status];

  return (
    <div className="rounded-lg bg-muted/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{probe.label}</p>
          <p className="text-xs text-muted-foreground">
            {probe.detail}
            {probe.latency_ms !== null ? ` · ${probe.latency_ms}ms` : ""}
          </p>
          <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{probe.target}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className={cn("h-2 w-2 rounded-full", cfg.bg)} />
          <span className="text-xs font-medium">{cfg.label}</span>
          {probe.remediation ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-[10px]"
              title={probe.remediation.description}
              onClick={() => onNavigate(probe.remediation!.href)}
            >
              {probe.remediation.label}
              <ExternalLink className="h-3 w-3" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ServiceRow({
  name,
  description,
  icon,
  status,
  detail,
  remediation,
  onNavigate,
}: {
  name: string;
  description?: string;
  icon?: React.ReactNode;
  status: HealthStatus;
  detail: string;
  remediation?: PlatformHealthRemediationLink;
  onNavigate?: (href: string) => void;
}) {
  const cfg = STATUS_CONFIG[status];

  return (
    <div className="flex items-center justify-between gap-3 p-4 bg-muted/50 rounded-lg">
      <div className="flex min-w-0 items-center gap-3">
        {icon}
        <div className="min-w-0">
          <p className="text-sm font-medium">{name}</p>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
          {remediation && (
            <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">{remediation.description}</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className={cn("h-2 w-2 rounded-full", cfg.bg)} />
        <span className="text-sm">{detail}</span>
        {remediation && onNavigate ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[10px]"
            onClick={() => onNavigate(remediation.href)}
          >
            {remediation.label}
          </Button>
        ) : null}
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
  onNavigate,
}: {
  status: SlackDirectoryStatus | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void | Promise<void>;
  onNavigate?: (href: string) => void;
}) {
  if (error && !status) {
    return (
      <ServiceRow
        name="Slack Integration"
        description="Bot admin API and Slack directory caches"
        icon={<MessageSquare className="h-4 w-4 text-muted-foreground" />}
        status="degraded"
        detail={error}
        remediation={{
          label: "Slack Admin",
          href: "/admin?cat=integrations&tab=slack",
          description: "Verify SLACK_BOT_ADMIN_TOKEN_URL, bot credentials, and directory sync permissions.",
        }}
        onNavigate={onNavigate}
      />
    );
  }

  const botStatus: HealthStatus = status?.bot_admin.reachable ? "healthy" : status ? "degraded" : "unknown";
  const userStatus = status ? cacheStateToHealth(status.users.status, status.users.last_error) : "unknown";
  const overallStatus: HealthStatus =
    [botStatus, userStatus].includes("down") ? "down"
      : [botStatus, userStatus].includes("degraded") ? "degraded"
        : [botStatus, userStatus].every((s) => s === "healthy") ? "healthy"
          : "unknown";
  const cfg = STATUS_CONFIG[overallStatus];
  const emojiReady = status?.emoji.status === "ready" && !status.emoji.last_error;

  return (
    <div className="rounded-lg bg-muted/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <MessageSquare className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Slack Integration</p>
            <p className="text-xs text-muted-foreground">Bot admin API, user directory, and optional emoji picker cache</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn("h-2 w-2 rounded-full", cfg.bg)} />
          {onNavigate ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[10px]"
              onClick={() => onNavigate("/admin?cat=integrations&tab=slack")}
            >
              Slack Admin
            </Button>
          ) : null}
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
        <div className="rounded-md border border-dashed bg-background/60 p-2">
          <div className="font-medium">
            Emoji cache <span className="font-normal text-muted-foreground">(optional)</span>
          </div>
          <div className={emojiReady ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>
            {status
              ? status.emoji.last_error
                ? "Not loaded · bot messaging unaffected"
                : `${status.emoji.status}: ${status.emoji.emoji_indexed} emoji indexed`
              : "checking"}
          </div>
          {status && !status.emoji.last_error && (
            <div className="text-muted-foreground">updated {formatTime(status.emoji.updated_at)}</div>
          )}
          {status?.emoji.last_error ? (
            <div className="mt-1 text-muted-foreground line-clamp-3">{status.emoji.last_error}</div>
          ) : (
            <div className="text-muted-foreground">
              Suggests custom workspace emoji in Slack Admin escalation config · requires <code className="text-[10px]">emoji:read</code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WebexIntegrationStatus({
  status,
  loading,
  error,
  onRefresh,
  onNavigate,
}: {
  status: WebexDirectoryStatus | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void | Promise<void>;
  onNavigate?: (href: string) => void;
}) {
  if (error && !status) {
    return (
      <ServiceRow
        name="Webex Integration"
        description="Bot admin API and Webex space discovery"
        icon={<MessageSquare className="h-4 w-4 text-muted-foreground" />}
        status="degraded"
        detail={error}
        remediation={{
          label: "Webex Admin",
          href: "/admin?cat=integrations&tab=webex",
          description: "Verify WEBEX_BOT_ADMIN_CLIENT_SECRET, WEBEX_INTEGRATION_BOT_ACCESS_TOKEN, and webex-bot connectivity.",
        }}
        onNavigate={onNavigate}
      />
    );
  }

  const botStatus: HealthStatus = status?.bot_admin.reachable ? "healthy" : status ? "degraded" : "unknown";
  const platformStatus: HealthStatus = status
    ? status.platform.reachable && (status.platform.spaces_onboarded > 0 || status.platform.routes_configured > 0)
      ? "healthy"
      : status.platform.reachable
        ? "unknown"
        : "degraded"
    : "unknown";
  const discoveryStatus = status
    ? status.space_discovery.configured
      ? cacheStateToHealth(status.space_discovery.status, status.space_discovery.last_error)
      : "unknown"
    : "unknown";
  const overallStatus: HealthStatus =
    [botStatus, platformStatus, discoveryStatus].includes("down") ? "down"
      : [botStatus, platformStatus, discoveryStatus].includes("degraded") ? "degraded"
        : [botStatus, platformStatus, discoveryStatus].some((s) => s === "healthy") ? "healthy"
          : status?.configured ? "degraded" : "unknown";
  const cfg = STATUS_CONFIG[overallStatus];
  const runtime = status?.bot_admin.runtime;
  const platform = status?.platform;

  return (
    <div className="rounded-lg bg-muted/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <MessageSquare className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Webex Integration</p>
            <p className="text-xs text-muted-foreground">Bot admin API and Webex space discovery</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn("h-2 w-2 rounded-full", cfg.bg)} />
          {onNavigate ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[10px]"
              onClick={() => onNavigate("/admin?cat=integrations&tab=webex")}
            >
              Webex Admin
            </Button>
          ) : null}
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
          {runtime ? (
            <div className="mt-1 text-muted-foreground">
              {runtime.route_mode ?? "unknown"} · {runtime.static_spaces ?? 0} spaces · {runtime.static_routes ?? 0} routes
              {runtime.cache_size !== undefined ? ` · cache ${runtime.cache_size}` : ""}
            </div>
          ) : null}
          {status?.bot_admin.error && <div className="mt-1 text-muted-foreground line-clamp-2">{status.bot_admin.error}</div>}
        </div>
        <div className="rounded-md border bg-background/60 p-2">
          <div className="font-medium">Platform configuration</div>
          <div className="text-muted-foreground">
            {status
              ? platform?.reachable
                ? `${platform.spaces_onboarded} spaces onboarded · ${platform.routes_configured} routes configured`
                : "MongoDB summary unavailable"
              : "checking"}
          </div>
          {platform?.spaces_onboarded || platform?.routes_configured ? (
            <div className="text-muted-foreground">Configured in Admin → Integrations → Webex</div>
          ) : (
            <div className="text-muted-foreground">Onboard spaces in Admin → Integrations → Webex</div>
          )}
          {platform?.error && <div className="mt-1 text-amber-700 dark:text-amber-400 line-clamp-2">{platform.error}</div>}
        </div>
        <div className="rounded-md border bg-background/60 p-2">
          <div className="font-medium">Space discovery cache</div>
          <div className="text-muted-foreground">
            {status
              ? status.space_discovery.configured
                ? `${status.space_discovery.status}: ${status.space_discovery.spaces_indexed} spaces indexed`
                : "Optional · WEBEX_INTEGRATION_BOT_ACCESS_TOKEN unset"
              : "checking"}
          </div>
          {status?.space_discovery.configured ? (
            <div className="text-muted-foreground">
              TTL {status.space_discovery.ttl_seconds ?? 0}s · updated {formatTime(status.space_discovery.updated_at)}
            </div>
          ) : (
            <div className="text-muted-foreground">
              Enables the Webex space picker; manual space IDs still work without it.
            </div>
          )}
          {status?.space_discovery.last_error && (
            <div className="mt-1 text-amber-700 dark:text-amber-400 line-clamp-2">{status.space_discovery.last_error}</div>
          )}
        </div>
      </div>
    </div>
  );
}
