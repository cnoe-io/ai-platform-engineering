"use client";

import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import {
getLabeledValues,
getScalarValue,
type PrometheusMetric,
usePrometheusQuery
} from "@/hooks/use-prometheus";
import { AlertCircle,Loader2 } from "lucide-react";
import React,{ useCallback, useMemo } from "react";
import {
Area,
AreaChart,
Bar,
BarChart,
CartesianGrid,
Cell,
Line,
LineChart,
Pie,
PieChart,
ResponsiveContainer,
Tooltip,
XAxis,
YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";

// ────────────────────────────────────────────────────────────────
// Color palette (matches the dark theme)
// ────────────────────────────────────────────────────────────────

const CHART_COLORS = [
  "hsl(173, 80%, 40%)",   // teal
  "hsl(270, 75%, 60%)",   // purple
  "hsl(210, 90%, 55%)",   // blue
  "hsl(35, 95%, 55%)",    // orange
  "hsl(340, 75%, 55%)",   // pink
  "hsl(145, 65%, 45%)",   // green
  "hsl(50, 90%, 55%)",    // yellow
  "hsl(195, 85%, 50%)",   // cyan
];

// ────────────────────────────────────────────────────────────────
// Smart value formatters — auto-scale to human-readable units
// ────────────────────────────────────────────────────────────────

export function smartRateFormat(v: number): string {
  if (v === 0) return "0";
  const absV = Math.abs(v);
  if (absV >= 1) return `${v.toFixed(1)}/s`;
  if (absV >= 0.0167) return `${(v * 60).toFixed(1)}/min`; // >= 1/min
  if (absV >= 0.000278) return `${(v * 3600).toFixed(1)}/hr`; // >= 1/hr
  if (absV >= 0.0000001) return `${(v * 3600).toFixed(2)}/hr`; // show more precision for tiny values
  return "~0";
}

export function smartDurationFormat(seconds: number): string {
  if (seconds === 0) return "0s";
  if (seconds < 0.001) return `${(seconds * 1_000_000).toFixed(0)}µs`;
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

export function smartBytesFormat(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function smartCountFormat(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export interface MetricQueryState {
  data: PrometheusMetric[] | null;
  loading: boolean;
  error: string | null;
  configured: boolean;
}

function RefreshOverlay({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-card/70 backdrop-blur-[1px]">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading metric" />
    </div>
  );
}

function RefreshError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div
      className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive"
      role="alert"
      title={error}
    >
      <AlertCircle className="h-3.5 w-3.5" />
      Refresh failed
    </div>
  );
}

function EmptyMetricState({
  configured,
  error,
  loading,
  message = "No observations in this range",
  minHeightClassName = "h-48",
}: {
  configured: boolean;
  error: string | null;
  loading: boolean;
  message?: string;
  minHeightClassName?: string;
}) {
  if (!configured) {
    return <div className={`flex items-center justify-center ${minHeightClassName} text-muted-foreground`}>Prometheus not configured</div>;
  }
  if (loading) {
    return (
      <div className={`flex items-center justify-center ${minHeightClassName}`}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading metric" />
      </div>
    );
  }
  if (error) {
    return (
      <div className={`flex items-center justify-center gap-2 ${minHeightClassName} px-4 text-center text-sm text-destructive`} role="alert">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }
  return <div className={`flex items-center justify-center ${minHeightClassName} text-muted-foreground`}>{message}</div>;
}

// ────────────────────────────────────────────────────────────────
// MetricStatCard — big-number metric with optional subtitle
// ────────────────────────────────────────────────────────────────

interface MetricStatCardProps {
  title: string;
  query?: string;
  state?: MetricQueryState;
  icon?: React.ReactNode;
  format?: (value: number) => string;
  subtitle?: string;
  refreshInterval?: number;
  className?: string;
  tone?: (value: number) => "positive" | "warning" | "negative" | "neutral";
}

export function MetricStatCard({
  title,
  query = "",
  state,
  icon,
  format = (v) => v.toLocaleString(),
  subtitle,
  refreshInterval = 30_000,
  className,
  tone,
}: MetricStatCardProps) {
  const internalState = usePrometheusQuery({
    query,
    refreshInterval,
    enabled: state === undefined,
  });
  const { data, loading, error, configured } = state ?? internalState;

  const value = getScalarValue(data);
  const valueTone = value !== null ? tone?.(value) : undefined;

  return (
    <Card className={`relative ${className ?? ""}`} aria-busy={loading}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent className="relative min-h-16">
        {!configured ? (
          <p className="text-sm text-muted-foreground">Not configured</p>
        ) : loading && value === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading metric" />
        ) : error && value === null ? (
          <p className="text-sm text-destructive" role="alert">{error}</p>
        ) : value === null ? (
          <p className="text-sm text-muted-foreground">No observations</p>
        ) : (
          <>
            <div className={`text-2xl font-bold ${
              valueTone === "positive"
                ? "text-emerald-500"
                : valueTone === "warning"
                  ? "text-amber-500"
                  : valueTone === "negative"
                    ? "text-destructive"
                    : ""
            }`}>
              {format(value)}
            </div>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </>
        )}
      </CardContent>
      {value !== null && <RefreshOverlay loading={loading} />}
      {value !== null && !loading && <RefreshError error={error} />}
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// TimeseriesChart — line/area chart for range queries
// ────────────────────────────────────────────────────────────────

interface TimeseriesChartProps {
  title: string;
  description?: string;
  query?: string;
  state?: MetricQueryState;
  type?: "line" | "area";
  height?: number;
  refreshInterval?: number;
  labelKey?: string;
  rangeMinutes?: number;
  step?: string;
  formatValue?: (value: number) => string;
  formatTime?: (timestamp: number) => string;
  /** Transform metric labels into display names, e.g. combine tool_name + agent_name */
  labelTransform?: (metric: Record<string, string>) => string;
}

export function TimeseriesChart({
  title,
  description,
  query = "",
  state,
  type = "area",
  height = 250,
  refreshInterval = 60_000,
  labelKey = "agent_name",
  rangeMinutes = 60,
  step = "60s",
  formatValue = (v) => v.toFixed(2),
  formatTime,
  labelTransform,
}: TimeseriesChartProps) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - rangeMinutes * 60;

  const internalState = usePrometheusQuery({
    query,
    type: "range",
    start: String(start),
    end: String(now),
    step,
    refreshInterval,
    enabled: state === undefined,
  });
  const { data, loading, error, configured } = state ?? internalState;

  const { chartData, series, legendSeries, hiddenCount } = useMemo(() => {
    if (!data || data.length === 0) return { chartData: [], series: [] as string[], legendSeries: [] as string[], hiddenCount: 0 };

    const seriesNames = new Set<string>();
    const timeMap = new Map<number, Record<string, number>>();

    for (const m of data) {
      const label = labelTransform
        ? labelTransform(m.metric)
        : m.metric[labelKey] || m.metric.__name__ || "value";

      if (m.values) {
        for (const [ts, val] of m.values) {
          const parsedValue = Number.parseFloat(val);
          if (!Number.isFinite(parsedValue)) continue;
          seriesNames.add(label);
          const existing = timeMap.get(ts) || {};
          existing[label] = parsedValue;
          timeMap.set(ts, existing);
        }
      }
    }

    const sorted = Array.from(timeMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([ts, vals]) => ({
        time: ts,
        timeLabel: formatTime
          ? formatTime(ts)
          : new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        ...vals,
      }));

    const allSeries = Array.from(seriesNames);

    // Rank series by max value so we show the most active ones in the legend
    const maxBySeries = allSeries.map((name) => ({
      name,
      max: Math.max(...sorted.map((row) => (row as Record<string, unknown>)[name] as number ?? 0)),
    }));
    maxBySeries.sort((a, b) => b.max - a.max);

    const TOP_N = 5;
    const legendSeries = maxBySeries.slice(0, TOP_N).map((s) => s.name);
    const hiddenCount = Math.max(0, allSeries.length - TOP_N);

    return { chartData: sorted, series: allSeries, legendSeries, hiddenCount };
  }, [data, labelKey, formatTime, labelTransform]);

  const ChartComponent = type === "area" ? AreaChart : LineChart;

  // Map each series name to its stable color index (by position in full series array)
  const seriesColorIndex = useMemo(
    () => Object.fromEntries(series.map((name, i) => [name, i])),
    [series],
  );

  const renderLegend = useCallback(() => (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 px-1 text-xs text-muted-foreground">
      {legendSeries.map((name) => (
        <span key={name} className="flex items-center gap-1.5 min-w-0">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: CHART_COLORS[seriesColorIndex[name] % CHART_COLORS.length] }}
          />
          <span className="truncate max-w-[160px]" title={name}>{name}</span>
        </span>
      ))}
      {hiddenCount > 0 && (
        <span className="italic opacity-60">+{hiddenCount} more (hover to explore)</span>
      )}
    </div>
  ), [legendSeries, hiddenCount, seriesColorIndex]);

  const renderTooltip = useCallback(
    ({ active, payload, label }: TooltipContentProps) => {
      if (!active || !payload || payload.length === 0) return null;
      const sorted = payload
        .filter((entry): entry is typeof entry & { name: string; value: number; color: string } =>
          typeof entry.name === "string" &&
          typeof entry.value === "number" &&
          typeof entry.color === "string",
        )
        .sort((a, b) => b.value - a.value);
      const TOP_TOOLTIP = 3;
      const visible = sorted.slice(0, TOP_TOOLTIP);
      const tooltipHidden = Math.max(0, sorted.length - TOP_TOOLTIP);
      return (
        <div
          style={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            fontSize: "12px",
            padding: "8px 12px",
            minWidth: "160px",
          }}
        >
          <p className="font-medium mb-1.5 text-foreground">{label}</p>
          {visible.map((entry) => (
            <div key={entry.name} className="flex items-center justify-between gap-4 py-0.5">
              <span className="flex items-center gap-1.5 min-w-0">
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="truncate max-w-[140px] text-muted-foreground" title={entry.name}>
                  {entry.name}
                </span>
              </span>
              <span className="font-medium tabular-nums text-foreground shrink-0">
                {formatValue(entry.value)}
              </span>
            </div>
          ))}
          {tooltipHidden > 0 && (
            <p className="mt-1 text-muted-foreground opacity-60 italic">+{tooltipHidden} more</p>
          )}
        </div>
      );
    },
    [formatValue],
  );

  return (
    <Card className="relative" aria-busy={loading}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <EmptyMetricState configured={configured} error={error} loading={loading} />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={height}>
              <ChartComponent data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                <XAxis
                  dataKey="timeLabel"
                  tick={{ fontSize: 11 }}
                  className="text-muted-foreground"
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  className="text-muted-foreground"
                  tickFormatter={formatValue}
                />
                <Tooltip content={renderTooltip} />
                {series.map((name, i) =>
                  type === "area" ? (
                    <Area
                      key={name}
                      type="monotone"
                      dataKey={name}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      fill={CHART_COLORS[i % CHART_COLORS.length]}
                      fillOpacity={0.15}
                      strokeWidth={2}
                    />
                  ) : (
                    <Line
                      key={name}
                      type="monotone"
                      dataKey={name}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                    />
                  ),
                )}
              </ChartComponent>
            </ResponsiveContainer>
            {renderLegend()}
          </>
        )}
      </CardContent>
      {chartData.length > 0 && <RefreshOverlay loading={loading} />}
      {chartData.length > 0 && !loading && <RefreshError error={error} />}
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// BarMetricChart — horizontal/vertical bar chart for instant queries
// ────────────────────────────────────────────────────────────────

interface BarMetricChartProps {
  title: string;
  description?: string;
  query?: string;
  state?: MetricQueryState;
  labelKey?: string;
  height?: number;
  refreshInterval?: number;
  formatValue?: (value: number) => string;
  layout?: "horizontal" | "vertical";
  color?: string;
  labelTransform?: (metric: Record<string, string>) => string;
  emptyMessage?: string;
}

export function BarMetricChart({
  title,
  description,
  query = "",
  state,
  labelKey = "agent_name",
  height = 300,
  refreshInterval = 60_000,
  formatValue = (v) => v.toLocaleString(),
  layout = "vertical",
  color = CHART_COLORS[0],
  labelTransform,
  emptyMessage,
}: BarMetricChartProps) {
  const internalState = usePrometheusQuery({
    query,
    refreshInterval,
    enabled: state === undefined,
  });
  const { data, loading, error, configured } = state ?? internalState;

  const chartData = useMemo(() => {
    if (labelTransform && data) {
      return data
        .map((m) => ({
          label: labelTransform(m.metric),
          value: Number.parseFloat(m.value?.[1] || "NaN"),
        }))
        .filter((item) => Number.isFinite(item.value))
        .sort((a, b) => b.value - a.value);
    }
    return getLabeledValues(data, labelKey);
  }, [data, labelKey, labelTransform]);

  return (
    <Card className="relative" aria-busy={loading}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <EmptyMetricState configured={configured} error={error} loading={loading} message={emptyMessage} />
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart
              data={chartData}
              layout={layout === "horizontal" ? "vertical" : "horizontal"}
            >
              <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
              {layout === "horizontal" ? (
                <>
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    width={120}
                  />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={formatValue} />
                </>
              ) : (
                <>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={formatValue} />
                </>
              )}
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                formatter={(val) => [formatValue(Number(val)), ""]}
              />
              <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
      {chartData.length > 0 && <RefreshOverlay loading={loading} />}
      {chartData.length > 0 && !loading && <RefreshError error={error} />}
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// DonutChart — pie/donut for distribution metrics
// ────────────────────────────────────────────────────────────────

interface DonutChartProps {
  title: string;
  description?: string;
  query?: string;
  state?: MetricQueryState;
  labelKey?: string;
  height?: number;
  refreshInterval?: number;
}

export function DonutChart({
  title,
  description,
  query = "",
  state,
  labelKey = "status",
  height = 250,
  refreshInterval = 60_000,
}: DonutChartProps) {
  const internalState = usePrometheusQuery({
    query,
    refreshInterval,
    enabled: state === undefined,
  });
  const { data, loading, error, configured } = state ?? internalState;

  const chartData = useMemo(() => getLabeledValues(data, labelKey), [data, labelKey]);
  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <Card className="relative" aria-busy={loading}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <EmptyMetricState configured={configured} error={error} loading={loading} />
        ) : (
          <div className="flex items-center gap-6">
            <ResponsiveContainer width="50%" height={height}>
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                >
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {chartData.map((d, i) => (
                <div key={d.label} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    <span className="capitalize">{d.label}</span>
                  </div>
                  <span className="font-medium">
                    {d.value.toLocaleString()}
                    <span className="text-muted-foreground ml-1 text-xs">
                      ({total > 0 ? ((d.value / total) * 100).toFixed(0) : 0}%)
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
      {chartData.length > 0 && <RefreshOverlay loading={loading} />}
      {chartData.length > 0 && !loading && <RefreshError error={error} />}
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// AgentHealthTable — selected-window volume, reliability, and latency
// ────────────────────────────────────────────────────────────────

interface AgentHealthTableProps {
  title: string;
  description?: string;
  volumeState: MetricQueryState;
  reliabilityState: MetricQueryState;
  latencyState: MetricQueryState;
}

function metricMap(data: PrometheusMetric[] | null, labelKey: string): Map<string, number> {
  return new Map(getLabeledValues(data, labelKey).map((item) => [item.label, item.value]));
}

export function AgentHealthTable({
  title,
  description,
  volumeState,
  reliabilityState,
  latencyState,
}: AgentHealthTableProps) {
  const rows = useMemo(() => {
    const volumes = metricMap(volumeState.data, "agent_name");
    const reliabilities = metricMap(reliabilityState.data, "agent_name");
    const latencies = metricMap(latencyState.data, "agent_name");
    const names = new Set([...volumes.keys(), ...reliabilities.keys(), ...latencies.keys()]);
    return [...names]
      .map((name) => ({
        latency: latencies.get(name),
        name,
        reliability: reliabilities.get(name),
        volume: volumes.get(name) ?? 0,
      }))
      .sort((left, right) => right.volume - left.volume);
  }, [latencyState.data, reliabilityState.data, volumeState.data]);

  const loading = volumeState.loading || reliabilityState.loading || latencyState.loading;
  const configured = volumeState.configured && reliabilityState.configured && latencyState.configured;
  const error = volumeState.error || reliabilityState.error || latencyState.error;

  return (
    <Card className="relative" aria-busy={loading}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyMetricState configured={configured} error={error} loading={loading} />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 text-right font-medium">Turns</th>
                  <th className="px-3 py-2 text-right font-medium">Reliability</th>
                  <th className="px-3 py-2 text-right font-medium">Successful p95</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr key={row.name}>
                    <td className="max-w-64 truncate px-3 py-2 font-medium" title={row.name}>{row.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{smartCountFormat(row.volume)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${
                      row.reliability === undefined
                        ? "text-muted-foreground"
                        : row.reliability >= 99
                          ? "text-emerald-500"
                          : row.reliability >= 95
                            ? "text-amber-500"
                            : "text-destructive"
                    }`}>
                      {row.reliability === undefined ? "—" : `${row.reliability.toFixed(2)}%`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.latency === undefined ? "—" : smartDurationFormat(row.latency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {rows.length > 0 && <RefreshOverlay loading={loading} />}
      {rows.length > 0 && !loading && <RefreshError error={error} />}
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// TokenUsageChart — input/output token volume by model
// ────────────────────────────────────────────────────────────────

interface TokenUsageChartProps {
  title: string;
  description?: string;
  inputState: MetricQueryState;
  outputState: MetricQueryState;
  height?: number;
}

export function TokenUsageChart({
  title,
  description,
  inputState,
  outputState,
  height = 280,
}: TokenUsageChartProps) {
  const chartData = useMemo(() => {
    const inputs = metricMap(inputState.data, "model_id");
    const outputs = metricMap(outputState.data, "model_id");
    const names = new Set([...inputs.keys(), ...outputs.keys()]);
    return [...names]
      .map((label) => ({
        input: inputs.get(label) ?? 0,
        label,
        output: outputs.get(label) ?? 0,
        total: (inputs.get(label) ?? 0) + (outputs.get(label) ?? 0),
      }))
      .sort((left, right) => right.total - left.total);
  }, [inputState.data, outputState.data]);
  const loading = inputState.loading || outputState.loading;
  const configured = inputState.configured && outputState.configured;
  const error = inputState.error || outputState.error;

  return (
    <Card className="relative" aria-busy={loading}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <EmptyMetricState configured={configured} error={error} loading={loading} />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={height}>
              <BarChart data={chartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={120} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={smartCountFormat} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  formatter={(value, name) => [smartCountFormat(Number(value)), name === "input" ? "Input" : "Output"]}
                />
                <Bar dataKey="input" stackId="tokens" fill={CHART_COLORS[2]} />
                <Bar dataKey="output" stackId="tokens" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[2] }} />Input</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[0] }} />Output</span>
            </div>
          </>
        )}
      </CardContent>
      {chartData.length > 0 && <RefreshOverlay loading={loading} />}
      {chartData.length > 0 && !loading && <RefreshError error={error} />}
    </Card>
  );
}
