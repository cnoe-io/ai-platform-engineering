import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CasInsightsTab } from "../CasInsightsTab";

const ENGINE = { circuitState: "closed", cacheSize: 5, cacheHits: 8, cacheMisses: 2, cacheHitRatio: 0.8 };

function mockStats(body: unknown, ok = true) {
  (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({ ok, json: async () => body });
}

describe("CasInsightsTab", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows the admin-required message when not admin and does not fetch", () => {
    (global.fetch as jest.Mock) = jest.fn();
    render(<CasInsightsTab isAdmin={false} />);
    expect(screen.getByText(/Admin access required/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("renders the live engine snapshot and durable decision stats", async () => {
    mockStats({
      engine: ENGINE,
      persistence: true,
      window: "24h",
      decisions: {
        total: 10,
        allow: 8,
        deny: 2,
        denyRate: 0.2,
        byReason: [{ reason: "OK", count: 8 }, { reason: "NO_CAPABILITY", count: 2 }],
        topDenied: [{ resource: "agent:pe", count: 2 }],
      },
    });
    render(<CasInsightsTab isAdmin={true} />);

    await waitFor(() => expect(screen.getByText(/Closed \(healthy\)/i)).toBeInTheDocument());
    expect(screen.getByText("80.0%")).toBeInTheDocument(); // cache hit ratio
    expect(screen.getByText(/20.0% deny rate/i)).toBeInTheDocument();
    expect(screen.getByText("NO_CAPABILITY")).toBeInTheDocument();
    expect(screen.getByText("agent:pe")).toBeInTheDocument();
    expect(screen.getByText(/Centralized Authorization Service/i)).toBeInTheDocument();
  });

  it("explains when MongoDB is unconfigured (engine-only)", async () => {
    mockStats({ engine: ENGINE, persistence: false, window: "24h", decisions: null });
    render(<CasInsightsTab isAdmin={true} />);
    await waitFor(() => expect(screen.getByText(/MongoDB is not configured/i)).toBeInTheDocument());
  });

  it("surfaces an error when the stats request fails", async () => {
    mockStats({ error: "boom" }, false);
    render(<CasInsightsTab isAdmin={true} />);
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
  });

  it("refetches with the selected window", async () => {
    mockStats({ engine: ENGINE, persistence: false, window: "24h", decisions: null });
    render(<CasInsightsTab isAdmin={true} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "7d" } });
    await waitFor(() =>
      expect((global.fetch as jest.Mock).mock.calls.some((c) => String(c[0]).includes("window=7d"))).toBe(true),
    );
  });
});
