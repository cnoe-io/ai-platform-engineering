"use client";

import React from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  RefreshCw,
  Loader2,
  Database,
  Shield,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useServiceHealth, type HealthStatus } from "@/hooks/use-service-health";

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

export function HealthTab({
  ssoEnabled = true,
  mongodbEnabled = true,
  ragEnabled = true,
}: HealthTabProps) {
  const { services, overall, loading, error, configured, refetch } =
    useServiceHealth({ refreshInterval: 30_000 });

  const overallConfig = STATUS_CONFIG[overall];
  const OverallIcon = overallConfig.icon;

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
