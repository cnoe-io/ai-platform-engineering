"use client";

import React, { useMemo } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  usePrometheusQuery,
  getScalarValue,
  getTimeseriesData,
  getLabeledValues,
  type UsePrometheusOptions,
  type PrometheusMetric,
} from "@/hooks/use-prometheus";

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

// ────────────────────────────────────────────────────────────────
// MetricStatCard — big-number metric with optional subtitle
// ────────────────────────────────────────────────────────────────

interface MetricStatCardProps {
  title: string;
  query: string;
  icon?: React.ReactNode;
  format?: (value: number) => string;
  subtitle?: string;
  refreshInterval?: number;
  className?: string;
}

export function MetricStatCard({
  title,
  query,
  icon,
  format = (v) => v.toLocaleString(),
  subtitle,
  refreshInterval = 30_000,
  className,
}: MetricStatCardProps) {
  const { data, loading, error, configured } = usePrometheusQuery({
    query,
    refreshInterval,
  });

  const value = getScalarValue(data);

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {!configured ? (
          <p className="text-sm text-muted-foreground">Not configured</p>
        ) : loading && value === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : error ? (
          <p className="text-sm text-destructive truncate" title={error}>—</p>
        ) : (
          <>
            <div className="text-2xl font-bold">
              {value !== null ? format(value) : "—"}
            </div>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// ActiveAgentsCard — shows count + names of enabled agents
// ────────────────────────────────────────────────────────────────

export function ActiveAgentsCard({
  refreshInterval = 30_000,
  className,
}: {
  refreshInterval?: number;
  className?: string;
}) {
  const { data, loading, error, configured } = usePrometheusQuery({
    query: "enabled_subagents == 1",
    refreshInterval,
  });

  const agents = useMemo(() => {
    if (!data) return [];
    return data
      .filter((m) => parseFloat(m.value?.[1] || "0") === 1)
      .map((m) => m.metric.agent_name || "unknown")
      .sort();
  }, [data]);

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Active Agents</CardTitle>
        <Loader2 className={cn(
          "h-4 w-4 text-muted-foreground",
          loading ? "animate-spin" : "hidden",
        )} />
      </CardHeader>
      <CardContent>
        {!configured ? (
          <p className="text-sm text-muted-foreground">Not configured</p>
        ) : error ? (
          <p className="text-sm text-destructive truncate" title={error}>—</p>
        ) : (
          <>
            <div className="text-2xl font-bold">{agents.length}</div>
            {agents.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {agents.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/15 text-green-600 dark:text-green-400"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// TimeseriesChart — line/area chart for range queries
// ────────────────────────────────────────────────────────────────

interface TimeseriesChartProps {
  title: string;
  description?: string;
  query: string;
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
  query,
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

  const { data, loading, error, configured } = usePrometheusQuery({
    query,
    type: "range",
    start: String(start),
    end: String(now),
    step,
    refreshInterval,
  });

  const { chartData, series } = useMemo(() => {
    if (!data || data.length === 0) return { chartData: [], series: [] as string[] };

    const seriesNames = new Set<string>();
    const timeMap = new Map<number, Record<string, number>>();

    for (const m of data) {
      const label = labelTransform
        ? labelTransform(m.metric)
        : m.metric[labelKey] || m.metric.__name__ || "value";
      seriesNames.add(label);

      if (m.values) {
        for (const [ts, val] of m.values) {
          const existing = timeMap.get(ts) || {};
          existing[label] = parseFloat(val) || 0;
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

    return { chartData: sorted, series: Array.from(seriesNames) };
  }, [data, labelKey, formatTime]);

  const ChartComponent = type === "area" ? AreaChart : LineChart;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {!configured ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            Prometheus not configured
          </div>
        ) : loading && chartData.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-48 text-destructive text-sm">
            {error}
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No data available
          </div>
        ) : (
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
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                formatter={(val: number) => [formatValue(val), ""]}
              />
              <Legend />
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
        )}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// BarMetricChart — horizontal/vertical bar chart for instant queries
// ────────────────────────────────────────────────────────────────

interface BarMetricChartProps {
  title: string;
  description?: string;
  query: string;
  labelKey?: string;
  height?: number;
  refreshInterval?: number;
  formatValue?: (value: number) => string;
  layout?: "horizontal" | "vertical";
  color?: string;
  labelTransform?: (metric: Record<string, string>) => string;
}

export function BarMetricChart({
  title,
  description,
  query,
  labelKey = "agent_name",
  height = 300,
  refreshInterval = 60_000,
  formatValue = (v) => v.toLocaleString(),
  layout = "vertical",
  color = CHART_COLORS[0],
  labelTransform,
}: BarMetricChartProps) {
  const { data, loading, error, configured } = usePrometheusQuery({
    query,
    refreshInterval,
  });

  const chartData = useMemo(() => {
    if (labelTransform && data) {
      return data
        .map((m) => ({
          label: labelTransform(m.metric),
          value: parseFloat(m.value?.[1] || "0"),
        }))
        .sort((a, b) => b.value - a.value);
    }
    return getLabeledValues(data, labelKey);
  }, [data, labelKey, labelTransform]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {!configured ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            Prometheus not configured
          </div>
        ) : loading && chartData.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-48 text-destructive text-sm">
            {error}
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No data available
          </div>
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
                formatter={(val: number) => [formatValue(val), ""]}
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
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// DonutChart — pie/donut for distribution metrics
// ────────────────────────────────────────────────────────────────

interface DonutChartProps {
  title: string;
  description?: string;
  query: string;
  labelKey?: string;
  height?: number;
  refreshInterval?: number;
}

export function DonutChart({
  title,
  description,
  query,
  labelKey = "status",
  height = 250,
  refreshInterval = 60_000,
}: DonutChartProps) {
  const { data, loading, error, configured } = usePrometheusQuery({
    query,
    refreshInterval,
  });

  const chartData = useMemo(() => getLabeledValues(data, labelKey), [data, labelKey]);
  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {!configured ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            Prometheus not configured
          </div>
        ) : loading && chartData.length === 0 ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No data available
          </div>
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
    </Card>
  );
}
