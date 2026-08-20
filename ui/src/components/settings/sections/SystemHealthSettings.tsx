"use client";

import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import {
  usePlatformHealthProbes,
  type PlatformCapabilityStatus,
} from "@/hooks/use-platform-health-probes";
import { useVersion } from "@/hooks/use-version";
import { cn } from "@/lib/utils";
import { Activity,CheckCircle2,CircleSlash,RefreshCw,TriangleAlert,XCircle } from "lucide-react";

const STATUS_STYLE: Record<PlatformCapabilityStatus,{ label: string; dot: string; icon: typeof CheckCircle2 }> = {
  healthy: { label: "Healthy",dot: "bg-emerald-500",icon: CheckCircle2 },
  degraded: { label: "Degraded",dot: "bg-amber-500",icon: TriangleAlert },
  down: { label: "Down",dot: "bg-red-500",icon: XCircle },
  disabled: { label: "Disabled",dot: "bg-muted-foreground/50",icon: CircleSlash },
};

export function SystemHealthSettings(): React.ReactElement {
  const health = usePlatformHealthProbes({ diagnostics: false });
  const { versionInfo } = useVersion();
  const overall = health.status === "healthy" ? "Healthy" : health.status === "checking" ? "Checking" : health.status === "degraded" ? "Degraded" : "Unavailable";
  const version = versionInfo?.version ?? versionInfo?.packageVersion ?? "Development";

  return (
    <div className="space-y-4">
      <SettingsCard description="The running CAIPE UI build. Component release versions appear beside each health result below." title="Build information">
        <dl className="grid gap-3 rounded-lg border border-border/70 p-4 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">Version</dt><dd className="mt-1 font-medium">{version}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Commit</dt><dd className="mt-1 truncate font-mono text-xs">{versionInfo?.gitCommit ?? "Unavailable"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Built</dt><dd className="mt-1 text-xs">{versionInfo?.buildDate ?? "Unavailable"}</dd></div>
        </dl>
      </SettingsCard>

      <SettingsCard
        description="A quiet summary of shared platform availability. Detailed operational diagnostics remain in Admin."
        title={<span className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" />System health</span>}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 p-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium">
              <span className={cn("h-2.5 w-2.5 rounded-full",health.status === "healthy" ? "bg-emerald-500" : health.status === "degraded" ? "bg-amber-500" : health.status === "checking" ? "animate-pulse bg-muted-foreground" : "bg-red-500")} />
              {overall}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {health.secondsUntilNextCheck > 0 ? `Next automatic check in ${health.secondsUntilNextCheck}s` : "Refreshing platform status"}
            </p>
          </div>
          <Button onClick={health.checkNow} size="sm" variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />Refresh
          </Button>
        </div>

        <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70">
          {health.capabilities.map((capability) => {
            const style = STATUS_STYLE[capability.status];
            return (
              <div className="flex items-start justify-between gap-4 px-4 py-3" key={capability.id}>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{capability.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{capability.detail}</p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                    <span className={cn("h-2 w-2 rounded-full",style.dot)} />{style.label}
                  </span>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground/80">
                    {capability.version ? `v${capability.version.replace(/^v/i, "")}` : "Version not reported"}
                  </p>
                </div>
              </div>
            );
          })}
          {health.capabilities.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Checking platform components…</div>
          ) : null}
        </div>
      </SettingsCard>

    </div>
  );
}
