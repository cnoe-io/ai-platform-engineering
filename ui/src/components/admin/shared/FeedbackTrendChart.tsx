"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const POSITIVE_COLOR = "rgb(34, 197, 94)";
const NEGATIVE_COLOR = "rgb(239, 68, 68)";

export interface FeedbackTrendPoint {
  label: string;
  positive: number;
  negative: number;
}

interface FeedbackTrendChartProps {
  data: FeedbackTrendPoint[];
  height?: number;
}

interface FeedbackTrendTooltipProps {
  active?: boolean;
  label?: string;
  point?: FeedbackTrendPoint;
}

interface FeedbackTrendSummary {
  positive: number;
  negative: number;
  total: number;
  net: number;
  positiveRate: number | null;
}

function summarizeFeedback(data: FeedbackTrendPoint[]): FeedbackTrendSummary {
  const { positive, negative } = data.reduce(
    (summary, point) => ({
      positive: summary.positive + point.positive,
      negative: summary.negative + point.negative,
    }),
    { positive: 0, negative: 0 },
  );
  const total = positive + negative;

  return {
    positive,
    negative,
    total,
    net: positive - negative,
    positiveRate: total > 0 ? Math.round((positive / total) * 100) : null,
  };
}

function formatNet(net: number): string {
  return `${net > 0 ? "+" : ""}${net.toLocaleString()}`;
}

function netColorClass(net: number): string {
  if (net > 0) return "text-green-500";
  if (net < 0) return "text-red-500";
  return "text-muted-foreground";
}

export function FeedbackTrendTooltip({
  active,
  label,
  point,
}: FeedbackTrendTooltipProps) {
  if (!active || !point) return null;

  const summary = summarizeFeedback([point]);

  return (
    <div
      className="min-w-48 rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md"
      role="tooltip"
    >
      <p className="mb-2 font-semibold">{label ?? point.label}</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-2 text-muted-foreground">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: POSITIVE_COLOR }}
            />
            Positive
          </span>
          <span className="font-semibold tabular-nums text-green-500">
            {point.positive.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-2 text-muted-foreground">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: NEGATIVE_COLOR }}
            />
            Negative
          </span>
          <span className="font-semibold tabular-nums text-red-500">
            {point.negative.toLocaleString()}
          </span>
        </div>
      </div>
      <div className="mt-2 space-y-1.5 border-t border-border pt-2">
        <div className="flex items-center justify-between gap-6">
          <span className="text-muted-foreground">Total</span>
          <span className="font-semibold tabular-nums">{summary.total.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-muted-foreground">Net</span>
          <span className={`font-semibold tabular-nums ${netColorClass(summary.net)}`}>
            {formatNet(summary.net)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-muted-foreground">Positive rate</span>
          <span className="font-semibold tabular-nums">
            {summary.positiveRate === null ? "—" : `${summary.positiveRate}%`}
          </span>
        </div>
      </div>
    </div>
  );
}

export function FeedbackTrendChart({ data, height = 180 }: FeedbackTrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        No data available
      </div>
    );
  }

  const summary = summarizeFeedback(data);

  return (
    <div
      aria-label="Positive versus negative feedback by day"
      className="w-full"
      role="region"
    >
      <div
        aria-label="Feedback totals for the selected range"
        className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs"
      >
        <span className="flex items-center gap-2 text-muted-foreground">
          <span
            aria-hidden="true"
            className="w-5 border-t-2"
            style={{ borderColor: POSITIVE_COLOR }}
          />
          Positive
          <strong
            className="font-semibold tabular-nums text-foreground"
            data-testid="feedback-positive-total"
          >
            {summary.positive.toLocaleString()}
          </strong>
        </span>
        <span className="flex items-center gap-2 text-muted-foreground">
          <span
            aria-hidden="true"
            className="w-5 border-t-2 border-dashed"
            style={{ borderColor: NEGATIVE_COLOR }}
          />
          Negative
          <strong
            className="font-semibold tabular-nums text-foreground"
            data-testid="feedback-negative-total"
          >
            {summary.negative.toLocaleString()}
          </strong>
        </span>
        <span className="ml-auto text-muted-foreground">
          Net{" "}
          <strong
            className={`font-semibold tabular-nums ${netColorClass(summary.net)}`}
            data-testid="feedback-net-total"
          >
            {formatNet(summary.net)}
          </strong>
        </span>
      </div>

      <div style={{ height }}>
        <ResponsiveContainer height="100%" minWidth={0} width="100%">
          <LineChart
            accessibilityLayer
            data={data}
            margin={{ top: 8, right: 12, bottom: 0, left: -8 }}
          >
            <CartesianGrid
              stroke="hsl(var(--border))"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              axisLine={false}
              dataKey="label"
              interval="preserveStartEnd"
              minTickGap={36}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              domain={[0, (dataMax: number) => Math.max(1, dataMax)]}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              tickLine={false}
              width={38}
            />
            <Tooltip
              content={({ active, label, payload }) => (
                <FeedbackTrendTooltip
                  active={active}
                  label={typeof label === "string" ? label : undefined}
                  point={payload?.[0]?.payload as FeedbackTrendPoint | undefined}
                />
              )}
              cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "4 4" }}
              isAnimationActive={false}
            />
            <Line
              activeDot={{ r: 5, strokeWidth: 2 }}
              dataKey="positive"
              dot={{ fill: POSITIVE_COLOR, r: 3, strokeWidth: 0 }}
              isAnimationActive={false}
              name="Positive"
              stroke={POSITIVE_COLOR}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              type="linear"
            />
            <Line
              activeDot={{ r: 5, strokeWidth: 2 }}
              dataKey="negative"
              dot={{ fill: NEGATIVE_COLOR, r: 3, strokeWidth: 0 }}
              isAnimationActive={false}
              name="Negative"
              stroke={NEGATIVE_COLOR}
              strokeDasharray="5 4"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              type="linear"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
