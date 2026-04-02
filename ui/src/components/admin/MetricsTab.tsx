"use client";

import React, { useState } from "react";
import { Activity, Wrench, Zap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MetricStatCard,
  ActiveAgentsCard,
  TimeseriesChart,
  BarMetricChart,
  DonutChart,
  smartRateFormat,
  smartDurationFormat,
} from "./PrometheusCharts";
import { DateRangeFilter, DateRangePreset, DateRange } from "./DateRangeFilter";

/** Map a DateRangePreset to Prometheus range minutes and scrape step. */
function presetToPrometheus(preset: DateRangePreset, custom?: DateRange): { rangeMinutes: number; step: string } {
  if (preset === "custom" && custom) {
    const ms = new Date(custom.to).getTime() - new Date(custom.from).getTime();
    const mins = Math.max(1, Math.round(ms / 60000));
    // step: aim for ~200 data points
    const stepSec = Math.max(15, Math.round((mins * 60) / 200));
    return { rangeMinutes: mins, step: `${stepSec}s` };
  }
  switch (preset) {
    case "1h":  return { rangeMinutes: 60, step: "60s" };
    case "12h": return { rangeMinutes: 720, step: "300s" };
    case "24h": return { rangeMinutes: 1440, step: "900s" };
    case "7d":  return { rangeMinutes: 10080, step: "3600s" };
    case "30d": return { rangeMinutes: 43200, step: "14400s" };
    case "90d": return { rangeMinutes: 129600, step: "43200s" };
    default:    return { rangeMinutes: 60, step: "60s" };
  }
}

function toolWithAgent(metric: Record<string, string>): string {
  const tool = metric.tool_name || "unknown";
  const agent = metric.agent_name;
  return agent ? `${tool} (${agent})` : tool;
}

export function MetricsTab() {
  const [rangePreset, setRangePreset] = useState<DateRangePreset>("1h");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const { rangeMinutes, step } = presetToPrometheus(rangePreset, customRange);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Time Range:</span>
          <DateRangeFilter
            value={rangePreset}
            customRange={customRange}
            onChange={(preset, range) => {
              setRangePreset(preset);
              setCustomRange(preset === "custom" ? range : undefined);
            }}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={refreshing}
          onClick={() => {
            setRefreshKey((k) => k + 1);
            setRefreshing(true);
            setTimeout(() => setRefreshing(false), 600);
          }}
        >
          <RefreshCw className={`h-3.5 w-3.5${refreshing ? " animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* ══════════════════════════════════════════════════════
          OVERVIEW STAT CARDS
          ══════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" key={`stats-${refreshKey}`}>
        <MetricStatCard
          title="User Conversations"
          query="sum(agent_requests_total)"
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          subtitle="Total requests handled by supervisor"
          refreshInterval={30_000}
        />
        <MetricStatCard
          title="Success Rate"
          query='sum(agent_requests_total{status="success"}) / sum(agent_requests_total) * 100'
          icon={<Zap className="h-4 w-4 text-muted-foreground" />}
          format={(v) => `${v.toFixed(1)}%`}
          subtitle="End-to-end completion rate"
          refreshInterval={30_000}
        />
        <ActiveAgentsCard refreshInterval={30_000} />
        <MetricStatCard
          title="MCP Tool Calls"
          query="sum(mcp_tool_calls_observed_total)"
          icon={<Wrench className="h-4 w-4 text-muted-foreground" />}
          subtitle="Tools invoked across all agents"
          refreshInterval={30_000}
        />
      </div>

      {/* ══════════════════════════════════════════════════════
          REQUEST METRICS
          ══════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" key={`charts-${refreshKey}-${rangePreset}-${customRange?.from}`}>
        <TimeseriesChart
          title="Supervisor Request Rate"
          description="User requests per second processed by the supervisor, by outcome"
          query="sum(rate(agent_requests_total[5m])) by (status)"
          labelKey="status"
          rangeMinutes={rangeMinutes}
          step={step}
          formatValue={smartRateFormat}
          refreshInterval={60_000}
        />

        <TimeseriesChart
          title="End-to-End Duration (p95)"
          description="95th percentile time from user request to final response"
          query="histogram_quantile(0.95, sum(rate(agent_request_duration_seconds_bucket[5m])) by (le))"
          type="line"
          rangeMinutes={rangeMinutes}
          step={step}
          formatValue={smartDurationFormat}
          refreshInterval={60_000}
        />
      </div>

      {/* ══════════════════════════════════════════════════════
          SUB-AGENT METRICS (SUPERVISOR VIEW)
          These metrics are tracked by the supervisor when it invokes sub-agents.
          Includes all sub-agents like Jarvis that don't emit their own metrics.
          ══════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TimeseriesChart
          title="Sub-agent Invocation Rate (Supervisor)"
          description="How often the supervisor calls each sub-agent (includes Jarvis)"
          query="sum(rate(subagent_invocations_total[5m])) by (agent_name)"
          labelKey="agent_name"
          rangeMinutes={rangeMinutes}
          step={step}
          formatValue={smartRateFormat}
          refreshInterval={60_000}
        />

        <BarMetricChart
          title="Sub-agent Usage (Supervisor View)"
          description="Total invocations tracked by supervisor (includes Jarvis)"
          query="sum by (agent_name) (subagent_invocations_total)"
          labelKey="agent_name"
          layout="horizontal"
          refreshInterval={60_000}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TimeseriesChart
          title="Sub-agent Duration (p95)"
          description="95th percentile round-trip time per sub-agent call"
          query="histogram_quantile(0.95, sum(rate(subagent_invocation_duration_seconds_bucket[5m])) by (le, agent_name))"
          labelKey="agent_name"
          type="line"
          rangeMinutes={rangeMinutes}
          step={step}
          formatValue={smartDurationFormat}
          refreshInterval={60_000}
        />

        <DonutChart
          title="Sub-agent Invocation Status"
          description="Success vs failure distribution across all sub-agents"
          query="sum by (status) (subagent_invocations_total)"
          labelKey="status"
          refreshInterval={60_000}
        />
      </div>

      {/* ══════════════════════════════════════════════════════
          SUB-AGENT DIRECT METRICS (A2A)
          These metrics are emitted by sub-agents themselves.
          Note: Jarvis doesn't emit these metrics directly.
          ══════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TimeseriesChart
          title="Sub-agent A2A Request Rate"
          description="Requests reported by sub-agents themselves (excludes Jarvis)"
          query="sum(rate(subagent_requests_total[5m])) by (agent_name, status)"
          labelKey="agent_name"
          labelTransform={(m) => `${m.agent_name || "unknown"} (${m.status || "?"})`}
          rangeMinutes={rangeMinutes}
          step={step}
          formatValue={smartRateFormat}
          refreshInterval={60_000}
        />

        <BarMetricChart
          title="Sub-agent A2A Usage Distribution"
          description="Total requests reported by sub-agents (excludes Jarvis)"
          query="sum by (agent_name) (subagent_requests_total)"
          labelKey="agent_name"
          layout="horizontal"
          refreshInterval={60_000}
        />
      </div>

      {/* ══════════════════════════════════════════════════════
          MCP TOOL METRICS
          ══════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TimeseriesChart
          title="MCP Tool Call Rate"
          description="Tool calls per second observed by the supervisor"
          query="sum(rate(mcp_tool_calls_observed_total[5m])) by (tool_name, agent_name)"
          labelKey="tool_name"
          labelTransform={toolWithAgent}
          rangeMinutes={rangeMinutes}
          step={step}
          formatValue={smartRateFormat}
          refreshInterval={60_000}
        />

        <BarMetricChart
          title="Top MCP Tools"
          description="Most-called tools with their owning agent"
          query="topk(10, sum by (tool_name, agent_name) (mcp_tool_calls_observed_total))"
          labelKey="tool_name"
          labelTransform={toolWithAgent}
          layout="horizontal"
          refreshInterval={60_000}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TimeseriesChart
          title="MCP Tool Execution Rate"
          description="Actual tool executions reported by each sub-agent"
          query="sum(rate(mcp_tool_execution_total[5m])) by (tool_name, agent_name)"
          labelKey="tool_name"
          labelTransform={toolWithAgent}
          rangeMinutes={rangeMinutes}
          step={step}
          formatValue={smartRateFormat}
          refreshInterval={60_000}
        />

        <DonutChart
          title="MCP Tool Execution Status"
          description="Success vs error distribution for tool executions"
          query="sum by (status) (mcp_tool_execution_total)"
          labelKey="status"
          refreshInterval={60_000}
        />
      </div>
    </div>
  );
}
