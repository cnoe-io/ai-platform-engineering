import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";

jest.mock("recharts", () => ({
  CartesianGrid: () => null,
  Line: ({ dataKey }: { dataKey: string }) => (
    <div data-series={dataKey} data-testid="feedback-series" />
  ),
  LineChart: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: (state: { activeTooltipIndex?: number }) => void;
  }) => (
    <div
      data-testid="feedback-chart-surface"
      onClick={() => onClick?.({ activeTooltipIndex: 1 })}
    >
      {children}
    </div>
  ),
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import {
  FeedbackTrendChart,
  FeedbackTrendTooltip,
} from "../FeedbackTrendChart";

describe("FeedbackTrendChart", () => {
  const data = [
    { date: "2026-07-20", label: "Jul 20", positive: 8, negative: 3 },
    { date: "2026-07-21", label: "Jul 21", positive: 4, negative: 2 },
  ];

  it("summarizes both series and their net difference", () => {
    render(<FeedbackTrendChart data={data} />);

    expect(screen.getByTestId("feedback-positive-total")).toHaveTextContent("12");
    expect(screen.getByTestId("feedback-negative-total")).toHaveTextContent("5");
    expect(screen.getByTestId("feedback-net-total")).toHaveTextContent("+7");
    expect(screen.getByLabelText("Positive versus negative feedback by day")).toBeInTheDocument();
    expect(screen.getAllByTestId("feedback-series").map((series) => series.dataset.series)).toEqual([
      "positive",
      "negative",
    ]);
  });

  it("shows a useful per-day comparison in the tooltip", () => {
    render(
      <FeedbackTrendTooltip
        active
        interactive
        label="Jul 20"
        point={{ date: "2026-07-20", label: "Jul 20", positive: 8, negative: 3 }}
      />,
    );

    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByText("Jul 20")).toBeInTheDocument();
    expect(within(tooltip).getByText("8")).toBeInTheDocument();
    expect(within(tooltip).getByText("3")).toBeInTheDocument();
    expect(within(tooltip).getByText("11")).toBeInTheDocument();
    expect(within(tooltip).getByText("+5")).toBeInTheDocument();
    expect(within(tooltip).getByText("73%")).toBeInTheDocument();
    expect(within(tooltip).getByText("Click to view feedback for this date")).toBeInTheDocument();
  });

  it("uses a neutral rate when a day has no feedback", () => {
    render(
      <FeedbackTrendTooltip
        active
        label="Jul 22"
        point={{ date: "2026-07-22", label: "Jul 22", positive: 0, negative: 0 }}
      />,
    );

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getAllByText("0")).toHaveLength(4);
  });

  it("handles an empty series", () => {
    render(<FeedbackTrendChart data={[]} />);

    expect(screen.getByText("No data available")).toBeInTheDocument();
  });

  it("opens the selected feedback date when the chart is clicked", () => {
    const onPointClick = jest.fn();
    render(<FeedbackTrendChart data={data} onPointClick={onPointClick} />);

    fireEvent.click(screen.getByTestId("feedback-chart-surface"));

    expect(onPointClick).toHaveBeenCalledWith(data[1]);
    expect(screen.getByTitle("Click a point to view feedback for that date")).toHaveClass(
      "cursor-pointer",
    );
  });
});
