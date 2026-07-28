"use client";

import { AsyncStatsCard } from "@/components/admin/insights/AsyncStatsCard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { UseAuthorizationMetricsReturn } from "@/hooks/use-authorization-metrics";
import { Activity, AlertTriangle, ShieldCheck, ShieldX } from "lucide-react";
import type { ReactNode } from "react";
import { smartCountFormat } from "./PrometheusCharts";

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function AuthorizationStatCard({
  icon,
  subtitle,
  title,
  value,
  valueClassName,
}: {
  icon: ReactNode;
  subtitle: string;
  title: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${valueClassName ?? ""}`}>{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

export function AuthorizationMetricsSection({
  rangeLabel,
  state,
}: {
  rangeLabel: string;
  state: UseAuthorizationMetricsReturn;
}) {
  const { data, error, loading } = state;
  const decisions = data?.decisions;

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Centralized Authorization Service</h3>
        <p className="text-sm text-muted-foreground">
          Authorization volume and outcomes over {rangeLabel}. Policy denials are expected outcomes;
          unavailable decisions indicate an operational failure.
        </p>
      </div>

      {data && !data.persistence ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Authorization decision history is unavailable because durable audit storage is disabled.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <AsyncStatsCard error={error} loading={loading} testId="authorization-decisions-card">
              {decisions ? (
                <AuthorizationStatCard
                  title="Authorization Decisions"
                  value={`${smartCountFormat(decisions.total)}${decisions.truncated ? "+" : ""}`}
                  subtitle={decisions.truncated ? "At least 10,000 recorded decisions" : "Recorded decisions"}
                  icon={<Activity className="h-4 w-4 text-muted-foreground" />}
                />
              ) : undefined}
            </AsyncStatsCard>
            <AsyncStatsCard error={error} loading={loading} testId="authorization-allowed-card">
              {decisions ? (
                <AuthorizationStatCard
                  title="Allowed"
                  value={percent(decisions.total > 0 ? decisions.allow / decisions.total : 0)}
                  subtitle={`${smartCountFormat(decisions.allow)} allowed decisions`}
                  icon={<ShieldCheck className="h-4 w-4 text-emerald-500" />}
                  valueClassName="text-emerald-500"
                />
              ) : undefined}
            </AsyncStatsCard>
            <AsyncStatsCard error={error} loading={loading} testId="authorization-policy-denied-card">
              {decisions ? (
                <AuthorizationStatCard
                  title="Policy Denials"
                  value={percent(decisions.policyDenyRate)}
                  subtitle={`${smartCountFormat(decisions.policyDeny)} expected policy denials`}
                  icon={<ShieldX className="h-4 w-4 text-muted-foreground" />}
                />
              ) : undefined}
            </AsyncStatsCard>
            <AsyncStatsCard error={error} loading={loading} testId="authorization-unavailable-card">
              {decisions ? (
                <AuthorizationStatCard
                  title="Authorization Unavailable"
                  value={percent(decisions.unavailableRate)}
                  subtitle={`${smartCountFormat(decisions.unavailable)} fail-closed decisions`}
                  icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
                  valueClassName={decisions.unavailable > 0 ? "text-destructive" : "text-emerald-500"}
                />
              ) : undefined}
            </AsyncStatsCard>
          </div>

          {decisions?.truncated ? (
            <p className="text-xs text-amber-600" role="status">
              Reason and resource breakdowns are limited to the first 10,000 events in this range.
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <AsyncStatsCard error={error} loading={loading} testId="authorization-reasons-card">
              {decisions ? (
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle>Decision Reasons</CardTitle>
                    <CardDescription>Recorded outcomes grouped by stable reason code</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {decisions.byReason.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No authorization decisions in this range.</p>
                    ) : (
                      <div className="divide-y rounded-md border">
                        {decisions.byReason.map((row) => (
                          <div key={row.reason} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                            <span className="truncate font-mono" title={row.reason}>{row.reason}</span>
                            <span className="tabular-nums">{smartCountFormat(row.count)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : undefined}
            </AsyncStatsCard>

            <AsyncStatsCard error={error} loading={loading} testId="authorization-denied-resources-card">
              {decisions ? (
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle>Top Denied Resources</CardTitle>
                    <CardDescription>Resources most frequently denied by policy</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {decisions.topDenied.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No denied resources in this range.</p>
                    ) : (
                      <div className="divide-y rounded-md border">
                        {decisions.topDenied.map((row) => (
                          <div key={row.resource} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                            <span className="truncate font-mono" title={row.resource}>{row.resource}</span>
                            <span className="tabular-nums">{smartCountFormat(row.count)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : undefined}
            </AsyncStatsCard>
          </div>
        </>
      )}
    </section>
  );
}
