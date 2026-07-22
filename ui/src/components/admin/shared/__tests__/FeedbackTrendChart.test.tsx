import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";

jest.mock("recharts", () => ({
  CartesianGrid: () => null,
  Line: ({ dataKey }: { dataKey: string }) => (
    <div data-series={dataKey} data-testid="feedback-series" />
  ),
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
    { label: "Jul 20", positive: 8, negative: 3 },
    { label: "Jul 21", positive: 4, negative: 2 },
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
        label="Jul 20"
        point={{ label: "Jul 20", positive: 8, negative: 3 }}
      />,
    );

    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByText("Jul 20")).toBeInTheDocument();
    expect(within(tooltip).getByText("8")).toBeInTheDocument();
    expect(within(tooltip).getByText("3")).toBeInTheDocument();
    expect(within(tooltip).getByText("11")).toBeInTheDocument();
    expect(within(tooltip).getByText("+5")).toBeInTheDocument();
    expect(within(tooltip).getByText("73%")).toBeInTheDocument();
  });

  it("uses a neutral rate when a day has no feedback", () => {
    render(
      <FeedbackTrendTooltip
        active
        label="Jul 22"
        point={{ label: "Jul 22", positive: 0, negative: 0 }}
      />,
    );

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getAllByText("0")).toHaveLength(4);
  });

  it("handles an empty series", () => {
    render(<FeedbackTrendChart data={[]} />);

    expect(screen.getByText("No data available")).toBeInTheDocument();
  });
});
