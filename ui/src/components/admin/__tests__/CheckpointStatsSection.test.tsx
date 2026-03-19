/**
 * Tests for CheckpointStatsSection component
 *
 * Covers:
 * - Loading state
 * - Error state
 * - Renders overview cards with correct totals
 * - Renders per-agent table with sorted data
 * - Range selector buttons
 * - Cross-contamination display
 * - Display name formatting
 */

import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// Mock SimpleLineChart
jest.mock("@/components/admin/SimpleLineChart", () => ({
  SimpleLineChart: () => <div data-testid="line-chart" />,
}));

// Mock cn utility
jest.mock("@/lib/utils", () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
}));

import { CheckpointStatsSection } from "../CheckpointStatsSection";

const MOCK_STATS = {
  success: true,
  data: {
    agents: [
      { name: "aws", checkpoints: 67, writes: 409, threads: 12, latest_checkpoint: new Date().toISOString() },
      { name: "jira", checkpoints: 23, writes: 48, threads: 5, latest_checkpoint: new Date(Date.now() - 3600000).toISOString() },
      { name: "caipe_supervisor", checkpoints: 53, writes: 106, threads: 20, latest_checkpoint: new Date().toISOString() },
      { name: "weather", checkpoints: 0, writes: 0, threads: 0, latest_checkpoint: null },
    ],
    totals: {
      total_checkpoints: 143,
      total_writes: 563,
      total_threads: 37,
      active_agents: 3,
      total_agents: 4,
    },
    daily_activity: [
      { date: "2026-03-18", writes: 100 },
      { date: "2026-03-19", writes: 463 },
    ],
    cross_contamination: {
      shared_threads: 2,
      details: [
        { thread_id: "f8221179...", collections: ["checkpoints_caipe_supervisor", "checkpoints_aws"] },
        { thread_id: "abc12345...", collections: ["checkpoints_caipe_supervisor", "checkpoints_jira"] },
      ],
    },
    range: "7d",
  },
};

describe("CheckpointStatsSection", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("shows loading state initially", () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as any;
    render(<CheckpointStatsSection />);
    expect(screen.getByText("Loading checkpoint stats...")).toBeInTheDocument();
  });

  it("shows error state on fetch failure", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: "MongoDB not configured" }),
      }),
    ) as any;

    render(<CheckpointStatsSection />);

    await waitFor(() => {
      expect(screen.getByText("MongoDB not configured")).toBeInTheDocument();
    });
  });

  it("renders overview cards with correct totals", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_STATS),
      }),
    ) as any;

    render(<CheckpointStatsSection />);

    await waitFor(() => {
      expect(screen.getByText("Total Checkpoints")).toBeInTheDocument();
    });
    expect(screen.getByText("Total Writes")).toBeInTheDocument();
    expect(screen.getByText("Active Agents")).toBeInTheDocument();
    expect(screen.getByText("Unique Threads")).toBeInTheDocument();
    expect(screen.getByText("143")).toBeInTheDocument();
    expect(screen.getByText("563")).toBeInTheDocument();
    expect(screen.getByText("/ 4")).toBeInTheDocument();
  });

  it("renders per-agent table with display names", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_STATS),
      }),
    ) as any;

    render(<CheckpointStatsSection />);

    await waitFor(() => {
      expect(screen.getByText("AWS")).toBeInTheDocument();
      expect(screen.getByText("Jira")).toBeInTheDocument();
      expect(screen.getByText("Supervisor")).toBeInTheDocument();
      expect(screen.getByText("Weather")).toBeInTheDocument();
    });
  });

  it("renders range selector buttons", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_STATS),
      }),
    ) as any;

    render(<CheckpointStatsSection />);

    await waitFor(() => {
      expect(screen.getByText("24h")).toBeInTheDocument();
      expect(screen.getByText("7 days")).toBeInTheDocument();
      expect(screen.getByText("30 days")).toBeInTheDocument();
      expect(screen.getByText("90 days")).toBeInTheDocument();
    });
  });

  it("fetches new data when range changes", async () => {
    const fetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_STATS),
      }),
    ) as any;
    global.fetch = fetchMock;

    render(<CheckpointStatsSection />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/stats/checkpoints?range=7d");
    });

    fireEvent.click(screen.getByText("30 days"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/stats/checkpoints?range=30d");
    });
  });

  it("shows cross-contamination details", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_STATS),
      }),
    ) as any;

    render(<CheckpointStatsSection />);

    await waitFor(() => {
      expect(screen.getByText("2 shared thread(s)")).toBeInTheDocument();
      expect(screen.getByText(/supervisor forwards context_id/)).toBeInTheDocument();
    });
  });

  it("shows clean isolation when no shared threads", async () => {
    const cleanStats = {
      ...MOCK_STATS,
      data: {
        ...MOCK_STATS.data,
        cross_contamination: { shared_threads: 0, details: [] },
      },
    };
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(cleanStats),
      }),
    ) as any;

    render(<CheckpointStatsSection />);

    await waitFor(() => {
      expect(screen.getByText("No cross-contamination detected")).toBeInTheDocument();
    });
  });

  it("renders activity chart", async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_STATS),
      }),
    ) as any;

    render(<CheckpointStatsSection />);

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });
  });

  it("uses external range prop and calls onRangeChange", async () => {
    const onRangeChange = jest.fn();
    const fetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_STATS),
      }),
    ) as any;
    global.fetch = fetchMock;

    render(<CheckpointStatsSection range="30d" onRangeChange={onRangeChange} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/stats/checkpoints?range=30d");
    });

    // Click 24h — should call onRangeChange, not internal state
    fireEvent.click(screen.getByText("24h"));
    expect(onRangeChange).toHaveBeenCalledWith("1d");
  });

  it("shows data peek section when peek_data is present", async () => {
    const statsWithPeek = {
      ...MOCK_STATS,
      data: {
        ...MOCK_STATS.data,
        peek_data: [
          {
            agent: "aws",
            collection: "checkpoints_aws",
            documents: [
              { _id: "abc123", thread_id: "thread-001", channel_values: "..." },
            ],
          },
        ],
      },
    };
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(statsWithPeek),
      }),
    ) as any;

    render(<CheckpointStatsSection />);

    await waitFor(() => {
      expect(screen.getByText("Data Peek")).toBeInTheDocument();
    });

    // The peek section shows collection name in mono text
    expect(screen.getByText("checkpoints_aws")).toBeInTheDocument();
    expect(screen.getByText("1 doc")).toBeInTheDocument();
  });
});
