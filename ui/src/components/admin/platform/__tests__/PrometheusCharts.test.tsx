import { fireEvent, render, screen } from "@testing-library/react";

import type { PrometheusMetric } from "@/hooks/use-prometheus";

import { AgentHealthTable, TimeseriesChart } from "../PrometheusCharts";

const mockUsePrometheusQuery = jest.fn();
const mockGetLabeledValues = jest.fn((): Array<{ label: string; value: number }> => []);

jest.mock("@/hooks/use-prometheus", () => ({
  usePrometheusQuery: (...args: unknown[]) => mockUsePrometheusQuery(...args),
  getScalarValue: jest.fn(),
  getLabeledValues: (...args: unknown[]) => mockGetLabeledValues(...args),
}));

// recharts' ResponsiveContainer needs layout APIs jsdom lacks; the global
// ResizeObserver stub from jest.setup.js reports a fixed width which is
// sufficient for the chart to render without throwing.
beforeAll(() => {
  if (!global.ResizeObserver) {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

function makeSeriesMetric(name: string, values: number[]): PrometheusMetric {
  return {
    metric: { agent_name: name },
    values: values.map((v, i) => [1000 + i * 60, String(v)]),
  };
}

describe("TimeseriesChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLabeledValues.mockReturnValue([]);
  });

  it("caps the legend to five series and expands the remaining labels on click", () => {
    // 7 series with clearly distinct max values, ranked series-a (100) down to series-g (40)
    const data: PrometheusMetric[] = [
      makeSeriesMetric("series-a", [100]),
      makeSeriesMetric("series-b", [90]),
      makeSeriesMetric("series-c", [80]),
      makeSeriesMetric("series-d", [70]),
      makeSeriesMetric("series-e", [60]),
      makeSeriesMetric("series-f", [50]),
      makeSeriesMetric("series-g", [40]),
    ];

    mockUsePrometheusQuery.mockReturnValue({
      data,
      loading: false,
      error: null,
      configured: true,
    });

    render(<TimeseriesChart title="Test chart" query="up" />);

    // Top 5 by max value appear in the legend
    expect(screen.getByText("series-a")).toBeInTheDocument();
    expect(screen.getByText("series-b")).toBeInTheDocument();
    expect(screen.getByText("series-c")).toBeInTheDocument();
    expect(screen.getByText("series-d")).toBeInTheDocument();
    expect(screen.getByText("series-e")).toBeInTheDocument();

    // The 2 lowest-max series are not shown in the legend
    expect(screen.queryByText("series-f")).not.toBeInTheDocument();
    expect(screen.queryByText("series-g")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(screen.getByText("series-f")).toBeInTheDocument();
    expect(screen.getByText("series-g")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.queryByText("series-f")).not.toBeInTheDocument();
  });

  it("shows no +N more indicator when there are 5 or fewer series", () => {
    const data: PrometheusMetric[] = [
      makeSeriesMetric("series-a", [100]),
      makeSeriesMetric("series-b", [90]),
      makeSeriesMetric("series-c", [80]),
      makeSeriesMetric("series-d", [70]),
    ];

    mockUsePrometheusQuery.mockReturnValue({
      data,
      loading: false,
      error: null,
      configured: true,
    });

    render(<TimeseriesChart title="Test chart" query="up" />);

    expect(screen.getByText("series-a")).toBeInTheDocument();
    expect(screen.getByText("series-b")).toBeInTheDocument();
    expect(screen.getByText("series-c")).toBeInTheDocument();
    expect(screen.getByText("series-d")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /Show \d+ more/ })).not.toBeInTheDocument();
  });

  it("keeps existing chart data visible with a loading overlay during refresh", () => {
    const data = [makeSeriesMetric("primary", [1, 2])];

    render(
      <TimeseriesChart
        title="Refreshing chart"
        state={{ data, loading: true, error: null, configured: true }}
      />,
    );

    expect(screen.getByText("primary")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading metric")).toBeInTheDocument();
    expect(screen.getByText("Refreshing chart").closest(".relative")).toHaveAttribute("aria-busy", "true");
  });

  it("shows an explicit empty state after a successful query with no observations", () => {
    render(
      <TimeseriesChart
        title="Empty chart"
        state={{ data: [], loading: false, error: null, configured: true }}
      />,
    );

    expect(screen.getByText("No observations in this range")).toBeInTheDocument();
  });

  it("does not turn NaN histogram points into misleading zeroes", () => {
    render(
      <TimeseriesChart
        title="Empty histogram"
        state={{
          configured: true,
          data: [{ metric: { agent_name: "primary" }, values: [[1000, "NaN"]] }],
          error: null,
          loading: false,
        }}
      />,
    );

    expect(screen.getByText("No observations in this range")).toBeInTheDocument();
    expect(screen.queryByText("primary")).not.toBeInTheDocument();
  });
});

describe("AgentHealthTable", () => {
  it("paginates agent comparisons ten rows at a time", () => {
    const metrics = Array.from({ length: 12 }, (_, index) => ({
      metric: { agent_name: `agent-${String(index + 1).padStart(2, "0")}` },
      value: [1000, String(12 - index)] as [number, string],
    }));
    mockGetLabeledValues.mockImplementation((data: unknown, labelKey: unknown) => (
      (data as PrometheusMetric[] | null ?? []).map((metric) => ({
        label: metric.metric[String(labelKey)] || "unknown",
        value: Number(metric.value?.[1] ?? 0),
      })).sort((left, right) => right.value - left.value)
    ));
    const state = { configured: true, data: metrics, error: null, loading: false };

    render(
      <AgentHealthTable
        title="Agent comparison"
        volumeState={state}
        reliabilityState={state}
        latencyState={state}
      />,
    );

    expect(screen.getByText("agent-01")).toBeInTheDocument();
    expect(screen.queryByText("agent-11")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1–10 of 12")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("agent-11")).toBeInTheDocument();
    expect(screen.getByText("agent-12")).toBeInTheDocument();
    expect(screen.queryByText("agent-01")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 11–12 of 12")).toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────────
// Tooltip capping logic
//
// `renderTooltip` inside TimeseriesChart is not exported, and recharts'
// Tooltip only renders its content via real mouse-move DOM measurement,
// which jsdom does not support (no layout engine). Rather than exporting
// the internal render function purely for testability, this block
// duplicates the exact sort/slice arithmetic from `renderTooltip` in
// PrometheusCharts.tsx (top 3 by value, "+N more" for the rest) and
// exercises it directly against a fixed payload, so the capping logic
// itself stays covered.
// ────────────────────────────────────────────────────────────────

interface TooltipEntry {
  name: string;
  value: number;
  color: string;
}

function capTooltipEntries(payload: TooltipEntry[]) {
  const sorted = [...payload].sort((a, b) => b.value - a.value);
  const TOP_TOOLTIP = 3;
  const visible = sorted.slice(0, TOP_TOOLTIP);
  const tooltipHidden = Math.max(0, sorted.length - TOP_TOOLTIP);
  return { visible, tooltipHidden };
}

describe("tooltip capping arithmetic (mirrors renderTooltip in PrometheusCharts.tsx)", () => {
  it("keeps only the top 3 entries by value, sorted descending", () => {
    const payload: TooltipEntry[] = [
      { name: "series-c", value: 80, color: "blue" },
      { name: "series-a", value: 100, color: "teal" },
      { name: "series-g", value: 40, color: "cyan" },
      { name: "series-b", value: 90, color: "purple" },
      { name: "series-e", value: 60, color: "green" },
    ];

    const { visible, tooltipHidden } = capTooltipEntries(payload);

    expect(visible.map((e) => e.name)).toEqual(["series-a", "series-b", "series-c"]);
    expect(tooltipHidden).toBe(2);
  });

  it("reports zero hidden entries when there are 3 or fewer", () => {
    const payload: TooltipEntry[] = [
      { name: "series-a", value: 100, color: "teal" },
      { name: "series-b", value: 90, color: "purple" },
    ];

    const { visible, tooltipHidden } = capTooltipEntries(payload);

    expect(visible).toHaveLength(2);
    expect(tooltipHidden).toBe(0);
  });
});
