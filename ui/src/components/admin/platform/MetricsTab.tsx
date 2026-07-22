"use client";

import { Button } from "@/components/ui/button";
import {
  type UseBatchPrometheusReturn,
  useBatchPrometheus,
} from "@/hooks/use-prometheus";
import { useAuthorizationMetrics } from "@/hooks/use-authorization-metrics";
import { cn } from "@/lib/utils";
import {
  Activity,
  BrainCircuit,
  Clock3,
  Coins,
  Cpu,
  Gauge,
  HardDrive,
  RefreshCw,
  Server,
  ShieldCheck,
  Timer,
  Wrench,
  Zap,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  DateRange,
  DateRangeFilter,
  DateRangePreset,
} from "../shared/DateRangeFilter";
import { AuthorizationMetricsSection } from "./AuthorizationMetricsSection";
import {
  AgentHealthTable,
  BarMetricChart,
  DonutChart,
  type MetricQueryState,
  MetricStatCard,
  smartBytesFormat,
  smartCountFormat,
  smartDurationFormat,
  smartRateFormat,
  TimeseriesChart,
  TokenUsageChart,
} from "./PrometheusCharts";
import {
  buildDependencyQueries,
  buildOverviewQueries,
  buildRuntimeQueries,
  resolveMetricsRange,
} from "./metrics-query-plan";

function metricState(batch: UseBatchPrometheusReturn, id: string): MetricQueryState {
  const result = batch.results?.[id];
  return {
    configured: batch.configured,
    data: result?.status === "success" ? result.data?.result ?? null : null,
    error: batch.queryErrors[id] || batch.error,
    loading: batch.loading,
  };
}

const percentFormat = (value: number): string => `${value.toFixed(2)}%`;
const multiplierFormat = (value: number): string => `${value.toFixed(2)}×`;
const reliabilityTone = (value: number): "positive" | "warning" | "negative" => (
  value >= 99 ? "positive" : value >= 95 ? "warning" : "negative"
);
const availabilityTone = (value: number): "positive" | "warning" | "negative" => (
  value >= 99.9 ? "positive" : value >= 99 ? "warning" : "negative"
);

function toolWithAgent(metric: Record<string, string>): string {
  const tool = metric.tool_name || "unknown";
  return metric.agent_name ? `${tool} (${metric.agent_name})` : tool;
}

function modelWithAgent(metric: Record<string, string>): string {
  const agent = metric.agent_name || "unknown";
  return metric.model_id ? `${agent} · ${metric.model_id}` : agent;
}

export function MetricsTab() {
  const [rangePreset, setRangePreset] = useState<DateRangePreset>("24h");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const range = useMemo(
    () => resolveMetricsRange(rangePreset, customRange),
    [customRange, rangePreset],
  );
  const overviewQueries = useMemo(() => buildOverviewQueries(range), [range]);
  const runtimeQueries = useMemo(() => buildRuntimeQueries(range), [range]);
  const dependencyQueries = useMemo(() => buildDependencyQueries(range), [range]);

  const overview = useBatchPrometheus(overviewQueries, { refreshInterval: 30_000 });
  const runtime = useBatchPrometheus(runtimeQueries, { refreshInterval: 60_000 });
  const dependencies = useBatchPrometheus(dependencyQueries, { refreshInterval: 60_000 });
  const authorization = useAuthorizationMetrics(range, { refreshInterval: 60_000 });
  const refreshing = manualRefreshing
    || overview.loading
    || runtime.loading
    || dependencies.loading
    || authorization.loading;
  const lastUpdatedAt = Math.max(
    overview.lastUpdatedAt ?? 0,
    runtime.lastUpdatedAt ?? 0,
    dependencies.lastUpdatedAt ?? 0,
    authorization.lastUpdatedAt ?? 0,
  );

  const formatTimestamp = useCallback((timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    if (range.seconds <= 24 * 60 * 60) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    if (range.seconds <= 7 * 24 * 60 * 60) {
      return date.toLocaleString([], { day: "numeric", hour: "numeric", month: "short" });
    }
    return date.toLocaleDateString([], { day: "numeric", month: "short" });
  }, [range.seconds]);

  const refreshAll = useCallback(async (): Promise<void> => {
    setManualRefreshing(true);
    try {
      await Promise.all([
        overview.refetch(),
        runtime.refetch(),
        dependencies.refetch(),
        authorization.refetch(),
      ]);
    } finally {
      setManualRefreshing(false);
    }
  }, [authorization, dependencies, overview, runtime]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 className="font-semibold">Steady-state Operations Review</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every period metric uses {range.label}. Relative ranges move on refresh; custom dates stay fixed.
          </p>
          {lastUpdatedAt > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Last completed update {new Date(lastUpdatedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DateRangeFilter
            value={rangePreset}
            customRange={customRange}
            onChange={(preset, selectedRange) => {
              setRangePreset(preset);
              setCustomRange(preset === "custom" ? selectedRange : undefined);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={refreshing}
            onClick={() => void refreshAll()}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            {refreshing ? "Refreshing" : "Refresh"}
          </Button>
        </div>
      </div>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Executive Health</h3>
          <p className="text-sm text-muted-foreground">
            Availability, reliability, latency, traffic, efficiency, and saturation for the selected period.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricStatCard
            title="Runtime Availability"
            state={metricState(overview, "runtime_availability")}
            icon={<Server className="h-4 w-4 text-muted-foreground" />}
            format={percentFormat}
            tone={availabilityTone}
            subtitle="Prometheus scrape availability"
          />
          <MetricStatCard
            title="Recorded Turns"
            state={metricState(overview, "turn_volume")}
            icon={<Activity className="h-4 w-4 text-muted-foreground" />}
            format={smartCountFormat}
            subtitle="All terminal outcomes in range"
          />
          <MetricStatCard
            title="Turn Reliability"
            state={metricState(overview, "turn_reliability")}
            icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
            format={percentFormat}
            tone={reliabilityTone}
            subtitle="Success vs runtime errors; expected pauses excluded"
          />
          <MetricStatCard
            title="Successful Turn p95"
            state={metricState(overview, "turn_p95")}
            icon={<Clock3 className="h-4 w-4 text-muted-foreground" />}
            format={smartDurationFormat}
            subtitle="End-to-end latency"
          />
          <MetricStatCard
            title="First Response p95"
            state={metricState(overview, "first_response_p95")}
            icon={<Timer className="h-4 w-4 text-muted-foreground" />}
            format={smartDurationFormat}
            subtitle="Time to first user-visible text"
          />
          <MetricStatCard
            title="Error-budget Burn"
            state={metricState(overview, "turn_error_budget_burn")}
            icon={<Gauge className="h-4 w-4 text-muted-foreground" />}
            format={multiplierFormat}
            tone={(value) => value <= 1 ? "positive" : value <= 2 ? "warning" : "negative"}
            subtitle="Against a 99% turn reliability objective"
          />
          <MetricStatCard
            title="Peak Concurrency"
            state={metricState(overview, "peak_concurrency")}
            icon={<Cpu className="h-4 w-4 text-muted-foreground" />}
            format={(value) => Math.round(value).toLocaleString()}
            subtitle="Maximum simultaneous HTTP requests"
          />
          <MetricStatCard
            title="Tokens / Turn"
            state={metricState(overview, "tokens_per_turn")}
            icon={<Coins className="h-4 w-4 text-muted-foreground" />}
            format={smartCountFormat}
            subtitle="Provider-reported input plus output tokens"
          />
          <MetricStatCard
            title="HTTP Reliability"
            state={metricState(overview, "http_reliability")}
            icon={<Zap className="h-4 w-4 text-muted-foreground" />}
            format={percentFormat}
            tone={reliabilityTone}
            subtitle="2xx vs server errors; 4xx excluded"
          />
          <MetricStatCard
            title="LLM Reliability"
            state={metricState(overview, "llm_reliability")}
            icon={<BrainCircuit className="h-4 w-4 text-muted-foreground" />}
            format={percentFormat}
            tone={reliabilityTone}
            subtitle="Successful model calls"
          />
          <MetricStatCard
            title="Tool Reliability"
            state={metricState(overview, "tool_reliability")}
            icon={<Wrench className="h-4 w-4 text-muted-foreground" />}
            format={percentFormat}
            tone={reliabilityTone}
            subtitle="Successful tool calls"
          />
          <MetricStatCard
            title="Peak Runtime-cache Use"
            state={metricState(overview, "peak_cache_utilization")}
            icon={<HardDrive className="h-4 w-4 text-muted-foreground" />}
            format={percentFormat}
            tone={(value) => value < 75 ? "positive" : value < 90 ? "warning" : "negative"}
            subtitle="Peak occupied runtime capacity"
          />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Turn Outcomes</h3>
          <p className="text-sm text-muted-foreground">
            Expected interruptions and user cancellations remain visible but do not count as platform failures.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <TimeseriesChart
            title="Turn Throughput by Agent"
            description={`Rolling ${smartDurationFormat(range.rateWindowSeconds)} rate`}
            state={metricState(runtime, "turn_rate_by_agent")}
            labelKey="agent_name"
            formatValue={smartRateFormat}
            formatTime={formatTimestamp}
          />
          <TimeseriesChart
            title="Turn Reliability Trend"
            description="Successful completed turns vs runtime errors"
            state={metricState(runtime, "turn_reliability_trend")}
            formatValue={percentFormat}
            formatTime={formatTimestamp}
            type="line"
          />
          <TimeseriesChart
            title="Successful Turn p95 by Agent"
            description="End-to-end latency; interruptions and cancellations excluded"
            state={metricState(runtime, "turn_p95_by_agent")}
            labelKey="agent_name"
            formatValue={smartDurationFormat}
            formatTime={formatTimestamp}
            type="line"
          />
          <TimeseriesChart
            title="First Response p95 by Agent"
            description="Time until the first user-visible text"
            state={metricState(runtime, "first_response_p95_by_agent")}
            labelKey="agent_name"
            formatValue={smartDurationFormat}
            formatTime={formatTimestamp}
            type="line"
          />
          <DonutChart
            title="Turn Outcome Distribution"
            description={`Recorded outcomes over ${range.label}`}
            state={metricState(runtime, "turn_outcomes")}
            labelKey="status"
          />
          <AgentHealthTable
            title="Agent Health Comparison"
            description={`Volume, reliability, and successful-turn latency over ${range.label}`}
            volumeState={metricState(runtime, "agent_turn_volume")}
            reliabilityState={metricState(runtime, "agent_turn_reliability")}
            latencyState={metricState(runtime, "agent_turn_p95")}
          />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Request Path & Saturation</h3>
          <p className="text-sm text-muted-foreground">
            Server errors, request latency, active work, cache pressure, and process resources.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <TimeseriesChart
            title="HTTP Server-error Rate"
            description="5xx and unhandled errors; client 4xx responses excluded"
            state={metricState(runtime, "http_error_rate")}
            formatValue={percentFormat}
            formatTime={formatTimestamp}
            type="line"
          />
          <TimeseriesChart
            title="Successful HTTP Request p95"
            description="Dynamic Agents request latency"
            state={metricState(runtime, "http_p95")}
            formatValue={smartDurationFormat}
            formatTime={formatTimestamp}
            type="line"
          />
          <TimeseriesChart
            title="Active HTTP Requests"
            description="Requests currently executing at each sample"
            state={metricState(runtime, "active_requests")}
            formatValue={smartCountFormat}
            formatTime={formatTimestamp}
            type="line"
          />
          <TimeseriesChart
            title="Active Agent Streams"
            description="Turns currently executing in agent runtimes"
            state={metricState(runtime, "active_streams")}
            formatValue={smartCountFormat}
            formatTime={formatTimestamp}
            type="line"
          />
          <TimeseriesChart
            title="Runtime-cache Utilization"
            description="Cached runtimes as a percentage of configured capacity"
            state={metricState(runtime, "cache_utilization")}
            formatValue={percentFormat}
            formatTime={formatTimestamp}
            type="line"
          />
          <TimeseriesChart
            title="Process CPU"
            description="Aggregate Dynamic Agents process CPU utilization"
            state={metricState(runtime, "process_cpu")}
            formatValue={percentFormat}
            formatTime={formatTimestamp}
            type="line"
          />
          <TimeseriesChart
            title="Resident Memory"
            description="Aggregate resident memory across Dynamic Agents targets"
            state={metricState(runtime, "process_memory")}
            formatValue={smartBytesFormat}
            formatTime={formatTimestamp}
            type="line"
          />
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">LLM Dependency</h3>
          <p className="text-sm text-muted-foreground">
            Model-call reliability, successful latency, call volume, and token efficiency.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <TimeseriesChart
            title="LLM Error Rate by Model"
            description="Failed model calls by model and owning agent"
            state={metricState(dependencies, "llm_error_rate_by_agent_model")}
            labelTransform={modelWithAgent}
            formatValue={percentFormat}
            formatTime={formatTimestamp}
            type="line"
          />
          <TimeseriesChart
            title="Successful LLM p95"
            description="Model-call latency by agent and model"
            state={metricState(dependencies, "llm_p95_by_agent_model")}
            labelTransform={modelWithAgent}
            formatValue={smartDurationFormat}
            formatTime={formatTimestamp}
            type="line"
          />
          <BarMetricChart
            title="Model Usage"
            description={`LLM call volume by model over ${range.label}`}
            state={metricState(dependencies, "llm_calls_by_model")}
            labelKey="model_id"
            layout="horizontal"
            formatValue={smartCountFormat}
          />
          <DonutChart
            title="LLM Call Outcomes"
            description={`Success and error outcomes over ${range.label}`}
            state={metricState(dependencies, "llm_status")}
            labelKey="status"
          />
          <div className="xl:col-span-2">
            <TokenUsageChart
              title="Token Usage by Model"
              description={`Provider-reported input and output tokens over ${range.label}`}
              inputState={metricState(dependencies, "llm_input_tokens_by_model")}
              outputState={metricState(dependencies, "llm_output_tokens_by_model")}
            />
          </div>
        </div>
      </section>

      <AuthorizationMetricsSection
        rangeLabel={range.label}
        state={authorization}
      />

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Tool Dependency</h3>
          <p className="text-sm text-muted-foreground">
            Failure concentration and successful execution latency across agent tools.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <TimeseriesChart
            title="Tool Error Rate"
            description="Failed calls by tool and owning agent"
            state={metricState(dependencies, "tool_error_rate_by_tool")}
            labelTransform={toolWithAgent}
            formatValue={percentFormat}
            formatTime={formatTimestamp}
            type="line"
          />
          <TimeseriesChart
            title="Successful Tool p95"
            description="Execution latency by tool and owning agent"
            state={metricState(dependencies, "tool_p95_by_tool")}
            labelTransform={toolWithAgent}
            formatValue={smartDurationFormat}
            formatTime={formatTimestamp}
            type="line"
          />
          <BarMetricChart
            title="Top Failing Tools"
            description={`Error count over ${range.label}`}
            state={metricState(dependencies, "top_failing_tools")}
            labelTransform={toolWithAgent}
            labelKey="tool_name"
            layout="horizontal"
            formatValue={smartCountFormat}
            emptyMessage="No tool failures in this range"
          />
          <DonutChart
            title="Tool Call Outcomes"
            description={`Success and error outcomes over ${range.label}`}
            state={metricState(dependencies, "tool_status")}
            labelKey="status"
          />
        </div>
      </section>
    </div>
  );
}
