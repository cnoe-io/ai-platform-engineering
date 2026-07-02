"use client";

import { Button } from "@/components/ui/button";
import { Activity,Cpu,RefreshCw,Wrench,Zap } from "lucide-react";
import { useState } from "react";
import { DateRange,DateRangeFilter,DateRangePreset } from "../shared/DateRangeFilter";
import {
BarMetricChart,
DonutChart,
MetricStatCard,
smartDurationFormat,
smartRateFormat,
TimeseriesChart,
} from "./PrometheusCharts";

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

// All charts below query the `da_*` metrics emitted by the Dynamic Agents
// service (ai_platform_engineering/dynamic_agents/.../metrics).
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
          title="Agent Turns"
          query="sum(da_turns_total)"
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          subtitle="Total conversation turns handled"
          refreshInterval={30_000}
        />
        <MetricStatCard
          title="Turn Success Rate"
          query='sum(da_turns_total{status="success"}) / sum(da_turns_total) * 100'
          icon={<Zap className="h-4 w-4 text-muted-foreground" />}
          format={(v) => `${v.toFixed(1)}%`}
          subtitle="Turns completing without error"
          refreshInterval={30_000}
        />
        <MetricStatCard
          title="In-flight Requests"
          query="sum(da_active_requests)"
          icon={<Cpu className="h-4 w-4 text-muted-foreground" />}
          subtitle="Requests currently being processed"
          refreshInterval={15_000}
        />
        <MetricStatCard
          title="Tool Calls"
          query="sum(da_tool_calls_total)"
          icon={<Wrench className="h-4 w-4 text-muted-foreground" />}
          subtitle="Tools invoked across all agents"
          refreshInterval={30_000}
        />
      </div>

      {/* ══════════════════════════════════════════════════════
          TURN METRICS
          ══════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" key={`turns-${refreshKey}-${rangePreset}-${customRange?.from}`}>
        <TimeseriesChart
          title="Turn Rate by Agent"
          description="Conversation turns per second, by agent"
          query="sum(rate(da_turns_total[5m])) by (agent_name)"
          labelKey="agent_name"
          rangeMinutes={rangeMinutes}
          step={step}
          formatValue={smartRateFormat}
          refreshInterval={60_000}
        />

        <TimeseriesChart
          title="Turn Duration (p95)"
          description="95th percentile end-to-end turn duration"
          query="histogram_quantile(0.95, sum(rate(da_turn_duration_seconds_bucket[5m])) by (le))"
          type="line"
          rangeMinutes={rangeMinutes}
          step={step}
          formatValue={smartDurationFormat}
          refreshInterval={60_000}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BarMetricChart
          title="Turns by Agent"
          description="Total turns handled per agent"
          query="sum by (agent_name) (da_turns_total)"
          labelKey="agent_name"
          layout="horizontal"
          refreshInterval={60_000}
        />

        <DonutChart
          title="Turn Status Distribution"
          description="Success vs interrupted/cancelled across all turns"
          query="sum by (status) (da_turns_total)"
          labelKey="status"
          refreshInterval={60_000}
        />
      </div>

      {/* ══════════════════════════════════════════════════════
          LLM CALL METRICS
          ══════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TimeseriesChart
          title="LLM Call Rate"
          description="Model calls per second, by agent and outcome"
          query="sum(rate(da_llm_calls_total[5m])) by (agent_name, status)"
          labelKey="agent_name"
          labelTransform={(m) => `${m.agent_name || "unknown"} (${m.status || "?"})`}
          rangeMinutes={rangeMinutes}
          step={step}
          formatValue={smartRateFormat}
          refreshInterval={60_000}
        />

        <TimeseriesChart
          title="LLM Call Duration (p95)"
          description="95th percentile model call latency"
          query="histogram_quantile(0.95, sum(rate(da_llm_call_duration_seconds_bucket[5m])) by (le, agent_name))"
          labelKey="agent_name"
          type="line"
          rangeMinutes={rangeMinutes}
          step={step}
          formatValue={smartDurationFormat}
          refreshInterval={60_000}
        />
      </div>

      {/* ══════════════════════════════════════════════════════
          TOOL CALL METRICS
          ══════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TimeseriesChart
          title="Tool Call Rate"
          description="Tool calls per second, by tool and agent"
          query="sum(rate(da_tool_calls_total[5m])) by (tool_name, agent_name)"
          labelKey="tool_name"
          labelTransform={toolWithAgent}
          rangeMinutes={rangeMinutes}
          step={step}
          formatValue={smartRateFormat}
          refreshInterval={60_000}
        />

        <BarMetricChart
          title="Top Tools"
          description="Most-called tools with their owning agent"
          query="topk(10, sum by (tool_name, agent_name) (da_tool_calls_total))"
          labelKey="tool_name"
          labelTransform={toolWithAgent}
          layout="horizontal"
          refreshInterval={60_000}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TimeseriesChart
          title="Tool Call Duration (p95)"
          description="95th percentile tool execution latency"
          query="histogram_quantile(0.95, sum(rate(da_tool_call_duration_seconds_bucket[5m])) by (le, tool_name))"
          labelKey="tool_name"
          type="line"
          rangeMinutes={rangeMinutes}
          step={step}
          formatValue={smartDurationFormat}
          refreshInterval={60_000}
        />

        <DonutChart
          title="Tool Call Status"
          description="Success vs error distribution for tool calls"
          query="sum by (status) (da_tool_calls_total)"
          labelKey="status"
          refreshInterval={60_000}
        />
      </div>
    </div>
  );
}
