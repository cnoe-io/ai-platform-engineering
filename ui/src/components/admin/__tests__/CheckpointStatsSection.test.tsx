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

// Mock DateRangeFilter to render simple preset buttons
jest.mock("@/components/admin/DateRangeFilter", () => {
  const presetToRange = (preset: string) => {
    const now = new Date();
    const to = now.toISOString();
    const from = new Date(now);
    switch (preset) {
      case "1h":  from.setHours(from.getHours() - 1); break;
      case "12h": from.setHours(from.getHours() - 12); break;
      case "24h": from.setDate(from.getDate() - 1); break;
      case "7d":  from.setDate(from.getDate() - 7); break;
      case "30d": from.setDate(from.getDate() - 30); break;
      case "90d": from.setDate(from.getDate() - 90); break;
      default:    from.setDate(from.getDate() - 30); break;
    }
    return { from: from.toISOString(), to };
  };
  return {
    __esModule: true,
    presetToRange,
    DateRangeFilter: ({ value, onChange }: any) => (
      <div data-testid="date-range-filter">
        {["24h", "7d", "30d", "90d"].map((p) => (
          <button key={p} onClick={() => onChange(p, presetToRange(p))}>{p}</button>
        ))}
      </div>
    ),
  };
});

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
      expect(screen.getByText("7d")).toBeInTheDocument();
      expect(screen.getByText("30d")).toBeInTheDocument();
      expect(screen.getByText("90d")).toBeInTheDocument();
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
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/admin/stats/checkpoints?from=")
      );
    });

    fireEvent.click(screen.getByText("30d"));

    await waitFor(() => {
      // After clicking 30d, a second fetch with new from/to params
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0];
      expect(lastCall).toContain("/api/admin/stats/checkpoints?from=");
      expect(lastCall).toContain("&to=");
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

  it("re-fetches data when a different range preset is clicked", async () => {
    const fetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_STATS),
      }),
    ) as any;
    global.fetch = fetchMock;

    render(<CheckpointStatsSection />);

    // Initial fetch (default 7d)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/admin/stats/checkpoints?from=")
      );
    });

    // Click 24h — triggers a new fetch with updated from/to params
    fireEvent.click(screen.getByText("24h"));

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
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
